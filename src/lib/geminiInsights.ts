import { GoogleGenAI } from '@google/genai';
import type { Residue } from './pdbParser';

function getApiKey(): string | undefined {
  const env = (import.meta as unknown as { env?: { GEMINI_API_KEY?: string; VITE_GEMINI_API_KEY?: string } }).env;
  if (env?.VITE_GEMINI_API_KEY) return env.VITE_GEMINI_API_KEY;
  if (env?.GEMINI_API_KEY) return env.GEMINI_API_KEY;
  if (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  return undefined;
}

export async function generateSonificationInsight(opts: {
  pdbId: string;
  title?: string;
  residueCount: number;
  sonificationMethod: string;
  nmaModeCount?: number;
}): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return 'Configure GEMINI_API_KEY in .env (Vite injects process.env.GEMINI_API_KEY) para análisis con Gemini.';
  }

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Eres un asistente científico para sonificación de proteínas.
PDB: ${opts.pdbId}
Título: ${opts.title ?? 'N/D'}
Residuos (Cα): ${opts.residueCount}
Método de sonificación: ${opts.sonificationMethod}
${opts.nmaModeCount != null ? `Modos NMA/ANM usados: ${opts.nmaModeCount}` : ''}

En 2–4 párrafos concisos en español:
1) Qué podría significar escuchar esta estructura como espectro/modos.
2) Cómo interpretar la capa secuencial (hidrofobicidad) frente a la vibracional.
3) Limitaciones (ANM vs MD, resolución experimental).

No inventes datos numéricos no dados.`;

  const res = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
  });

  const text = res.text?.trim();
  return text || 'Sin respuesta del modelo.';
}

export async function shortResidueSummary(residues: Residue[]): Promise<string> {
  const counts = { helix: 0, sheet: 0, coil: 0 };
  for (const r of residues) counts[r.secStruct]++;
  return `Hélice ${counts.helix}, lámina ${counts.sheet}, coil ${counts.coil}`;
}
