/**
 * Referencias obligatorias para trazabilidad científica y metadatos de exportación.
 * Ver también comentarios en `nma/anm.ts` (ANM / literatura NMA a gran escala).
 */
export const SCIENTIFIC_REFERENCES = {
  buehler2019:
    'Buehler, M.J., et al. (2019). Large-scale vibrational analysis of the PDB (NMA / ENM class methods; protein-wide spectral characterization).',
  martin2021:
    'Martin, M., et al. (2021). Protein sequence sonification algorithms and perceptual mapping (sequence-to-audio pipelines).',
  participatoryDesign:
    'Participatory design for educational molecular sonification (co-design of auditory displays with learners and domain experts).',
  anmTirionBahar:
    'Elastic / anisotropic network models (ANM): Tirion (1996); Bahar et al. — harmonic approximation of fluctuation modes from native structure.',
} as const;

export function referencesForExport(): string[] {
  return Object.values(SCIENTIFIC_REFERENCES);
}
