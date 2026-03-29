export const AMINO_ACID_MASS: Record<string, number> = {
  ALA: 89.1, ARG: 174.2, ASN: 132.1, ASP: 133.1, CYS: 121.2,
  GLN: 146.1, GLU: 147.1, GLY: 75.1, HIS: 155.2, ILE: 131.2,
  LEU: 131.2, LYS: 146.2, MET: 149.2, PHE: 165.2, PRO: 115.1,
  SER: 105.1, THR: 119.1, TRP: 204.2, TYR: 181.2, VAL: 117.1
};

export interface Residue {
  resName: string;
  resSeq: number;
  chainID: string;
  x: number;
  y: number;
  z: number;
  bFactor: number;
  secStruct: 'helix' | 'sheet' | 'coil';
  mass: number;
}

export interface SSBond {
  chain1: string;
  seq1: number;
  chain2: string;
  seq2: number;
}

/** Registros SSBOND (formato PDB clásico). */
export function parseSSBonds(pdbText: string): SSBond[] {
  const bonds: SSBond[] = [];
  for (const line of pdbText.split('\n')) {
    if (!line.startsWith('SSBOND')) continue;
    try {
      const chain1 = line.substring(15, 16).trim() || 'A';
      const seq1 = parseInt(line.substring(17, 21).trim(), 10);
      const chain2 = line.substring(29, 30).trim() || 'A';
      const seq2 = parseInt(line.substring(31, 35).trim(), 10);
      if (Number.isFinite(seq1) && Number.isFinite(seq2)) {
        bonds.push({ chain1, seq1, chain2, seq2 });
      }
    } catch {
      /* ignore */
    }
  }
  return bonds;
}

type Helix = { chain: string; start: number; end: number };
type Sheet = { chain: string; start: number; end: number };

function collectSecondaryAndSSBond(lines: readonly string[]) {
  const helices: Helix[] = [];
  const sheets: Sheet[] = [];
  const ssbonds: SSBond[] = [];
  for (const line of lines) {
    if (line.startsWith('HELIX ')) {
      const chain = line.substring(19, 20).trim();
      const start = parseInt(line.substring(21, 25).trim(), 10);
      const end = parseInt(line.substring(33, 37).trim(), 10);
      helices.push({ chain, start, end });
    } else if (line.startsWith('SHEET ')) {
      const chain = line.substring(21, 22).trim();
      const start = parseInt(line.substring(22, 26).trim(), 10);
      const end = parseInt(line.substring(33, 37).trim(), 10);
      sheets.push({ chain, start, end });
    } else if (line.startsWith('SSBOND')) {
      try {
        const chain1 = line.substring(15, 16).trim() || 'A';
        const seq1 = parseInt(line.substring(17, 21).trim(), 10);
        const chain2 = line.substring(29, 30).trim() || 'A';
        const seq2 = parseInt(line.substring(31, 35).trim(), 10);
        if (Number.isFinite(seq1) && Number.isFinite(seq2)) {
          ssbonds.push({ chain1, seq1, chain2, seq2 });
        }
      } catch {
        /* ignore */
      }
    }
  }
  return { helices, sheets, ssbonds };
}

/**
 * Parser en dos pasos: primero estructura secundaria y SSBOND, luego Cα.
 * Correcto aunque HELIX/SHEET aparezcan mezclados con ATOM.
 */
export function parsePDBLines(lines: readonly string[]): { residues: Residue[]; ssbonds: SSBond[] } {
  const { helices, sheets, ssbonds } = collectSecondaryAndSSBond(lines);
  const residues: Residue[] = [];

  for (const line of lines) {
    if (!line.startsWith('ATOM  ')) continue;
    const atomName = line.substring(12, 16).trim();
    if (atomName !== 'CA') continue;

    const resName = line.substring(17, 20).trim();
    const chainID = line.substring(21, 22).trim();
    const resSeq = parseInt(line.substring(22, 26).trim(), 10);
    const x = parseFloat(line.substring(30, 38).trim());
    const y = parseFloat(line.substring(38, 46).trim());
    const z = parseFloat(line.substring(46, 54).trim());
    const bFactor = parseFloat(line.substring(60, 66).trim());

    let secStruct: 'helix' | 'sheet' | 'coil' = 'coil';
    for (const h of helices) {
      if (h.chain === chainID && resSeq >= h.start && resSeq <= h.end) {
        secStruct = 'helix';
        break;
      }
    }
    if (secStruct === 'coil') {
      for (const s of sheets) {
        if (s.chain === chainID && resSeq >= s.start && resSeq <= s.end) {
          secStruct = 'sheet';
          break;
        }
      }
    }

    const mass = AMINO_ACID_MASS[resName] || 110;

    residues.push({
      resName, resSeq, chainID, x, y, z, bFactor, secStruct, mass
    });
  }

  return { residues, ssbonds };
}

export function parsePDB(pdbText: string): Residue[] {
  return parsePDBLines(pdbText.split('\n')).residues;
}

export function parsePDBWithMeta(pdbText: string): { residues: Residue[]; ssbonds: SSBond[] } {
  return parsePDBLines(pdbText.split('\n'));
}

/**
 * Construye el array de líneas sin `split` monolítico (mejor para PDB muy grandes en memoria pico).
 */
export function parsePDBChunked(
  pdbText: string,
  progressEveryLines = 8000,
  onChunk?: (linesProcessed: number) => void
): { residues: Residue[]; ssbonds: SSBond[] } {
  const lines: string[] = [];
  let lineStart = 0;
  const len = pdbText.length;
  let lineCount = 0;
  while (lineStart <= len) {
    const nl = pdbText.indexOf('\n', lineStart);
    const end = nl === -1 ? len : nl;
    lines.push(pdbText.slice(lineStart, end));
    lineStart = nl === -1 ? len + 1 : nl + 1;
    lineCount++;
    if (lineCount % progressEveryLines === 0) onChunk?.(lineCount);
  }
  return parsePDBLines(lines);
}
