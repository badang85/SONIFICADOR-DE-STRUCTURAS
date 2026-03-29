import type { Residue, SSBond } from './pdbParser';
import type { AnmResult } from './nma/anm';
import { referencesForExport } from './scientificReferences';
import type { PeptideEdge } from './connectivity';

export interface SonificationMetadataJson {
  pdbId: string;
  pdbHash: string;
  method: string;
  residueCount: number;
  references: string[];
  ssbonds: SSBond[];
  connectivityEdgeCount: number;
  anm: null | {
    frequenciesHz: number[];
    eigenvaluesRaw: number[];
    subsampled: boolean;
    dimension: number;
  };
  residues: Array<{
    resName: string;
    resSeq: number;
    chainID: string;
    secStruct: string;
    bFactor: number;
  }>;
}

export function buildSonificationJson(opts: {
  pdbId: string;
  pdbHash: string;
  residues: Residue[];
  ssbonds: SSBond[];
  edges: PeptideEdge[];
  anm: AnmResult | null;
  method: string;
}): SonificationMetadataJson {
  return {
    pdbId: opts.pdbId,
    pdbHash: opts.pdbHash,
    method: opts.method,
    residueCount: opts.residues.length,
    references: referencesForExport(),
    ssbonds: opts.ssbonds,
    connectivityEdgeCount: opts.edges.length,
    anm: opts.anm
      ? {
          frequenciesHz: opts.anm.frequenciesHz,
          eigenvaluesRaw: opts.anm.eigenvaluesRaw,
          subsampled: opts.anm.subsampled,
          dimension: opts.anm.dimension,
        }
      : null,
    residues: opts.residues.map((r) => ({
      resName: r.resName,
      resSeq: r.resSeq,
      chainID: r.chainID,
      secStruct: r.secStruct,
      bFactor: r.bFactor,
    })),
  };
}
