// Calcul du jeu de vérification d'un exercice : solution de référence (correction du prof si elle
// compile, sinon modèle Ollama), exécutée avec les moteurs WASM pour produire les sorties attendues.
//
// RÉSERVÉ au solveur (`tsx scripts/solver.ts`) et à vitest : importe les moteurs Node
// (`src/lib/runners/index.ts`), à ne jamais importer depuis du code serveur Next.
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { documents, exercises, subjects } from "../db/schema";
import {
  claimNextPendingId,
  getCheck,
  releaseCheck,
  saveCheckResult,
  type CheckResult,
  type CheckTest,
} from "../checks";
import { normalizeOutput, outputsMatch, runCode, type RunResult } from "../../lib/runners/index.ts";
import { askModel, ModelOutputError, OllamaUnavailableError } from "./ollama";
import {
  buildInputsPrompt,
  buildSolvePrompt,
  INPUTS_JSON_SCHEMA,
  inputsOutputSchema,
  SOLVE_JSON_SCHEMA,
  solveOutputSchema,
  type Feedback,
  type PromptExercise,
  type SolverLanguage,
} from "./prompt";

export type SolveDeps = {
  url: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** Délai par exécution de la référence (SOLVER_TIMEOUT_MS). */
  runTimeoutMs?: number;
  /** Délai HTTP d'un appel au modèle. */
  httpTimeoutMs?: number;
  /** Arrêt demandé (SIGINT/SIGTERM) : la ligne en cours est rendue à la file. */
  signal?: AbortSignal;
};

/**
 * - `ready` / `no_code` / `unsupported` / `failed` : statut enregistré ;
 * - `unavailable` : Ollama injoignable, ligne rendue à la file (`pending`, prise non comptée) ;
 * - `interrupted` : arrêt du solveur, ligne rendue à la file ;
 * - `gone` : exercice supprimé entre-temps (ligne disparue par cascade) ;
 * - `skipped` : la ligne n'était pas `running` (non prise, ou reprise ailleurs).
 */
export type SolveOutcome =
  | "ready"
  | "no_code"
  | "unsupported"
  | "failed"
  | "unavailable"
  | "interrupted"
  | "gone"
  | "skipped";

/** Une ligne prise plus de MAX_CLAIMS fois (plantages répétés, libérations) passe `failed`. */
export const MAX_CLAIMS = 3;
/** Appels au modèle par prise : 1 initial + 2 corrections avec l'erreur renvoyée. */
export const MAX_MODEL_TRIES = 3;

const MAX_EXPECTED_CHARS = 100_000;

class Interrupted extends Error {}

// --- Correction du prof -------------------------------------------------------------------

/**
 * Extrait un programme C plausible d'une correction (texte issu d'un PDF) : du premier
 * `#include` à la dernière accolade fermante, s'il contient `main(`. Seule la compilation
 * dira si c'est vraiment du code. Python non détecté : l'extraction PDF perd l'indentation.
 */
export function extractProfCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const start = text.indexOf("#include");
  if (start < 0) return null;
  const end = text.lastIndexOf("}");
  if (end <= start) return null;
  const code = text.slice(start, end + 1).trimEnd();
  return /\bmain\s*\(/.test(code) ? code : null;
}

const C_READS_STDIN = /\b(scanf|getchar|fgets|getline|gets|fgetc|getc|fread)\s*\(|\bstdin\b/;

// --- Exécution de la référence ---------------------------------------------------------------

type Evaluation =
  | { ok: true; tests: CheckTest[] }
  | { ok: false; nondeterministic: boolean; reason: string };

const quote = (s: string) => (s.length > 200 ? `${s.slice(0, 200)}…` : s).replace(/\n/g, "⏎");

function describeFailure(r: RunResult, input: string, timeoutMs: number): string {
  if (r.phase === "compile") return `Erreur de compilation :\n${r.stderr.trim()}`;
  if (r.timedOut) {
    return `Délai dépassé (${timeoutMs} ms) sur l'entrée « ${quote(input)} » : boucle infinie, ou lecture de plus de données que fournies ?`;
  }
  return `Erreur à l'exécution (code de sortie ${r.exitCode ?? "?"}) sur l'entrée « ${quote(input)} » :\n${r.stderr.trim().slice(-1500)}`;
}

/** Exécute la référence deux fois par entrée ; sorties différentes = non déterministe. */
async function evaluate(
  lang: SolverLanguage,
  code: string,
  inputs: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Evaluation> {
  const unique = [...new Set(inputs)];
  const tests: CheckTest[] = [];
  for (const input of unique) {
    const outs: string[] = [];
    for (let k = 0; k < 2; k++) {
      if (signal?.aborted) throw new Interrupted();
      const r = await runCode(lang, code, input, { timeoutMs });
      if (!r.ok) return { ok: false, nondeterministic: false, reason: describeFailure(r, input, timeoutMs) };
      outs.push(r.stdout);
    }
    if (!outputsMatch(outs[0], outs[1])) {
      return {
        ok: false,
        nondeterministic: true,
        reason: `solution non déterministe : deux exécutions sur l'entrée « ${quote(input)} » donnent des sorties différentes.`,
      };
    }
    const expected = normalizeOutput(outs[0]);
    if (expected.length > MAX_EXPECTED_CHARS) {
      return { ok: false, nondeterministic: false, reason: `Sortie trop longue sur l'entrée « ${quote(input)} ».` };
    }
    tests.push({ input, expected, visible: tests.length === 0 });
  }
  if (tests.every((t) => t.expected === "")) {
    return { ok: false, nondeterministic: false, reason: "Le programme n'affiche rien : il doit écrire ses résultats sur la sortie standard." };
  }
  return { ok: true, tests };
}

// --- Solveur ------------------------------------------------------------------------------

type LoadedExercise = PromptExercise & { solution: string | null };

function loadExercise(db: Db, exerciseId: string): LoadedExercise | null {
  const row = db
    .select({
      title: exercises.title,
      statement: exercises.statement,
      solution: exercises.solution,
      lang: exercises.lang,
      exSubject: exercises.subjectId,
      docSubject: documents.subjectId,
    })
    .from(exercises)
    .innerJoin(documents, eq(documents.id, exercises.documentId))
    .where(eq(exercises.id, exerciseId))
    .get();
  if (!row) return null;
  const subjectId = row.exSubject ?? row.docSubject;
  const subject = subjectId
    ? (db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, subjectId)).get()?.name ?? null)
    : null;
  return { title: row.title, statement: row.statement, solution: row.solution, lang: row.lang, subject };
}

/** Enregistre et renvoie le statut, ou `gone` si l'exercice a disparu entre-temps. */
function save(db: Db, exerciseId: string, result: CheckResult): SolveOutcome {
  saveCheckResult(db, exerciseId, result);
  return getCheck(db, exerciseId) ? (result.status as SolveOutcome) : "gone";
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Traite un exercice déjà pris (`running`). Ne lève jamais d'exception pour une erreur
 * attendue (modèle, compilation, Ollama injoignable, exercice supprimé).
 */
export async function solveExercise(db: Db, exerciseId: string, deps: SolveDeps): Promise<SolveOutcome> {
  let check;
  try {
    check = getCheck(db, exerciseId);
  } catch (e) {
    // Ligne illisible (JSON corrompu) : on la remet à zéro en `failed` plutôt que de bloquer la file.
    return save(db, exerciseId, { status: "failed", tests: [], error: `Ligne de vérification corrompue : ${errorText(e)}` });
  }
  if (!check) return "gone";
  if (check.status !== "running") return "skipped";
  if (check.attempts > MAX_CLAIMS) {
    return save(db, exerciseId, { status: "failed", error: "trop de tentatives (le solveur s'est arrêté plusieurs fois sur cet exercice)" });
  }
  const ex = loadExercise(db, exerciseId);
  if (!ex) return "gone";

  const timeoutMs = deps.runTimeoutMs ?? 5000;
  const ask = (prompt: string, schema: object) =>
    askModel(prompt, schema, {
      url: deps.url,
      model: deps.model,
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.httpTimeoutMs,
      signal: deps.signal,
    });

  try {
    // 1. Correction du prof, si elle contient du C qui compile et tourne sur les entrées.
    const prof = extractProfCode(ex.solution);
    if (prof) {
      const r = await tryProfReference(ex, prof, ask, timeoutMs, deps);
      if (r) {
        return save(db, exerciseId, {
          status: "ready",
          language: "c",
          referenceCode: `${prof}\n`,
          referenceSource: "prof",
          tests: r.tests,
          model: r.usedModel ? deps.model : null,
        });
      }
    }

    // 2. Modèle : 1 essai + 2 corrections avec l'erreur renvoyée.
    let feedback: Feedback | undefined;
    let lastError = "aucune réponse exploitable du modèle";
    for (let i = 0; i < MAX_MODEL_TRIES; i++) {
      if (deps.signal?.aborted) throw new Interrupted();
      let raw: unknown;
      try {
        raw = await ask(buildSolvePrompt(ex, feedback), SOLVE_JSON_SCHEMA);
      } catch (e) {
        if (!(e instanceof ModelOutputError)) throw e;
        lastError = `Réponse du modèle invalide : ${e.message}`;
        feedback = { reason: `${lastError}. Réponds uniquement par un objet JSON valide.` };
        continue;
      }
      const parsed = solveOutputSchema.safeParse(raw);
      if (!parsed.success) {
        lastError = `Réponse du modèle invalide : ${parsed.error.issues.map((x) => `${x.path.join(".") || "racine"} : ${x.message}`).join(" ; ")}`;
        feedback = { reason: lastError };
        continue;
      }
      const out = parsed.data;
      if (!out.needsCode) {
        return save(db, exerciseId, { status: "no_code", language: null, referenceCode: null, referenceSource: null, tests: [], model: deps.model });
      }
      if (out.language === "other" || out.language === null) {
        return save(db, exerciseId, { status: "unsupported", language: null, referenceCode: null, referenceSource: null, tests: [], model: deps.model });
      }
      const evaluation = await evaluate(out.language, out.solution, out.tests.map((t) => t.input), timeoutMs, deps.signal);
      if (evaluation.ok) {
        return save(db, exerciseId, {
          status: "ready",
          language: out.language,
          referenceCode: out.solution,
          referenceSource: "ai",
          tests: evaluation.tests,
          model: deps.model,
        });
      }
      lastError = evaluation.reason;
      if (evaluation.nondeterministic) break;
      feedback = { reason: evaluation.reason, code: out.solution };
    }
    return save(db, exerciseId, { status: "failed", model: deps.model, error: lastError });
  } catch (e) {
    if (e instanceof OllamaUnavailableError || e instanceof Interrupted) {
      releaseCheck(db, exerciseId);
      if (!getCheck(db, exerciseId)) return "gone";
      return e instanceof Interrupted || deps.signal?.aborted ? "interrupted" : "unavailable";
    }
    // Erreur imprévue (moteur, base) : la ligne ne doit pas rester bloquée en `running`.
    return save(db, exerciseId, { status: "failed", error: `Erreur interne du solveur : ${errorText(e)}` });
  }
}

/**
 * Essaie la correction du prof comme référence. Sans lecture de l'entrée : un test d'entrée
 * vide, aucun appel au modèle. Sinon, un seul appel au modèle pour les entrées seulement.
 * Renvoie null (repli sur le modèle complet) si elle ne compile pas ou échoue.
 */
async function tryProfReference(
  ex: LoadedExercise,
  code: string,
  ask: (prompt: string, schema: object) => Promise<unknown>,
  timeoutMs: number,
  deps: SolveDeps,
): Promise<{ tests: CheckTest[]; usedModel: boolean } | null> {
  if (!C_READS_STDIN.test(code)) {
    const ev = await evaluate("c", code, [""], timeoutMs, deps.signal);
    return ev.ok ? { tests: ev.tests, usedModel: false } : null;
  }
  const probe = await runCode("c", code, "", { timeoutMs });
  if (probe.phase === "compile" && !probe.ok) return null; // pas du code (texte PDF) : inutile d'appeler le modèle
  let raw: unknown;
  try {
    raw = await ask(buildInputsPrompt(ex, "c", code), INPUTS_JSON_SCHEMA);
  } catch (e) {
    if (e instanceof ModelOutputError) return null;
    throw e;
  }
  const parsed = inputsOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const ev = await evaluate("c", code, parsed.data.tests.map((t) => t.input), timeoutMs, deps.signal);
  return ev.ok ? { tests: ev.tests, usedModel: true } : null;
}

/**
 * Prend le prochain `pending` et le traite. Une ligne illisible est marquée `failed` (la boucle
 * continue). Renvoie null si la file est vide.
 */
export async function processNext(
  db: Db,
  deps: SolveDeps,
): Promise<{ id: string; outcome: SolveOutcome; durationMs: number } | null> {
  const id = claimNextPendingId(db);
  if (!id) return null;
  const t0 = performance.now();
  const outcome = await solveExercise(db, id, deps);
  return { id, outcome, durationMs: Math.round(performance.now() - t0) };
}
