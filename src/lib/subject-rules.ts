import { z } from "zod";
import { normalizeKeyword } from "./slug";

/** Règles de classement automatique d'une matière (partagées par le site et les scripts du PC). */
export type SubjectRules = {
  /** Expressions régulières (insensibles à la casse et aux accents) testées sur le chemin et le nom. */
  pathPatterns: string[];
  /** Mot-clé (sans accent, minuscule) -> poids. */
  keywords: Record<string, number>;
};

// --- Administration des matières (validation partagée site / serveur) ---------

export const MAX_WEIGHT = 10;


/** Lit des lignes « mot-clé: poids » (poids entier 1–10, 1 par défaut). */
export function parseKeywordLines(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.*?)(?:\s*:\s*([^:]*))?$/.exec(line)!;
    const kw = normalizeKeyword(m[1] ?? "");
    if (!kw) continue;
    let weight = 1;
    if (m[2] !== undefined) {
      weight = Number(m[2].trim());
      if (!Number.isInteger(weight) || weight < 1 || weight > MAX_WEIGHT) {
        throw new Error(`Poids invalide pour « ${kw} » (entier de 1 à ${MAX_WEIGHT}).`);
      }
    }
    out[kw] = weight;
  }
  return out;
}

export function formatKeywordLines(keywords: Record<string, number>): string {
  return Object.entries(keywords)
    .map(([k, w]) => `${k}: ${w}`)
    .join("\n");
}

export const subjectInputSchema = z.object({
  name: z.string().trim().min(1, "Nom requis.").max(60, "Nom trop long (60 max)."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide (format #rrggbb)."),
  pathPatterns: z
    .array(z.string().trim().min(1).max(300))
    .max(50)
    .superRefine((patterns, ctx) => {
      for (const p of patterns) {
        try {
          new RegExp(p, "i");
        } catch {
          ctx.addIssue({ code: "custom", message: `Motif invalide : ${p}` });
        }
      }
    }),
  keywords: z.record(z.string().min(1).max(100), z.number().int().min(1).max(MAX_WEIGHT)),
});
export type SubjectInput = z.input<typeof subjectInputSchema>;
