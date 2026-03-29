/**
 * Anisotropic Network Model (ANM) — apropiación de NMA en estructura nativa
 * (matriz Hessiana armónica en red elástica; modos = autovectores).
 * Escala a rango audible conservando proporciones entre frecuencias (λ ∝ ω²).
 *
 * Referencia de contexto: métodos NMA / ENM a escala PDB (p. ej. Buehler et al., 2019).
 */
import { EigenvalueDecomposition, Matrix } from 'ml-matrix';

function matrixFromRowMajor(data: Float64Array, dim: number): Matrix {
  return Matrix.from1DArray(dim, dim, Array.from(data));
}
import type { Residue } from '../pdbParser';
import { AMINO_ACID_MASS } from '../pdbParser';

export interface AnmOptions {
  /** Distancia máxima (Å) para resortes de la red */
  cutoffAngstrom: number;
  /** Constante de resorte reducida (unidades arbitrarias coherentes) */
  gamma: number;
  /** Máximo de residuos Cα para el álgebra (submuestreo uniforme si hay más) */
  maxResidues: number;
  /** Número de modos no triviales a usar (además de saltar modos rígidos) */
  nModes: number;
  /** Modos rígidos aproximados a ignorar (típ. 6 en 3D) */
  skipRigidModes: number;
}

export interface AnmResult {
  /** Frecuencias en Hz (20–20k), proporcionales a ω = √λ */
  frequenciesHz: number[];
  /** Amplitudes relativas (participación por modo) */
  amplitudes: number[];
  /** Autovalores crudos (λ), mismo orden que frequenciesHz */
  eigenvaluesRaw: number[];
  /** Índices de residuo usados (respecto al array `residues` completo) */
  residueIndices: number[];
  subsampled: boolean;
  /** Dimensión efectiva 3N */
  dimension: number;
}

const DEFAULTS: AnmOptions = {
  cutoffAngstrom: 10,
  gamma: 1,
  maxResidues: 180,
  nModes: 16,
  skipRigidModes: 6,
};

function pickIndices(n: number, maxRes: number): number[] {
  if (n <= maxRes) return Array.from({ length: n }, (_, i) => i);
  const step = n / maxRes;
  const out: number[] = [];
  for (let k = 0; k < maxRes; k++) out.push(Math.min(n - 1, Math.floor(k * step)));
  return out;
}

function massForResidue(r: Residue): number {
  const m = AMINO_ACID_MASS[r.resName.trim().toUpperCase()] || r.mass || 110;
  return m > 0 ? m : 110;
}

/** Construye H (3N×3N) simétrica (ANM sin peso); luego se pesará por masas. */
function buildHessian(
  coords: Array<[number, number, number]>,
  cutoff: number,
  gamma: number
): Matrix {
  const N = coords.length;
  const dim = 3 * N;
  const data = new Float64Array(dim * dim);
  const add = (row: number, col: number, v: number) => {
    data[row * dim + col] += v;
  };

  for (let i = 0; i < N; i++) {
    const xi = coords[i][0],
      yi = coords[i][1],
      zi = coords[i][2];
    for (let j = i + 1; j < N; j++) {
      const dx = coords[j][0] - xi;
      const dy = coords[j][1] - yi;
      const dz = coords[j][2] - zi;
      const d2 = dx * dx + dy * dy + dz * dz;
      const r = Math.sqrt(d2);
      if (r < 1e-6 || r > cutoff) continue;

      const g = gamma / d2;
      const xx = g * dx * dx,
        xy = g * dx * dy,
        xz = g * dx * dz;
      const yy = g * dy * dy,
        yz = g * dy * dz;
      const zz = g * dz * dz;

      const ib = 3 * i,
        jb = 3 * j;
      // off-diagonal blocks -H_ij
      const o = -1;
      add(ib + 0, jb + 0, o * xx);
      add(ib + 0, jb + 1, o * xy);
      add(ib + 0, jb + 2, o * xz);
      add(ib + 1, jb + 0, o * xy);
      add(ib + 1, jb + 1, o * yy);
      add(ib + 1, jb + 2, o * yz);
      add(ib + 2, jb + 0, o * xz);
      add(ib + 2, jb + 1, o * yz);
      add(ib + 2, jb + 2, o * zz);

      add(jb + 0, ib + 0, o * xx);
      add(jb + 0, ib + 1, o * xy);
      add(jb + 0, ib + 2, o * xz);
      add(jb + 1, ib + 0, o * xy);
      add(jb + 1, ib + 1, o * yy);
      add(jb + 1, ib + 2, o * yz);
      add(jb + 2, ib + 0, o * xz);
      add(jb + 2, ib + 1, o * yz);
      add(jb + 2, ib + 2, o * zz);

      // diagonal blocks +H_ij to H_ii and H_jj
      for (const [b, xx_, xy_, xz_, yy_, yz_, zz_] of [
        [ib, xx, xy, xz, yy, yz, zz],
        [jb, xx, xy, xz, yy, yz, zz],
      ] as const) {
        add(b + 0, b + 0, xx_);
        add(b + 0, b + 1, xy_);
        add(b + 0, b + 2, xz_);
        add(b + 1, b + 0, xy_);
        add(b + 1, b + 1, yy_);
        add(b + 1, b + 2, yz_);
        add(b + 2, b + 0, xz_);
        add(b + 2, b + 1, yz_);
        add(b + 2, b + 2, zz_);
      }
    }
  }

  return matrixFromRowMajor(data, dim);
}

function massWeightHessian(H: Matrix, masses: number[]): Matrix {
  const N = masses.length;
  const dim = 3 * N;
  const invSqrt: number[] = [];
  for (let i = 0; i < N; i++) {
    const s = 1 / Math.sqrt(masses[i]);
    invSqrt.push(s, s, s);
  }
  const out = new Matrix(dim, dim);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      out.set(i, j, H.get(i, j) * invSqrt[i] * invSqrt[j]);
    }
  }
  return out;
}

/** Mapea ω = √λ a Hz manteniendo proporciones entre modos (factor global único). */
function mapOmegaToAudible(omegas: number[]): number[] {
  const positive = omegas.filter((w) => w > 1e-12);
  if (positive.length === 0) return omegas.map(() => 440);
  const wMin = Math.min(...positive);
  const wMax = Math.max(...positive);
  let freqs = omegas.map((w) => (w < 1e-12 ? 20 : 20 * (w / wMin)));
  const fMax = Math.max(...freqs);
  if (fMax > 20000) {
    const s = 20000 / fMax;
    freqs = freqs.map((f) => Math.max(20, Math.min(20000, f * s)));
  }
  return freqs;
}

export function computeAnmModes(residues: Residue[], opts: Partial<AnmOptions> = {}): AnmResult | null {
  const o = { ...DEFAULTS, ...opts };
  if (residues.length < 3) return null;

  const idx = pickIndices(residues.length, o.maxResidues);
  const subsampled = idx.length < residues.length;

  const coords: Array<[number, number, number]> = idx.map((i) => [
    residues[i].x,
    residues[i].y,
    residues[i].z,
  ]);
  const masses = idx.map((i) => massForResidue(residues[i]));

  const H = buildHessian(coords, o.cutoffAngstrom, o.gamma);
  const Hw = massWeightHessian(H, masses);

  let evd: EigenvalueDecomposition;
  try {
    evd = new EigenvalueDecomposition(Hw, { assumeSymmetric: true });
  } catch {
    return null;
  }

  const real = evd.realEigenvalues;
  const imag = evd.imaginaryEigenvalues;
  const vectors = evd.eigenvectorMatrix;

  const pairs: { lambda: number; col: number }[] = [];
  for (let i = 0; i < real.length; i++) {
    if (Math.abs(imag[i]) < 1e-8) pairs.push({ lambda: real[i], col: i });
  }
  pairs.sort((a, b) => a.lambda - b.lambda);

  const selected = pairs.slice(o.skipRigidModes, o.skipRigidModes + o.nModes);
  const frequenciesHz: number[] = [];
  const amplitudes: number[] = [];
  const eigenvaluesRaw: number[] = [];
  const dim = Hw.rows;

  const omegas = selected.map((p) => Math.sqrt(Math.max(p.lambda, 0)));
  const mapped = mapOmegaToAudible(omegas);

  for (let k = 0; k < selected.length; k++) {
    const p = selected[k];
    eigenvaluesRaw.push(p.lambda);
    frequenciesHz.push(mapped[k]);
    let norm = 0;
    for (let r = 0; r < dim; r++) {
      const v = vectors.get(r, p.col);
      norm += v * v;
    }
    amplitudes.push(norm > 1e-12 ? 1 / Math.sqrt(norm * selected.length) : 1 / selected.length);
  }

  return {
    frequenciesHz,
    amplitudes,
    eigenvaluesRaw,
    residueIndices: idx,
    subsampled,
    dimension: dim,
  };
}
