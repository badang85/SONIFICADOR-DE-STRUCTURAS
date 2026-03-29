import { Midi } from '@tonejs/midi';
import type { Residue } from './pdbParser';
import {
  hydrophobicCategory,
  kdToMidiOffset,
  kyteDoolittleValue,
  type HydrophobicCategory,
} from './kyteDoolittle';
import type { AnmResult } from './nma/anm';
import { referencesForExport } from './scientificReferences';

/** GM program numbers (melodic); percusión en canal 10. */
const GM = {
  acousticGrandPiano: 0,
  violin: 40,
  trumpet: 56,
  xylophone: 13,
};

function categoryToInstrument(cat: ReturnType<typeof hydrophobicCategory>): number {
  switch (cat) {
    case 'very_hydrophobic':
      return GM.acousticGrandPiano;
    case 'hydrophobic':
      return GM.violin;
    case 'neutral':
      return GM.trumpet;
    case 'hydrophilic':
      return GM.xylophone;
    default:
      return GM.trumpet;
  }
}

function addNmaTrack(midi: Midi, anm: AnmResult | null, totalSeconds: number) {
  if (!anm || anm.frequenciesHz.length === 0) return;
  const track = midi.addTrack();
  track.name = 'NMA (ANM modes)';
  track.channel = 0;
  track.instrument.number = GM.acousticGrandPiano;
  const step = totalSeconds / (anm.frequenciesHz.length + 1);
  let time = 0;
  for (let i = 0; i < anm.frequenciesHz.length; i++) {
    const f = Math.max(20, anm.frequenciesHz[i]);
    const midiNote = Math.min(127, Math.max(21, Math.round(69 + 12 * Math.log2(f / 440))));
    const vel = Math.min(0.85, 0.25 + anm.amplitudes[i] * 12);
    const dur = Math.min(step * 3, totalSeconds - time);
    track.addNote({
      midi: midiNote,
      time,
      duration: Math.max(0.05, dur),
      velocity: vel,
    });
    time += step;
  }
}

/** Cuatro pistas melódicas por categoría hidrofóbica (timbres GM distintos). */
function addSequenceTracksByHydrophobicity(midi: Midi, residues: Residue[], baseMidi: number, secondsPerResidue: number) {
  const buckets: Record<string, Residue[]> = {
    very_hydrophobic: [],
    hydrophobic: [],
    neutral: [],
    hydrophilic: [],
  };
  for (const r of residues) {
    buckets[hydrophobicCategory(r.resName)].push(r);
  }
  (Object.keys(buckets) as HydrophobicCategory[]).forEach((cat, idx) => {
    const list = buckets[cat];
    if (list.length === 0) return;
    const track = midi.addTrack();
    track.name = `KD ${cat}`;
    track.channel = Math.min(15, 1 + idx);
    track.instrument.number = categoryToInstrument(cat);
    let time = 0;
    for (const r of list) {
      const kd = kyteDoolittleValue(r.resName);
      const note = baseMidi + kdToMidiOffset(kd);
      const b = isNaN(r.bFactor) ? 20 : r.bFactor;
      const dur = secondsPerResidue * (1 + b / 200);
      track.addNote({
        midi: Math.min(127, Math.max(0, note)),
        time,
        duration: dur,
        velocity: 0.55,
      });
      time += dur;
    }
  });
}

function addStructureTrack(midi: Midi, residues: Residue[], secondsPerResidue: number) {
  const track = midi.addTrack();
  track.channel = 9;
  track.name = 'Secondary structure (drums)';
  let time = 0;
  const drum: Record<string, number> = { helix: 36, sheet: 40, coil: 42 };
  for (const r of residues) {
    const b = isNaN(r.bFactor) ? 20 : r.bFactor;
    const dur = secondsPerResidue * (1 + b / 200);
    track.addNote({
      midi: drum[r.secStruct] ?? 42,
      time,
      duration: Math.min(0.12, dur * 0.4),
      velocity: 0.45,
    });
    time += dur;
  }
}

export interface MidiExportParams {
  residues: Residue[];
  anm: AnmResult | null;
  pdbId: string;
  baseMidi?: number;
  secondsPerResidue?: number;
}

export function buildScientificMidi(params: MidiExportParams): Uint8Array {
  const { residues, anm, pdbId } = params;
  const baseMidi = params.baseMidi ?? 48;
  const secondsPerResidue = params.secondsPerResidue ?? 0.12;

  const totalSec = Math.max(
    residues.reduce((s, r) => {
      const b = isNaN(r.bFactor) ? 20 : r.bFactor;
      return s + secondsPerResidue * (1 + b / 200);
    }, 0),
    2
  );

  const midi = new Midi();
  midi.header.setTempo(120);
  midi.header.name = `Protein ${pdbId}`;
  midi.header.meta.push({
    text: referencesForExport().join(' | '),
    type: 'text',
    ticks: 0,
  });

  addNmaTrack(midi, anm, totalSec);
  addSequenceTracksByHydrophobicity(midi, residues, baseMidi, secondsPerResidue);
  addStructureTrack(midi, residues, secondsPerResidue);

  return midi.toArray();
}

export function midiToBlob(params: MidiExportParams): Blob {
  const buf = buildScientificMidi(params);
  return new Blob([buf], { type: 'audio/midi' });
}
