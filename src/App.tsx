import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Activity, Settings2, DownloadCloud, Plus, X, Repeat, ListMusic, Sparkles, FileJson, Music } from 'lucide-react';
import { parsePDBWithMeta, Residue, type SSBond } from './lib/pdbParser';
import { parseSDF } from './lib/sdfParser';
import { ProteinSonifier, type SonificationMode } from './lib/audioSynth';
import { fnv1a32 } from './lib/pdbHash';
import { buildConnectivityGraph } from './lib/connectivity';
import { midiToBlob } from './lib/midiExport';
import { buildSonificationJson } from './lib/exportMetadata';
import { generateSonificationInsight } from './lib/geminiInsights';

interface Structure {
  id: string;
  pdbId: string;
  name: string;
  residues: Residue[];
  sonifier: ProteinSonifier;
  currentIndex: number;
  totalDuration: number;
  type?: string;
  pdbHash: string;
  ssbonds: SSBond[];
}

interface SavedList {
  id: string;
  name: string;
  structures: Omit<Structure, 'sonifier'>[];
}

interface StructureCardProps {
  structure: Structure;
  onRemove: (id: string) => void;
  isActive: boolean;
  onSelect: () => void;
  onExportMidi?: () => void;
  onExportJson?: () => void;
  key?: string;
}

const StructureCard = ({ structure, onRemove, isActive, onSelect, onExportMidi, onExportJson }: StructureCardProps) => {
  const [duration, setDuration] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const handleExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setExporting(true);
    setExportProgress(0);
    const interval = setInterval(() => {
      setExportProgress(prev => Math.min(prev + 5, 95));
    }, 100);

    try {
      const blob = await structure.sonifier.export(duration);
      clearInterval(interval);
      setExportProgress(100);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${structure.pdbId}_${structure.name.replace(/\s+/g, '_')}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      clearInterval(interval);
      setTimeout(() => {
        setExporting(false);
        setExportProgress(0);
      }, 500);
    }
  };

  const progress = (structure.currentIndex / structure.residues.length) * 100;

  return (
    <div 
      onClick={onSelect}
      className={`group relative flex flex-col p-4 rounded-xl border transition-all cursor-pointer ${
        isActive 
          ? 'bg-emerald-500/10 border-emerald-500/50 ring-1 ring-emerald-500/20' 
          : 'bg-zinc-900/40 border-zinc-800/50 hover:border-zinc-700'
      }`}
    >
      <div className="flex justify-between items-start gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
              {structure.pdbId}
            </span>
            {structure.type && (
              <span className="text-[10px] text-emerald-500/70 font-medium uppercase tracking-wider">
                {structure.type}
              </span>
            )}
          </div>
          <h3 className="text-sm font-medium text-zinc-200 truncate leading-tight" title={structure.name}>
            {structure.name}
          </h3>
        </div>
        <button 
          onClick={(e) => { e.stopPropagation(); onRemove(structure.id); }} 
          className="text-zinc-600 hover:text-red-400 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-3 mt-auto pt-3 border-t border-zinc-800/50">
        <div className="flex-1 h-1 bg-zinc-950 rounded-full overflow-hidden">
          <div 
            className="h-full bg-emerald-500 transition-all duration-300" 
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={handleExport}
            className="p-1.5 text-zinc-500 hover:text-emerald-400 rounded-md hover:bg-zinc-800 transition-colors"
            title="Export WAV"
          >
            <DownloadCloud className="w-4 h-4" />
          </button>
          {onExportMidi && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onExportMidi(); }} className="p-1.5 text-zinc-500 hover:text-amber-400 rounded-md hover:bg-zinc-800 transition-colors" title="Export MIDI">
              <Music className="w-4 h-4" />
            </button>
          )}
          {onExportJson && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onExportJson(); }} className="p-1.5 text-zinc-500 hover:text-sky-400 rounded-md hover:bg-zinc-800 transition-colors" title="Export JSON metadata">
              <FileJson className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {exporting && (
        <div className="absolute inset-0 bg-zinc-950/90 rounded-xl flex items-center justify-center p-4 z-20">
          <div className="w-full max-w-[120px]">
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${exportProgress}%` }} />
            </div>
            <p className="text-[8px] text-center text-emerald-500 font-mono uppercase tracking-tighter">Exporting...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [newPdbId, setNewPdbId] = useState('1CRN');
  const [structures, setStructures] = useState<Structure[]>([]);
  const [savedLists, setSavedLists] = useState<SavedList[]>(() => {
    const saved = localStorage.getItem('savedLists');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to load saved lists', e);
      }
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('savedLists', JSON.stringify(savedLists));
  }, [savedLists]);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [playMode, setPlayMode] = useState<'all' | 'series'>('all');
  const [sonificationMode, setSonificationMode] = useState<SonificationMode>('sequential');
  const [scientificMapping, setScientificMapping] = useState(true);
  const [spatialAudio, setSpatialAudio] = useState(true);
  const [geminiInsight, setGeminiInsight] = useState<string | null>(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  
  const [kConstant, setKConstant] = useState(8000);
  const [tempo, setTempo] = useState(150);

  const [exportAllProgress, setExportAllProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  
  const [logs, setLogs] = useState<{ id: number, msg: string, type: 'info' | 'error' | 'success' }[]>([]);
  const addLog = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    setLogs(prev => [{ id: Date.now() + Math.random(), msg, type }, ...prev].slice(0, 50));
  };

  useEffect(() => {
    structures.forEach(s => {
      s.sonifier.setKConstant(kConstant);
      s.sonifier.setTempo(tempo);
      s.sonifier.loop = loop;
      s.sonifier.setMode(sonificationMode);
      s.sonifier.useScientificMapping = scientificMapping;
      s.sonifier.useSpatialAudio = spatialAudio;
    });
  }, [kConstant, tempo, loop, structures, sonificationMode, scientificMapping, spatialAudio]);

  const calculateTotalDuration = (residues: Residue[], tempoMs: number) => {
    let duration = 0;
    for (let i = 0; i < residues.length; i++) {
      const current = residues[i];
      let distance = 3.8;
      if (i < residues.length - 1) {
        const next = residues[i + 1];
        const dx = current.x - next.x;
        const dy = current.y - next.y;
        const dz = current.z - next.z;
        distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
      }
      const clampedDist = Math.min(Math.max(distance, 2.0), 10.0);
      duration += (tempoMs / 1000) * (clampedDist / 3.8);
    }
    return duration;
  };

  const [selectedStructureId, setSelectedStructureId] = useState<string | null>(null);

  const saveCurrentList = (name: string) => {
    const newList: SavedList = {
      id: Date.now().toString(),
      name,
      structures: structures.map(s => ({
        id: s.id,
        pdbId: s.pdbId,
        name: s.name,
        residues: s.residues,
        currentIndex: s.currentIndex,
        totalDuration: s.totalDuration,
        type: s.type,
        pdbHash: s.pdbHash,
        ssbonds: s.ssbonds,
      }))
    };
    setSavedLists(prev => [...prev, newList]);
  };

  const loadList = (list: SavedList) => {
    structures.forEach(s => s.sonifier.stop());
    
    const newStructures = list.structures.map(s => {
      const sonifier = new ProteinSonifier();
      sonifier.load(s.residues, s.pdbHash ?? '');
      sonifier.setKConstant(kConstant);
      sonifier.setTempo(tempo);
      sonifier.loop = loop;
      sonifier.setMode(sonificationMode);
      sonifier.useScientificMapping = scientificMapping;
      sonifier.useSpatialAudio = spatialAudio;
      return {
        ...s,
        sonifier,
        pdbHash: s.pdbHash ?? '',
        ssbonds: s.ssbonds ?? [],
      };
    });
    setStructures(newStructures);
    if (newStructures.length > 0) setSelectedStructureId(newStructures[0].id);
  };

  const deleteList = (id: string) => {
    setSavedLists(prev => prev.filter(l => l.id !== id));
  };

  const [listName, setListName] = useState('');
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editingListName, setEditingListName] = useState('');

  const startEditing = (list: SavedList) => {
    setEditingListId(list.id);
    setEditingListName(list.name);
  };

  const saveEdit = () => {
    if (editingListId) {
      setSavedLists(prev => prev.map(l => l.id === editingListId ? { ...l, name: editingListName } : l));
      setEditingListId(null);
    }
  };

  const fetchMetadata = async (id: string, source: 'rcsb' | 'pubchem' = 'rcsb') => {
    try {
      if (source === 'rcsb') {
        const res = await fetch(`https://data.rcsb.org/rest/v1/core/entry/${id.toUpperCase()}`);
        if (res.ok) {
          const data = await res.json();
          return {
            name: data.struct?.title || 'Unknown Protein',
            type: data.struct_keywords?.pdbx_keywords || 'Protein'
          };
        }
      } else {
        const res = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${id}/description/JSON`);
        if (res.ok) {
          const data = await res.json();
          const compound = data.InformationList?.Information?.[0];
          return {
            name: compound?.Title || `Compound ${id}`,
            type: 'Small Molecule'
          };
        }
      }
    } catch (e) {}
    return { name: source === 'rcsb' ? 'Protein Structure' : `Compound ${id}`, type: source === 'rcsb' ? 'Biological' : 'Chemical' };
  };

  const addStructures = async () => {
    const ids = newPdbId.split(',').map(id => id.trim()).filter(id => id.length > 0);
    if (ids.length === 0) return;
    
    setLoading(true);
    setLoadingProgress(1);
    setLoadingStatus(`Initializing ${ids.length} structures...`);
    addLog(`Iniciando carga de ${ids.length} estructuras...`, 'info');
    setError(null);
    const errors: string[] = [];
    const concurrencyLimit = 5;
    let completedCount = 0;
    
    const processId = async (id: string): Promise<Structure | null> => {
      let metadata = { name: 'Structure', type: 'Unknown' };
      try {
        let text = '';
        let isPDB = false;
        
        // Try RCSB PDB
        const pdbRes = await fetch(`https://files.rcsb.org/download/${id.toUpperCase()}.pdb`);
        if (pdbRes.ok) {
          text = await pdbRes.text();
          metadata = await fetchMetadata(id, 'rcsb');
          isPDB = true;
        } else {
          // Try RCSB Ligand
          const sdfRes = await fetch(`https://files.rcsb.org/ligands/download/${id.toUpperCase()}_ideal.sdf`);
          if (sdfRes.ok) {
            text = await sdfRes.text();
            metadata = { name: id.toUpperCase(), type: 'Ligand' };
          } else {
            // Try PubChem CID
            const pcRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${id}/SDF`);
            if (pcRes.ok) {
              text = await pcRes.text();
              metadata = await fetchMetadata(id, 'pubchem');
            } else {
              throw new Error(`${id}: Not found`);
            }
          }
        }
        
        let residues: Residue[] = [];
        let ssbonds: SSBond[] = [];
        if (isPDB) {
          const meta = parsePDBWithMeta(text);
          residues = meta.residues;
          ssbonds = meta.ssbonds;
        } else {
          residues = parseSDF(text);
        }
        if (residues.length === 0) throw new Error(`${id}: No atoms found`);

        const pdbHash = fnv1a32(text);
        const sonifier = new ProteinSonifier();
        sonifier.load(residues, pdbHash);
        sonifier.setKConstant(kConstant);
        sonifier.setTempo(tempo);
        sonifier.loop = loop;

        return {
          id: `${id}-${Date.now()}-${Math.random()}`,
          pdbId: id.toUpperCase(),
          name: metadata.name,
          type: metadata.type,
          residues,
          ssbonds,
          pdbHash,
          sonifier,
          currentIndex: 0,
          totalDuration: calculateTotalDuration(residues, tempo)
        };
      } catch (err: any) {
        errors.push(err.message);
        return null;
      } finally {
        completedCount++;
        const progress = (completedCount / ids.length) * 100;
        setLoadingProgress(progress);
        setLoadingStatus(`Loading: ${completedCount}/${ids.length} (${Math.round(progress)}%)`);
        addLog(`Cargado ${id}: ${metadata.name} (${completedCount}/${ids.length})`, 'success');
      }
    };

    // Process in chunks of concurrencyLimit
    for (let i = 0; i < ids.length; i += concurrencyLimit) {
      const chunk = ids.slice(i, i + concurrencyLimit);
      const results = await Promise.all(chunk.map(id => processId(id)));
      const successful = results.filter((s): s is Structure => s !== null);
      
      // Pre-calculate spectral frequencies for successful ones
      successful.forEach(s => {
        s.sonifier.calculateSpectralFrequencies();
        s.sonifier.calculateAnmModes();
      });
      
      if (successful.length > 0) {
        setStructures(prev => {
          const newState = [...prev, ...successful];
          // Set selection if nothing is selected yet
          if (!selectedStructureId && newState.length > 0) {
            setSelectedStructureId(newState[0].id);
          }
          return newState;
        });
      }
    }
    
    if (errors.length > 0) setError(errors.join(', '));
    setNewPdbId('');
    setLoading(false);
    setTimeout(() => setLoadingProgress(0), 1000);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    
    setLoading(true);
    setLoadingProgress(1);
    const fileList = Array.from(files) as File[];
    setLoadingStatus(`Preparing ${fileList.length} files...`);
    addLog(`Preparando subida de ${fileList.length} archivos locales...`, 'info');
    setError(null);
    const errors: string[] = [];
    const concurrencyLimit = 3; // Lower for local files to avoid overwhelming the JS thread
    let completedCount = 0;

    const processFile = async (file: File): Promise<Structure | null> => {
      try {
        const text = await file.text();
        const isPDB = file.name.toLowerCase().endsWith('.pdb');
        const isSDF = file.name.toLowerCase().endsWith('.sdf') || file.name.toLowerCase().endsWith('.mol');
        
        let residues: Residue[] = [];
        let ssbonds: SSBond[] = [];
        if (isPDB) {
          const meta = parsePDBWithMeta(text);
          residues = meta.residues;
          ssbonds = meta.ssbonds;
        } else if (isSDF) {
          residues = parseSDF(text);
        } else {
          if (text.includes('HEADER') || text.includes('ATOM  ')) {
            const meta = parsePDBWithMeta(text);
            residues = meta.residues;
            ssbonds = meta.ssbonds;
          } else if (text.includes('V2000') || text.includes('V3000')) {
            residues = parseSDF(text);
          } else {
            throw new Error(`${file.name}: Unknown format`);
          }
        }

        if (residues.length === 0) throw new Error(`${file.name}: No atoms found`);

        const pdbHash = fnv1a32(text);
        const sonifier = new ProteinSonifier();
        sonifier.load(residues, pdbHash);
        sonifier.setKConstant(kConstant);
        sonifier.setTempo(tempo);
        sonifier.loop = loop;

        return {
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          pdbId: file.name.split('.')[0].toUpperCase(),
          name: file.name,
          type: isPDB ? 'Local PDB' : 'Local SDF',
          residues,
          ssbonds,
          pdbHash,
          sonifier,
          currentIndex: 0,
          totalDuration: calculateTotalDuration(residues, tempo)
        };
      } catch (err: any) {
        errors.push(err.message);
        return null;
      } finally {
        completedCount++;
        const progress = (completedCount / fileList.length) * 100;
        setLoadingProgress(progress);
        setLoadingStatus(`Files: ${completedCount}/${fileList.length} (${Math.round(progress)}%)`);
        addLog(`Procesado archivo: ${file.name} (${completedCount}/${fileList.length})`, 'success');
      }
    };

    for (let i = 0; i < fileList.length; i += concurrencyLimit) {
      const chunk = fileList.slice(i, i + concurrencyLimit);
      const results = await Promise.all(chunk.map(file => processFile(file)));
      const successful = results.filter((s): s is Structure => s !== null);

      if (successful.length > 0) {
        // Pre-calculate spectral frequencies for successful ones
        successful.forEach(s => {
          s.sonifier.calculateSpectralFrequencies();
          s.sonifier.calculateAnmModes();
        });
        setStructures(prev => {
          const newState = [...prev, ...successful];
          if (!selectedStructureId && newState.length > 0) {
            setSelectedStructureId(newState[0].id);
          }
          return newState;
        });
      }
    }
    
    if (errors.length > 0) setError(errors.join(', '));
    setLoading(false);
    setLoadingStatus('');
    setTimeout(() => setLoadingProgress(0), 1000);
  };

  const exportStructureMidi = (s: Structure) => {
    const anm = s.sonifier.calculateAnmModes();
    const blob = midiToBlob({ residues: s.residues, anm, pdbId: s.pdbId });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${s.pdbId}_sonification.mid`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`MIDI exportado: ${s.pdbId}`, 'success');
  };

  const exportStructureJson = (s: Structure) => {
    const anm = s.sonifier.calculateAnmModes();
    const edges = buildConnectivityGraph(s.residues, s.ssbonds);
    const json = buildSonificationJson({
      pdbId: s.pdbId,
      pdbHash: s.pdbHash,
      residues: s.residues,
      ssbonds: s.ssbonds,
      edges,
      anm,
      method: sonificationMode,
    });
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${s.pdbId}_sonification_metadata.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`JSON exportado: ${s.pdbId}`, 'success');
  };

  const runGeminiInsight = async () => {
    const s = structures.find((st) => st.id === selectedStructureId);
    if (!s) return;
    setGeminiLoading(true);
    setGeminiInsight(null);
    try {
      const anm = s.sonifier.calculateAnmModes();
      const text = await generateSonificationInsight({
        pdbId: s.pdbId,
        title: s.name,
        residueCount: s.residues.length,
        sonificationMethod: sonificationMode,
        nmaModeCount: anm?.frequenciesHz.length,
      });
      setGeminiInsight(text);
      addLog('Insight Gemini generado', 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setGeminiInsight(`Error: ${msg}`);
      addLog(`Gemini: ${msg}`, 'error');
    } finally {
      setGeminiLoading(false);
    }
  };

  const removeStructure = (id: string) => {
    setStructures(prev => {
      const filtered = prev.filter(s => s.id !== id);
      const removed = prev.find(s => s.id === id);
      if (removed) removed.sonifier.stop();
      return filtered;
    });
    if (selectedStructureId === id) setSelectedStructureId(null);
  };

  const playSequential = (index: number) => {
    if (index >= structures.length) {
      setIsPlaying(false);
      return;
    }
    const s = structures[index];
    s.sonifier.onProgress = (idx) => {
      setStructures(prev => prev.map(st => st.id === s.id ? { ...st, currentIndex: idx } : st));
    };
    s.sonifier.onComplete = () => {
      playSequential(index + 1);
    };
    s.sonifier.play();
  };

  const handlePlay = () => {
    setIsPlaying(true);
    if (playMode === 'all') {
      structures.forEach(s => {
        s.sonifier.onProgress = (idx) => {
          setStructures(prev => prev.map(st => st.id === s.id ? { ...st, currentIndex: idx } : st));
        };
        s.sonifier.play();
      });
    } else {
      playSequential(0);
    }
  };

  const handlePause = () => {
    setIsPlaying(false);
    structures.forEach(s => s.sonifier.pause());
  };

  const handleDownloadSeries = async () => {
    for (const s of structures) {
      const blob = await s.sonifier.export(1);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${s.pdbId}_${s.name.replace(/\s+/g, '_')}.wav`;
      a.click();
      URL.revokeObjectURL(url);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  };

  const handleExportAll = async () => {
    if (structures.length === 0) return;
    setLoading(true);
    setExportAllProgress(0);
    setDownloadUrl(null);
    addLog(`Iniciando exportación de ${structures.length} estructuras...`, 'info');
    
    try {
      // Calculate duration and offsets
      let totalDurationSeconds = 0;
      const structureData = structures.map(s => {
        const start = playMode === 'series' ? totalDurationSeconds : 0;
        const duration = s.totalDuration;
        if (playMode === 'series') totalDurationSeconds += duration;
        else totalDurationSeconds = Math.max(totalDurationSeconds, duration);
        return { structure: s, start, duration };
      });
      
      const durationSeconds = Math.min(totalDurationSeconds, 600); // Cap at 10 mins for safety
      addLog(`Duración total: ${Math.round(durationSeconds)}s. Modo: ${playMode}.`, 'info');
      
      const sampleRate = 44100;
      const totalFrames = Math.floor(durationSeconds * sampleRate);
      const offlineCtx = new OfflineAudioContext(1, totalFrames, sampleRate);
      
      const masterGain = offlineCtx.createGain();
      masterGain.gain.value = 1 / Math.sqrt(playMode === 'all' ? structures.length : 1);
      masterGain.connect(offlineCtx.destination);
      
      // Dynamic oscillator budget to avoid context hang
      // Browser typically handles a few hundred nodes well. 1000-2000 is often a limit.
      const totalOscBudget = 1000;
      const oscPerProtein = playMode === 'series' ? 64 : Math.max(8, Math.floor(totalOscBudget / structures.length));
      
      addLog(`Programando ${structures.length} estructuras (Límite: ${oscPerProtein} osc/prot)...`, 'info');
      
      for (let i = 0; i < structureData.length; i++) {
        const { structure, start, duration } = structureData[i];
        if (start < durationSeconds) {
          structure.sonifier.scheduleAllNotes(
            offlineCtx, 
            Math.min(duration, durationSeconds - start), 
            masterGain, 
            start,
            oscPerProtein
          );
        }
        
        if (i % 5 === 0 || structures.length < 10) {
          setExportAllProgress(Math.round((i / structures.length) * 20));
          addLog(`  > Programando: [${structure.pdbId}] ${structure.name.substring(0, 20)}...`, 'info');
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      
      addLog(`Iniciando renderizado de AudioBuffer...`, 'info');
      setExportAllProgress(25);
      
      const audioBuffer = await offlineCtx.startRendering();
      addLog(`Renderizado completado satisfactoriamente.`, 'success');
      setExportAllProgress(50);
      
      // Optimization: split WAV encoding to avoid main thread hang
      const blob = await structures[0].sonifier.audioBufferToWavAsync(audioBuffer, (p) => {
        setExportAllProgress(50 + Math.round(p * 0.5)); // Last 50% is encoding
      });
      
      addLog(`Codificación WAV terminada (${(blob.size / 1024 / 1024).toFixed(2)} MB).`, 'success');
      setExportAllProgress(100);
      
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      
      // Attempt auto-download
      const a = document.createElement('a');
      a.href = url;
      a.download = `sonificacion_conjunta.wav`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
      }, 1000);
      addLog(`¡Descarga iniciada!`, 'success');
      
    } catch (e: any) {
      console.error('Export error:', e);
      addLog(`Error en exportación: ${e.message}`, 'error');
      alert('Error al exportar el audio. Intente con menos estructuras o una duración menor.');
    } finally {
      setTimeout(() => {
        setLoading(false);
        setExportAllProgress(0);
      }, 2000);
    }
  };

  const clearAll = () => {
    structures.forEach(s => s.sonifier.stop());
    setStructures([]);
    setError(null);
  };

  const handleStop = () => {
    setIsPlaying(false);
    structures.forEach(s => {
      s.sonifier.stop();
      setStructures(prev => prev.map(st => st.id === s.id ? { ...st, currentIndex: 0 } : st));
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30">
      <div className="max-w-6xl mx-auto p-6 md:p-12">
        
        <header className="mb-12 border-b border-zinc-800 pb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                <Activity className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">Protein Sonifier</h1>
                <p className="text-zinc-400 text-sm mt-1">Simultaneous multi-structure sonification</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Playback</label>
                <select 
                  value={playMode} 
                  onChange={(e) => setPlayMode(e.target.value as 'all' | 'series')}
                  className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-[10px] font-bold py-1.5 px-3 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500/50 uppercase tracking-tighter"
                >
                  <option value="all">Simultaneous</option>
                  <option value="series">Sequential</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Sonification</label>
                <select 
                  value={sonificationMode} 
                  onChange={(e) => setSonificationMode(e.target.value as SonificationMode)}
                  className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-[10px] font-bold py-1.5 px-3 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500/50 uppercase tracking-tighter max-w-[160px]"
                >
                  <option value="sequential">Sequential (KD)</option>
                  <option value="spectral">Spectral (graph)</option>
                  <option value="nma">NMA / ANM</option>
                  <option value="hybrid">Hybrid NMA+seq</option>
                </select>
              </div>

              <button 
                onClick={() => setLoop(!loop)} 
                className={`mt-4 p-2.5 rounded-lg border transition-all ${loop ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}
                title="Toggle Loop"
              >
                <Repeat className="w-4 h-4" />
              </button>

              <div className="h-10 w-px bg-zinc-800 mx-2 mt-4" />

              {!isPlaying ? (
                <button onClick={handlePlay} disabled={structures.length === 0} className="mt-4 w-12 h-12 rounded-full bg-emerald-500 text-zinc-950 flex items-center justify-center hover:bg-emerald-400 disabled:opacity-50 transition-colors shadow-lg shadow-emerald-500/20">
                  <Play className="w-5 h-5 ml-1" />
                </button>
              ) : (
                <button onClick={handlePause} className="mt-4 w-12 h-12 rounded-full bg-amber-500 text-zinc-950 flex items-center justify-center hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/20">
                  <Pause className="w-5 h-5" />
                </button>
              )}
              <button onClick={handleStop} className="mt-4 w-10 h-10 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center hover:bg-zinc-700 transition-colors">
                <Square className="w-4 h-4" />
              </button>
              
              <div className="h-10 w-px bg-zinc-800 mx-2 mt-4" />

              <div className="relative mt-4">
                <button 
                  onClick={handleExportAll} 
                  disabled={structures.length === 0 || loading}
                  className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-500 disabled:opacity-50 transition-colors relative overflow-hidden"
                  title="Export Combined WAV"
                >
                  {loading && exportAllProgress > 0 ? (
                    <div className="absolute inset-0 bg-emerald-900 flex items-end">
                      <div className="bg-emerald-400 w-full transition-all duration-300" style={{ height: `${exportAllProgress}%` }} />
                    </div>
                  ) : (
                    <DownloadCloud className="w-4 h-4 relative z-10" />
                  )}
                </button>
              </div>
              <button 
                  onClick={handleDownloadSeries} 
                  disabled={structures.length === 0 || loading}
                  className="mt-4 w-10 h-10 rounded-full bg-emerald-800 text-white flex items-center justify-center hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  title="Download Individual WAVs"
                >
                  <ListMusic className="w-4 h-4" />
                </button>
            </div>
          </div>
          {isPlaying && (
            <div className="mt-6 flex items-center gap-4">
              <div className="flex-1 bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-300" 
                  style={{ width: `${Math.max(...structures.map(s => (s.currentIndex / s.residues.length) * 100))}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">Playback Progress</span>
            </div>
          )}
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-zinc-900/50 rounded-2xl p-6 border border-zinc-800/50">
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                <Plus className="w-3.5 h-3.5" /> Library
              </h2>
              
              <div className="space-y-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPdbId}
                    onChange={(e) => setNewPdbId(e.target.value)}
                    placeholder="PDB ID or PubChem CID..."
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 font-mono uppercase"
                  />
                  <button 
                    onClick={addStructures} 
                    disabled={loading} 
                    className="bg-emerald-500 text-zinc-950 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-emerald-400 disabled:opacity-50 transition-all active:scale-95 min-w-[60px]"
                  >
                    {loading ? `${Math.round(loadingProgress)}%` : 'Add'}
                  </button>
                </div>

                {loading && (
                  <div className="space-y-2">
                    <div className="h-1 bg-zinc-950 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 transition-all duration-300" 
                        style={{ width: `${loadingProgress}%` }}
                      />
                    </div>
                    <p className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest text-center">
                      {loadingStatus || `Fetching structures... ${Math.round(loadingProgress)}%`}
                    </p>
                  </div>
                )}
                
                <div className="flex items-center justify-between pt-2">
                  <label className="cursor-pointer text-[10px] font-bold text-zinc-500 hover:text-zinc-300 uppercase tracking-widest transition-colors">
                    Upload PDB/SDF
                    <input type="file" multiple accept=".pdb,.sdf" onChange={handleFileUpload} className="hidden" />
                  </label>
                  <button onClick={clearAll} className="text-[10px] font-bold text-zinc-600 hover:text-red-400 uppercase tracking-widest transition-colors">
                    Clear All
                  </button>
                </div>
              </div>

              <div className="mt-8 space-y-6">
                <section className="bg-zinc-900/50 rounded-2xl p-6 border border-zinc-800/50">
                  <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                    <ListMusic className="w-3.5 h-3.5" /> Saved Lists
                  </h2>
                  
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      value={listName}
                      onChange={(e) => setListName(e.target.value)}
                      placeholder="List name..."
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                    <button 
                      onClick={() => { if (listName) { saveCurrentList(listName); setListName(''); } }} 
                      disabled={structures.length === 0 || !listName}
                      className="bg-emerald-500 text-zinc-950 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-emerald-400 disabled:opacity-50 transition-all active:scale-95"
                    >
                      Save
                    </button>
                  </div>

                  <div className="space-y-2">
                    {savedLists.map(list => (
                      <div key={list.id} className="flex items-center justify-between bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                        {editingListId === list.id ? (
                          <input
                            type="text"
                            value={editingListName}
                            onChange={(e) => setEditingListName(e.target.value)}
                            onBlur={saveEdit}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
                            autoFocus
                            className="flex-1 bg-zinc-900 border border-emerald-500/50 rounded-lg px-2 py-1 text-sm text-zinc-100 focus:outline-none"
                          />
                        ) : (
                          <span 
                            onDoubleClick={() => startEditing(list)}
                            className="text-sm text-zinc-300 truncate cursor-pointer hover:text-emerald-400"
                            title="Double-click to edit"
                          >
                            {list.name}
                          </span>
                        )}
                        <div className="flex gap-1">
                          <button onClick={() => loadList(list)} className="text-emerald-500 hover:text-emerald-400 p-1">Load</button>
                          <button onClick={() => deleteList(list.id)} className="text-zinc-600 hover:text-red-400 p-1"><X className="w-4 h-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="mt-8 space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {structures.length === 0 ? (
                  <div className="py-12 text-center border-2 border-dashed border-zinc-800/50 rounded-xl">
                    <p className="text-xs text-zinc-600 font-medium">No structures loaded</p>
                  </div>
                ) : (
                  structures.map(s => (
                    <StructureCard 
                      key={s.id} 
                      structure={s} 
                      onRemove={removeStructure} 
                      isActive={selectedStructureId === s.id}
                      onSelect={() => setSelectedStructureId(s.id)}
                      onExportMidi={() => exportStructureMidi(s)}
                      onExportJson={() => exportStructureJson(s)}
                    />
                  ))
                )}
              </div>
            </section>
            
            <section className="bg-zinc-900/50 rounded-2xl p-6 border border-zinc-800/50 space-y-8">
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                <Settings2 className="w-3.5 h-3.5" /> Synthesis
              </h2>
              <div className="space-y-6">
                <label className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  <span>Kyte–Doolittle mapping</span>
                  <input type="checkbox" checked={scientificMapping} onChange={(e) => setScientificMapping(e.target.checked)} className="accent-emerald-500" />
                </label>
                <label className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  <span>Spatial audio (3D)</span>
                  <input type="checkbox" checked={spatialAudio} onChange={(e) => setSpatialAudio(e.target.checked)} className="accent-emerald-500" />
                </label>
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    <span>Frequency (k)</span>
                    <span className="text-emerald-400">{kConstant}</span>
                  </div>
                  <input type="range" min="2000" max="15000" step="100" value={kConstant} onChange={(e) => setKConstant(Number(e.target.value))} className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    <span>Tempo (ms)</span>
                    <span className="text-emerald-400">{tempo}</span>
                  </div>
                  <input type="range" min="50" max="500" step="10" value={tempo} onChange={(e) => setTempo(Number(e.target.value))} className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                </div>
              </div>
            </section>
          </div>

          <div className="lg:col-span-8 space-y-8">
            <section className="bg-zinc-900/50 rounded-3xl border border-zinc-800/50 overflow-hidden flex flex-col h-[300px]">
              <div className="p-6 border-b border-zinc-800/50 flex items-center justify-between bg-zinc-900/80">
                <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" /> Diagnostic Console
                </h2>
                <button onClick={() => setLogs([])} className="text-[10px] text-zinc-600 hover:text-zinc-400 font-bold uppercase tracking-widest transition-colors">Clear</button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-[10px] bg-black/40 custom-scrollbar">
                {logs.length === 0 ? (
                  <div className="h-full flex items-center justify-center opacity-20 pointer-events-none">
                    <p className="uppercase tracking-widest text-[8px]">Waiting for process...</p>
                  </div>
                ) : (
                  logs.map(log => (
                    <div key={log.id} className={`flex gap-3 py-1 border-b border-zinc-900/50 animate-in fade-in slide-in-from-left-2 duration-300 ${
                      log.type === 'error' ? 'text-red-400' : 
                      log.type === 'success' ? 'text-emerald-400' : 'text-zinc-500'
                    }`}>
                      <span className="opacity-30 shrink-0">[{new Date(log.id).toLocaleTimeString()}]</span>
                      <span className="break-all">{log.msg}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {selectedStructureId ? (
              <div className="bg-zinc-900/30 rounded-3xl p-8 border border-zinc-800/50 min-h-[600px] flex flex-col">
                {(() => {
                  const s = structures.find(st => st.id === selectedStructureId);
                  if (!s) return null;
                  return (
                    <>
                      <div className="mb-8">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-xs font-mono font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
                            {s.pdbId}
                          </span>
                          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
                            {s.type}
                          </span>
                        </div>
                        <h2 className="text-4xl font-light text-white leading-tight mb-4">
                          {s.name}
                        </h2>
                        <div className="flex items-center gap-6 text-xs text-zinc-500 font-medium">
                          <div className="flex items-center gap-2">
                            <Activity className="w-3.5 h-3.5" />
                            {s.residues.length} Residues
                          </div>
                          <div className="flex items-center gap-2">
                            <Repeat className="w-3.5 h-3.5" />
                            {Math.round(s.totalDuration)}s Duration
                          </div>
                        </div>
                      </div>

                      <div className="flex-1 bg-zinc-950/50 rounded-2xl border border-zinc-800/30 p-6 overflow-hidden flex flex-col">
                        <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] mb-4">Sequence Visualization</h3>
                        <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 content-start">
                          {s.residues.map((r, i) => (
                            <div 
                              key={i} 
                              className={`p-2 rounded-lg text-center transition-all ${
                                i === s.currentIndex 
                                  ? 'bg-emerald-500 text-zinc-950 font-bold scale-110 shadow-lg shadow-emerald-500/20' 
                                  : 'bg-zinc-900/50 text-zinc-500 text-[10px] font-mono'
                              }`}
                            >
                              <div className="opacity-50 text-[8px] mb-0.5">{r.resSeq}</div>
                              {r.resName}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-6 p-6 bg-zinc-900/40 rounded-2xl border border-zinc-800/50 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-amber-500/80" /> Google AI Studio (Gemini)
                          </p>
                          <button
                            type="button"
                            onClick={runGeminiInsight}
                            disabled={geminiLoading}
                            className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-50"
                          >
                            {geminiLoading ? 'Generando…' : 'Interpretar sonificación'}
                          </button>
                        </div>
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          Requiere <code className="text-zinc-400">GEMINI_API_KEY</code> en <code className="text-zinc-400">.env</code> (inyectado como <code className="text-zinc-400">process.env.GEMINI_API_KEY</code> en Vite).
                        </p>
                        {geminiInsight && (
                          <div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar border-t border-zinc-800/50 pt-3">
                            {geminiInsight}
                          </div>
                        )}
                      </div>

                      <div className="mt-8 flex items-center justify-between p-6 bg-zinc-900/50 rounded-2xl border border-zinc-800/50">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Musical Profile</p>
                          <p className="text-sm text-zinc-300">
                            {s.residues.length > 500 ? 'Complex Orchestral' : 'Minimalist Pulse'} • 
                            {tempo < 100 ? ' High Energy' : ' Ambient Drift'}
                          </p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Progress</p>
                            <p className="text-sm font-mono text-emerald-400">
                              {Math.round((s.currentIndex / s.residues.length) * 100)}%
                            </p>
                          </div>
                          <div className="w-12 h-12 rounded-full border-2 border-emerald-500/20 flex items-center justify-center">
                            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="h-full bg-zinc-900/20 rounded-3xl border-2 border-dashed border-zinc-800/50 flex flex-col items-center justify-center p-12 text-center">
                <div className="w-20 h-20 rounded-full bg-zinc-900 flex items-center justify-center mb-6 border border-zinc-800">
                  <Activity className="w-10 h-10 text-zinc-700" />
                </div>
                <h3 className="text-xl font-medium text-zinc-400 mb-2">Select a structure to explore</h3>
                <p className="text-sm text-zinc-600 max-w-xs">
                  Add proteins from the RCSB database or upload your own PDB files to begin the sonification process.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
