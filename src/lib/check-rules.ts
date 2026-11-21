// Règles des vérifications d'exercices, sans accès aux données : utilisées par le site (Supabase)
// et reprises de l'ancien serveur (src/server/checks.ts).
import { z } from "zod";

export type CheckTest = { input: string; expected: string; visible: boolean };
export type ProgressStatus = "todo" | "doing" | "mastered";

export const testsSchema = z
  .array(
    z.object({
      input: z.string().max(10_000, "Entrée trop longue (10 000 caractères max)"),
      expected: z.string().max(100_000, "Sortie attendue trop longue (100 000 caractères max)"),
      visible: z.boolean(),
    }),
  )
  .min(1, "Au moins un test est requis")
  .max(20, "20 tests maximum")
  .refine((t) => t.some((x) => x.visible), "Au moins un test doit être visible");

/** Tests saisis par l'administrateur (JSON `[{input, expected, visible}]`). */
export function parseTestsJson(json: string): { ok: true; tests: CheckTest[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "JSON invalide." };
  }
  const r = testsSchema.safeParse(raw);
  if (r.success) return { ok: true, tests: r.data };
  const issue = r.error.issues[0];
  const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
  return { ok: false, error: `Tests invalides${where} : ${issue?.message ?? "format attendu [{input, expected, visible}]"}` };
}

/** Progression après une vérification : maîtrisé si réussi, sinon en cours ; jamais de rétrogradation. */
export function nextProgress(current: ProgressStatus | undefined, passed: boolean): ProgressStatus | null {
  if (passed) return "mastered";
  return current === "mastered" ? null : "doing";
}

/** L'administrateur ne valide que des tests utilisables (prêts, avec langage et au moins un test). */
export function canVerify(check: { status: string; language: string | null; tests: unknown[] | null }): boolean {
  return check.status === "ready" && !!check.language && !!check.tests && check.tests.length > 0;
}

/** Remise en file du pré-calcul : confirmation exigée sur des tests validés, refus pendant un calcul. */
export function requeueDecision(check: { status: string; verified: boolean }, confirm: boolean): "ok" | "verified" | "busy" {
  if (check.status === "running") return "busy";
  if (check.verified && !confirm) return "verified";
  return "ok";
}
