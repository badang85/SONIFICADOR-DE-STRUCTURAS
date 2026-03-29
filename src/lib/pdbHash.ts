/**
 * Hash determinista del contenido PDB (FNV-1a 32-bit) para semillas reproducibles.
 * Misma entrada → mismo hash → mismos parámetros derivados de azar.
 */
export function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function seedFromPdbHash(hashHex: string): number {
  return parseInt(hashHex.slice(0, 8), 16) || 1;
}

/** Mulberry32 PRNG — determinista a partir de seed */
export function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
