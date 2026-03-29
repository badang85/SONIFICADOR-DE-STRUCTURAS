import type { Residue, SSBond } from './pdbParser';

export type { SSBond };

export interface PeptideEdge {
  from: number;
  to: number;
  /** 'peptide' | 'disulfide' */
  kind: 'peptide' | 'disulfide';
}

/**
 * Grafo de conectividad covalente aproximada: enlaces peptídicos consecutivos en la lista
 * (Cα ordenados como en el PDB) y puentes disulfuro según SSBOND.
 */
export function buildConnectivityGraph(residues: Residue[], ssbonds: SSBond[]): PeptideEdge[] {
  const edges: PeptideEdge[] = [];

  for (let i = 0; i < residues.length - 1; i++) {
    const a = residues[i];
    const b = residues[i + 1];
    const sameChain = (a.chainID || 'A') === (b.chainID || 'A');
    if (sameChain && b.resSeq === a.resSeq + 1) {
      edges.push({ from: i, to: i + 1, kind: 'peptide' });
    }
  }

  const key = (chain: string, seq: number) => `${chain}:${seq}`;
  const indexByKey = new Map<string, number>();
  for (let i = 0; i < residues.length; i++) {
    indexByKey.set(key(residues[i].chainID || 'A', residues[i].resSeq), i);
  }

  for (const s of ssbonds) {
    const i1 = indexByKey.get(key(s.chain1, s.seq1));
    const i2 = indexByKey.get(key(s.chain2, s.seq2));
    if (i1 !== undefined && i2 !== undefined && i1 !== i2) {
      edges.push({ from: i1, to: i2, kind: 'disulfide' });
    }
  }

  return edges;
}
