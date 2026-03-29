/** Kyte–Doolittle hydropathy (single-letter scale). Positive = hydrophobic. */
export const KYTE_DOOLITTLE: Record<string, number> = {
  A: 1.8,
  R: -4.5,
  N: -3.5,
  D: -3.5,
  C: 2.5,
  Q: -3.5,
  E: -3.5,
  G: -0.4,
  H: -3.2,
  I: 4.5,
  L: 3.8,
  K: -3.9,
  M: 1.9,
  F: 2.8,
  P: -1.6,
  S: -0.8,
  T: -0.7,
  W: -0.9,
  Y: -1.3,
  V: 4.2,
};

const THREE_TO_ONE: Record<string, string> = {
  ALA: 'A',
  ARG: 'R',
  ASN: 'N',
  ASP: 'D',
  CYS: 'C',
  GLN: 'Q',
  GLU: 'E',
  GLY: 'G',
  HIS: 'H',
  ILE: 'I',
  LEU: 'L',
  LYS: 'K',
  MET: 'M',
  PHE: 'F',
  PRO: 'P',
  SER: 'S',
  THR: 'T',
  TRP: 'W',
  TYR: 'Y',
  VAL: 'V',
};

export type HydrophobicCategory = 'very_hydrophobic' | 'hydrophobic' | 'neutral' | 'hydrophilic';

export function resNameToLetter(resName: string): string {
  return THREE_TO_ONE[resName.trim().toUpperCase()] || 'A';
}

export function kyteDoolittleValue(resName: string): number {
  const letter = resNameToLetter(resName);
  return KYTE_DOOLITTLE[letter] ?? 0;
}

/** Very hydrophobic (KD > 2), hydrophobic (0–2), neutral (-1–0), hydrophilic (< -1) */
export function hydrophobicCategory(resName: string): HydrophobicCategory {
  const v = kyteDoolittleValue(resName);
  if (v > 2) return 'very_hydrophobic';
  if (v > 0) return 'hydrophobic';
  if (v >= -1) return 'neutral';
  return 'hydrophilic';
}

/** Map KD in [-4.5, 4.5] to MIDI note offset from base (chromatic spread). */
export function kdToMidiOffset(kd: number, semitoneRange = 24): number {
  const lo = -4.5;
  const hi = 4.5;
  const t = (Math.min(hi, Math.max(lo, kd)) - lo) / (hi - lo);
  return Math.round(t * semitoneRange);
}
