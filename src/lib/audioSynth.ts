import { Residue } from './pdbParser';
import { computeAnmModes, type AnmResult } from './nma/anm';
import {
  hydrophobicCategory,
  kdToMidiOffset,
  kyteDoolittleValue,
  type HydrophobicCategory,
} from './kyteDoolittle';
import { mulberry32 } from './pdbHash';

export type SonificationMode = 'sequential' | 'spectral' | 'nma' | 'hybrid';

export class ProteinSonifier {
  ctx: AudioContext | null = null;
  isPlaying = false;
  currentResidueIndex = 0;
  residues: Residue[] = [];
  kConstant = 8000;
  baseTempoMs = 150;
  onProgress?: (index: number) => void;
  onComplete?: () => void;
  nextNoteTime = 0;
  timerID: number | null = null;
  lookahead = 25.0;
  scheduleAheadTime = 0.1;
  loop = false;

  private voicePool: {
    osc: OscillatorNode;
    gain: GainNode;
    filter: BiquadFilterNode;
    type: OscillatorType;
    busy: boolean;
  }[] = [];
  private poolSize = 10;

  sonificationMode: SonificationMode = 'sequential';
  /** Mapeo secuencial: pitch Kyte–Doolittle + timbre por categoría hidrofóbica */
  useScientificMapping = true;
  /** Panorama estéreo 3D desde coordenadas Cα */
  useSpatialAudio = true;

  private spectralOscillatorTypes: OscillatorType[] = ['sine', 'sawtooth', 'triangle'];
  private cachedSpectralFrequencies: number[] | null = null;
  private cachedAnm: AnmResult | null = null;
  private anmComputedForLength = 0;

  private spectralNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private anmNodes: { osc: OscillatorNode; gain: GainNode; panner?: PannerNode }[] = [];

  /** Hash PDB para reproducibilidad (semilla determinista) */
  pdbHash = '';

  init() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const types = this.spectralOscillatorTypes;
      for (let i = 0; i < this.poolSize; i++) {
        const type = types[i % types.length];
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        osc.type = type;
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        gain.gain.value = 0;
        osc.start();
        this.voicePool.push({ osc, gain, filter, type, busy: false });
      }
    }
  }

  private getVoice(type: OscillatorType) {
    return this.voicePool.find((v) => v.type === type && !v.busy);
  }

  load(residues: Residue[], pdbHash = '') {
    this.residues = residues;
    this.currentResidueIndex = 0;
    this.cachedSpectralFrequencies = null;
    this.cachedAnm = null;
    this.anmComputedForLength = 0;
    this.pdbHash = pdbHash;
  }

  setMode(mode: SonificationMode) {
    if (this.isPlaying) this.stop();
    this.sonificationMode = mode;
  }

  /** Frecuencias grafo vecinal (modo spectral clásico del proyecto). */
  calculateSpectralFrequencies(): number[] {
    if (this.cachedSpectralFrequencies) return this.cachedSpectralFrequencies;
    if (!this.residues.length) return [];

    const cutoff = 10.0;
    const frequencies: number[] = [];

    for (let i = 0; i < this.residues.length; i++) {
      const r1 = this.residues[i];
      let neighbors = 0;
      for (let j = 0; j < this.residues.length; j++) {
        if (i === j) continue;
        const r2 = this.residues[j];
        const distSq = Math.pow(r1.x - r2.x, 2) + Math.pow(r1.y - r2.y, 2) + Math.pow(r1.z - r2.z, 2);
        if (distSq < cutoff * cutoff) neighbors++;
      }

      const mass = r1.mass > 0 ? r1.mass : 110;
      const freq = (this.kConstant / 10) * Math.sqrt((neighbors + 1) / mass);
      if (isFinite(freq) && freq > 20 && freq < 20000) {
        frequencies.push(freq);
      }
    }

    const maxOscillators = 64;
    let selectedFreqs = frequencies;
    if (frequencies.length > maxOscillators) {
      selectedFreqs = [];
      const step = Math.floor(frequencies.length / maxOscillators);
      for (let i = 0; i < maxOscillators; i++) {
        selectedFreqs.push(frequencies[i * step]);
      }
    }

    this.cachedSpectralFrequencies = selectedFreqs;
    return selectedFreqs;
  }

  /** Modos ANM (red elástica / Hessiana en enfoque ANM). */
  calculateAnmModes(): AnmResult | null {
    if (this.cachedAnm && this.anmComputedForLength === this.residues.length) {
      return this.cachedAnm;
    }
    const result = computeAnmModes(this.residues, {});
    this.cachedAnm = result;
    this.anmComputedForLength = this.residues.length;
    return result;
  }

  play() {
    this.init();
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
    if (this.isPlaying) return;
    this.isPlaying = true;

    if (this.sonificationMode === 'sequential') {
      this.nextNoteTime = this.ctx!.currentTime + 0.1;
      this.scheduler();
    } else if (this.sonificationMode === 'spectral') {
      this.startSpectral();
    } else if (this.sonificationMode === 'nma') {
      this.startAnmPolyphonic(0.45);
    } else if (this.sonificationMode === 'hybrid') {
      this.startAnmPolyphonic(0.12);
      this.nextNoteTime = this.ctx!.currentTime + 0.1;
      this.scheduler();
    }
  }

  private startSpectral() {
    if (!this.ctx || !this.residues.length) return;

    const selectedFreqs = this.calculateSpectralFrequencies();

    const masterGain = this.ctx.createGain();
    masterGain.connect(this.ctx.destination);
    masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.5 / Math.sqrt(selectedFreqs.length), this.ctx.currentTime + 0.5);

    selectedFreqs.forEach((f) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.value = 1.0 / selectedFreqs.length;
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start();
      this.spectralNodes.push({ osc, gain });
    });

    (this as unknown as { spectralMasterGain: GainNode }).spectralMasterGain = masterGain;
  }

  private startAnmPolyphonic(masterLevel: number) {
    if (!this.ctx || !this.residues.length) return;
    const anm = this.calculateAnmModes();
    if (!anm || anm.frequenciesHz.length === 0) {
      this.startSpectral();
      return;
    }

    const masterGain = this.ctx.createGain();
    masterGain.connect(this.ctx.destination);
    masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(masterLevel / Math.sqrt(anm.frequenciesHz.length), this.ctx.currentTime + 0.4);

    const rng = mulberry32(this.pdbHash ? parseInt(this.pdbHash.slice(0, 8), 16) || 1 : 42);

    anm.frequenciesHz.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = i % 3 === 0 ? 'sine' : i % 3 === 1 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      const amp = anm.amplitudes[i] ?? 1 / anm.frequenciesHz.length;
      gain.gain.value = amp * 0.9;

      if (this.useSpatialAudio && this.residues[0]) {
        const panner = this.ctx!.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        const cx = this.residues.reduce((s, r) => s + r.x, 0) / this.residues.length;
        const cy = this.residues.reduce((s, r) => s + r.y, 0) / this.residues.length;
        const cz = this.residues.reduce((s, r) => s + r.z, 0) / this.residues.length;
        const rx = (this.residues[i % this.residues.length].x - cx) * 0.02 + (rng() - 0.5) * 0.1;
        const ry = (this.residues[i % this.residues.length].y - cy) * 0.02;
        const rz = (this.residues[i % this.residues.length].z - cz) * 0.02;
        panner.positionX.value = Math.max(-2, Math.min(2, rx));
        panner.positionY.value = Math.max(-2, Math.min(2, ry));
        panner.positionZ.value = Math.max(-2, Math.min(2, rz));
        osc.connect(gain);
        gain.connect(panner);
        panner.connect(masterGain);
        this.anmNodes.push({ osc, gain, panner });
      } else {
        osc.connect(gain);
        gain.connect(masterGain);
        this.anmNodes.push({ osc, gain });
      }
      osc.start();
    });

    (this as unknown as { anmMasterGain: GainNode }).anmMasterGain = masterGain;
  }

  private stopSpectral() {
    const spectralMasterGain = (this as unknown as { spectralMasterGain?: GainNode }).spectralMasterGain;
    if (spectralMasterGain) {
      const master = spectralMasterGain;
      master.gain.linearRampToValueAtTime(0, this.ctx!.currentTime + 0.5);
      setTimeout(() => {
        this.spectralNodes.forEach((n) => {
          try {
            n.osc.stop();
          } catch {
            /* */
          }
          try {
            n.osc.disconnect();
          } catch {
            /* */
          }
        });
        this.spectralNodes = [];
        master.disconnect();
      }, 600);
      (this as unknown as { spectralMasterGain?: GainNode }).spectralMasterGain = undefined;
    }
  }

  private stopAnmPolyphonic() {
    const anmMasterGain = (this as unknown as { anmMasterGain?: GainNode }).anmMasterGain;
    if (anmMasterGain) {
      const master = anmMasterGain;
      master.gain.linearRampToValueAtTime(0, this.ctx!.currentTime + 0.35);
      setTimeout(() => {
        this.anmNodes.forEach((n) => {
          try {
            n.osc.stop();
          } catch {
            /* */
          }
          try {
            n.osc.disconnect();
          } catch {
            /* */
          }
          try {
            n.panner?.disconnect();
          } catch {
            /* */
          }
        });
        this.anmNodes = [];
        master.disconnect();
      }, 500);
      (this as unknown as { anmMasterGain?: GainNode }).anmMasterGain = undefined;
    }
  }

  pause() {
    this.isPlaying = false;
    if (this.sonificationMode === 'sequential') {
      if (this.timerID !== null) {
        clearTimeout(this.timerID);
        this.timerID = null;
      }
    } else if (this.sonificationMode === 'spectral') {
      this.stopSpectral();
    } else if (this.sonificationMode === 'nma') {
      this.stopAnmPolyphonic();
    } else if (this.sonificationMode === 'hybrid') {
      if (this.timerID !== null) {
        clearTimeout(this.timerID);
        this.timerID = null;
      }
      this.stopAnmPolyphonic();
    }
  }

  stop() {
    this.pause();
    this.currentResidueIndex = 0;
    if (this.onProgress) this.onProgress(0);
  }

  private scheduler() {
    while (this.nextNoteTime < this.ctx!.currentTime + this.scheduleAheadTime) {
      if (this.currentResidueIndex >= this.residues.length) {
        if (this.loop) {
          this.currentResidueIndex = 0;
        } else {
          break;
        }
      }

      const timeUntilPlay = this.nextNoteTime - this.ctx!.currentTime;
      const indexToPlay = this.currentResidueIndex;
      setTimeout(() => {
        if (this.isPlaying && this.onProgress) {
          this.onProgress(indexToPlay);
        }
      }, Math.max(0, timeUntilPlay * 1000));

      this.scheduleNote(this.currentResidueIndex, this.nextNoteTime, this.ctx!);
      this.nextNote();
    }

    if (this.currentResidueIndex >= this.residues.length && !this.loop) {
      this.isPlaying = false;
      if (this.sonificationMode === 'hybrid') this.stopAnmPolyphonic();
      if (this.onComplete) this.onComplete();
      return;
    }

    if (this.isPlaying) {
      this.timerID = window.setTimeout(() => this.scheduler(), this.lookahead);
    }
  }

  private nextNote() {
    const current = this.residues[this.currentResidueIndex];
    let distance = 3.8;

    if (this.currentResidueIndex < this.residues.length - 1) {
      const next = this.residues[this.currentResidueIndex + 1];
      const dx = current.x - next.x;
      const dy = current.y - next.y;
      const dz = current.z - next.z;
      distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    const bFactor = isNaN(current.bFactor) ? 20 : current.bFactor;
    const bFactorMod = 1 + bFactor / 100;
    const clampedDist = Math.min(Math.max(distance, 2.0), 10.0);
    const durationSec = (this.baseTempoMs / 1000) * (clampedDist / 3.8) * bFactorMod;

    this.nextNoteTime += durationSec;
    this.currentResidueIndex++;
  }

  async export(durationMinutes: number): Promise<Blob> {
    const durationSeconds = durationMinutes * 60;
    const sampleRate = 44100;
    const totalFrames = Math.floor(durationSeconds * sampleRate);

    const offlineCtx = new OfflineAudioContext(1, totalFrames, sampleRate);

    this.scheduleAllNotes(offlineCtx, durationSeconds);

    const audioBuffer = await offlineCtx.startRendering();

    return this.audioBufferToWav(audioBuffer);
  }

  scheduleAllNotes(
    ctx: AudioContext | OfflineAudioContext,
    durationSeconds: number,
    destination?: AudioNode,
    startTime = 0,
    maxSpectralOscillators = 64
  ) {
    if (this.sonificationMode === 'spectral') {
      this.scheduleSpectralNotes(ctx, durationSeconds, destination, startTime, maxSpectralOscillators);
      return;
    }
    if (this.sonificationMode === 'nma') {
      this.scheduleAnmNotes(ctx, durationSeconds, destination, startTime, maxSpectralOscillators);
      return;
    }
    if (this.sonificationMode === 'hybrid') {
      this.scheduleAnmNotes(ctx, durationSeconds, destination, startTime, Math.min(32, maxSpectralOscillators));
      const dest = destination || ctx.destination;
      const sub = ctx.createGain();
      sub.gain.value = 0.35;
      sub.connect(dest);
      this.scheduleSequentialNotes(ctx, durationSeconds, sub, startTime);
      return;
    }

    this.scheduleSequentialNotes(ctx, durationSeconds, destination, startTime);
  }

  private scheduleAnmNotes(
    ctx: AudioContext | OfflineAudioContext,
    durationSeconds: number,
    destination?: AudioNode,
    startTime = 0,
    maxOsc = 64
  ) {
    const anm = this.calculateAnmModes();
    if (!anm || anm.frequenciesHz.length === 0) {
      this.scheduleSpectralNotes(ctx, durationSeconds, destination, startTime, maxOsc);
      return;
    }
    let freqs = anm.frequenciesHz;
    let amps = anm.amplitudes;
    if (freqs.length > maxOsc) {
      const step = Math.floor(freqs.length / maxOsc);
      freqs = freqs.filter((_, i) => i % step === 0).slice(0, maxOsc);
      amps = amps.filter((_, i) => i % step === 0).slice(0, maxOsc);
    }
    const masterGain = ctx.createGain();
    masterGain.connect(destination || ctx.destination);
    masterGain.gain.setValueAtTime(0, startTime);
    masterGain.gain.linearRampToValueAtTime(0.45 / Math.sqrt(freqs.length), startTime + 0.1);
    masterGain.gain.setValueAtTime(0.45 / Math.sqrt(freqs.length), startTime + durationSeconds - 0.1);
    masterGain.gain.linearRampToValueAtTime(0, startTime + durationSeconds);

    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.value = (amps[i] ?? 1 / freqs.length) * 0.9;
      osc.connect(g);
      g.connect(masterGain);
      osc.start(startTime);
      osc.stop(startTime + durationSeconds);
    });
  }

  private scheduleSequentialNotes(
    ctx: AudioContext | OfflineAudioContext,
    durationSeconds: number,
    destination?: AudioNode | undefined,
    startTime = 0
  ) {
    let currentTime = startTime;
    let index = 0;

    const types: OscillatorType[] = ['sine', 'sawtooth', 'triangle'];
    const nodePool = types.map((type) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = type;
      gain.gain.setValueAtTime(0, 0);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(destination || ctx.destination);

      osc.start(0);
      return { osc, gain, filter, type };
    });

    while (currentTime < durationSeconds + startTime) {
      if (index >= this.residues.length) {
        if (this.loop) {
          index = 0;
        } else {
          break;
        }
      }

      const residue = this.residues[index];
      const { freq, type, cutoff, q } = this.residueToAudioParams(residue);

      if (!isNaN(freq) && isFinite(freq)) {
        const node = nodePool.find((n) => n.type === type)!;

        let distance = 3.8;
        if (index < this.residues.length - 1) {
          const next = this.residues[index + 1];
          const dx = residue.x - next.x;
          const dy = residue.y - next.y;
          const dz = residue.z - next.z;
          distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        const bFactor = isNaN(residue.bFactor) ? 20 : residue.bFactor;
        const bFactorMod = 1 + bFactor / 100;
        const clampedDist = Math.min(Math.max(distance, 2.0), 10.0);
        const durationSec = (this.baseTempoMs / 1000) * (clampedDist / 3.8) * bFactorMod;

        node.osc.frequency.setValueAtTime(freq, currentTime);
        node.filter.frequency.setValueAtTime(cutoff, currentTime);
        node.filter.Q.setValueAtTime(q, currentTime);

        node.gain.gain.cancelScheduledValues(currentTime);
        node.gain.gain.setValueAtTime(0, currentTime);
        node.gain.gain.linearRampToValueAtTime(0.22, currentTime + durationSec * 0.08);
        node.gain.gain.exponentialRampToValueAtTime(0.001, currentTime + durationSec * 0.92);

        currentTime += durationSec;
      } else {
        currentTime += this.baseTempoMs / 1000;
      }

      index++;
    }

    nodePool.forEach((n) => {
      try {
        n.osc.stop(currentTime);
      } catch {
        /* */
      }
    });
  }

  private residueToAudioParams(residue: Residue): {
    freq: number;
    type: OscillatorType;
    cutoff: number;
    q: number;
  } {
    const bFactor = isNaN(residue.bFactor) ? 20 : residue.bFactor;
    let freq: number;
    let type: OscillatorType;
    let cutoff: number;
    let q: number;

    if (this.useScientificMapping) {
      const kd = kyteDoolittleValue(residue.resName);
      const baseMidi = 54 + kdToMidiOffset(kd, 24);
      freq = 440 * Math.pow(2, (baseMidi - 69) / 12);
      type = timbreForHydro(hydrophobicCategory(residue.resName));
      cutoff = timbreCutoff(hydrophobicCategory(residue.resName), bFactor);
      q = bFactor > 35 ? 9 + (bFactor - 35) / 20 : 2 + bFactor / 25;
    } else {
      const mass = residue.mass > 0 ? residue.mass : 110;
      freq = this.kConstant / Math.sqrt(mass);
      if (residue.secStruct === 'helix') type = 'sine';
      else if (residue.secStruct === 'sheet') type = 'sawtooth';
      else type = 'triangle';
      cutoff = Math.min(Math.max(500 + bFactor * 50, 200), 10000);
      q = residue.secStruct === 'coil' ? 8 : 2;
    }

    return { freq, type, cutoff, q };
  }

  private scheduleSpectralNotes(
    ctx: AudioContext | OfflineAudioContext,
    durationSeconds: number,
    destination?: AudioNode,
    startTime = 0,
    maxSpectralOscillators = 64
  ) {
    const selectedFreqs = this.calculateSpectralFrequencies();
    if (selectedFreqs.length === 0) return;

    let finalFreqs = selectedFreqs;
    if (finalFreqs.length > maxSpectralOscillators) {
      finalFreqs = [];
      const step = Math.floor(selectedFreqs.length / maxSpectralOscillators);
      for (let i = 0; i < maxSpectralOscillators; i++) finalFreqs.push(selectedFreqs[i * step]);
    }

    const masterGain = ctx.createGain();
    masterGain.connect(destination || ctx.destination);
    masterGain.gain.setValueAtTime(0, startTime);
    masterGain.gain.linearRampToValueAtTime(0.5 / Math.sqrt(finalFreqs.length), startTime + 0.1);
    masterGain.gain.setValueAtTime(0.5 / Math.sqrt(finalFreqs.length), startTime + durationSeconds - 0.1);
    masterGain.gain.linearRampToValueAtTime(0, startTime + durationSeconds);

    finalFreqs.forEach((f) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.value = 1.0 / finalFreqs.length;
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(startTime);
      osc.stop(startTime + durationSeconds);
    });
  }

  public audioBufferToWav(buffer: AudioBuffer): Blob {
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numberOfChannels * 2;
    const bufferData = new ArrayBuffer(44 + length);
    const view = new DataView(bufferData);

    view.setUint32(0, 0x52494646, false);
    view.setUint32(4, 36 + length, true);
    view.setUint32(8, 0x57415645, false);
    view.setUint32(12, 0x666d7420, false);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2 * numberOfChannels, true);
    view.setUint16(32, numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461, false);
    view.setUint32(40, length, true);

    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    return new Blob([bufferData], { type: 'audio/wav' });
  }

  public async audioBufferToWavAsync(buffer: AudioBuffer, onProgress?: (p: number) => void): Promise<Blob> {
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numberOfChannels * 2;
    const bufferData = new ArrayBuffer(44 + length);
    const view = new DataView(bufferData);

    view.setUint32(0, 0x52494646, false);
    view.setUint32(4, 36 + length, true);
    view.setUint32(8, 0x57415645, false);
    view.setUint32(12, 0x666d7420, false);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2 * numberOfChannels, true);
    view.setUint16(32, numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461, false);
    view.setUint32(40, length, true);

    const channelData = buffer.getChannelData(0);
    const chunkSize = 100000;

    for (let i = 0; i < buffer.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, buffer.length);
      for (let j = i; j < end; j++) {
        const sample = Math.max(-1, Math.min(1, channelData[j]));
        view.setInt16(44 + j * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
      if (onProgress) onProgress(end / buffer.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return new Blob([bufferData], { type: 'audio/wav' });
  }

  private scheduleNote(index: number, time: number, ctx: AudioContext | OfflineAudioContext, destination?: AudioNode) {
    const residue = this.residues[index];
    const { freq, type, cutoff, q } = this.residueToAudioParams(residue);

    if (isNaN(freq) || !isFinite(freq)) return;

    const out: AudioNode = destination || ctx.destination;

    let distance = 3.8;
    if (index < this.residues.length - 1) {
      const next = this.residues[index + 1];
      distance = Math.sqrt(
        Math.pow(residue.x - next.x, 2) + Math.pow(residue.y - next.y, 2) + Math.pow(residue.z - next.z, 2)
      );
    }
    const bFactor = isNaN(residue.bFactor) ? 20 : residue.bFactor;
    const bFactorMod = 1 + bFactor / 100;
    const clampedDist = Math.min(Math.max(distance, 2.0), 10.0);
    const durationSec = (this.baseTempoMs / 1000) * (clampedDist / 3.8) * bFactorMod;

    if (ctx instanceof AudioContext && this.useSpatialAudio) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = type;
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      filter.Q.value = q;
      const panner = this.buildSpatialChain(ctx, residue, out);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.22, time + durationSec * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, time + durationSec * 0.92);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      osc.start(time);
      osc.stop(time + durationSec);
      return;
    }

    if (ctx instanceof AudioContext) {
      const voice = this.getVoice(type);
      if (voice) {
        voice.busy = true;
        voice.osc.frequency.setValueAtTime(freq, time);
        voice.filter.frequency.setValueAtTime(cutoff, time);
        voice.filter.Q.setValueAtTime(q, time);

        voice.gain.gain.cancelScheduledValues(time);
        voice.gain.gain.setValueAtTime(0, time);
        voice.gain.gain.linearRampToValueAtTime(0.22, time + durationSec * 0.08);
        voice.gain.gain.exponentialRampToValueAtTime(0.001, time + durationSec * 0.92);

        setTimeout(() => {
          voice.busy = false;
        }, durationSec * 1000);
        return;
      }
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = q;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.22, time + durationSec * 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, time + durationSec * 0.92);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(time);
    osc.stop(time + durationSec);
  }

  private buildSpatialChain(ctx: AudioContext, residue: Residue, destination: AudioNode): PannerNode {
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    const cx = this.residues.reduce((s, r) => s + r.x, 0) / this.residues.length;
    const cy = this.residues.reduce((s, r) => s + r.y, 0) / this.residues.length;
    const cz = this.residues.reduce((s, r) => s + r.z, 0) / this.residues.length;
    const nx = (residue.x - cx) * 0.03;
    const ny = (residue.y - cy) * 0.03;
    const nz = (residue.z - cz) * 0.03;
    panner.positionX.value = Math.max(-2, Math.min(2, nx));
    panner.positionY.value = Math.max(-2, Math.min(2, ny));
    panner.positionZ.value = Math.max(-2, Math.min(2, nz));
    panner.connect(destination);
    return panner;
  }

  setKConstant(k: number) {
    this.kConstant = k;
  }

  setTempo(tempo: number) {
    this.baseTempoMs = tempo;
  }
}

function timbreForHydro(cat: HydrophobicCategory): OscillatorType {
  switch (cat) {
    case 'very_hydrophobic':
      return 'sine';
    case 'hydrophobic':
      return 'sawtooth';
    case 'neutral':
      return 'triangle';
    case 'hydrophilic':
      return 'triangle';
    default:
      return 'sine';
  }
}

function timbreCutoff(cat: HydrophobicCategory, bFactor: number): number {
  const base =
    cat === 'very_hydrophobic'
      ? 900
      : cat === 'hydrophobic'
        ? 2200
        : cat === 'neutral'
          ? 4000
          : 6500;
  return Math.min(12000, base + bFactor * 40);
}
