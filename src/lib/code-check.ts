// Logique pure de la vérification côté étudiant (gabarits, état d'affichage, verdict).
// Compatible navigateur : aucun import serveur ni `node:`.
import { normalizeOutput, outputsMatch } from "./runners/compare.ts";
import type { Language, RunResult } from "./runners/types.ts";

export type CheckTestData = { input: string; expected: string; visible: boolean };

export const LANGUAGE_LABELS: Record<Language, string> = { c: "C", python: "Python", javascript: "JavaScript" };

export const STARTER_TEMPLATES: Record<Language, string> = {
  c: "#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}",
  python: "# Lisez l'entrée avec input()\n",
  javascript: "// input() renvoie la ligne suivante de l'entrée (ou null)\n",
};

/** Code affiché à l'ouverture : dernier essai s'il est dans le même langage, sinon le gabarit. */
export function initialCode(lang: Language, attempt: { language: string; code: string } | null): string {
  return attempt && attempt.language === lang && attempt.code ? attempt.code : STARTER_TEMPLATES[lang];
}

/**
 * Langage proposé pour « Écrire du code en attendant » (pré-calcul pas encore fait) :
 * C pour une matière de programmation C, sinon Python.
 */
export function defaultLanguageForSubject(subjectName: string | null | undefined): Language {
  return subjectName && /(^|[^a-z])c($|[^a-z+#])/i.test(subjectName) ? "c" : "python";
}

export type CheckModeInput = { status: string; language: Language | null; tests: CheckTestData[] } | null;

/**
 * - `ready` : vérification automatique possible ;
 * - `preparing` : pré-calcul en attente ou en cours (éditeur + Exécuter si le langage est connu) ;
 * - `none` : pas de vérification (éditeur + Exécuter seulement si `language` est non nul).
 */
export type CheckMode = { kind: "ready"; language: Language } | { kind: "preparing" | "none"; language: Language | null };

export function checkMode(check: CheckModeInput): CheckMode {
  if (!check) return { kind: "none", language: null };
  const language = check.language ?? null;
  switch (check.status) {
    case "ready":
      return language && check.tests.length > 0 ? { kind: "ready", language } : { kind: "none", language };
    case "pending":
    case "running":
      return { kind: "preparing", language };
    case "no_code":
      return { kind: "none", language: null };
    default:
      return { kind: "none", language };
  }
}

export type OutcomeStatus = "ok" | "wrong" | "timeout" | "runtime" | "compile" | "skipped";

/** Résultat d'un test ; `input`/`expected`/`actual`/`stderr` seulement pour un test visible. */
export type TestOutcome = {
  index: number;
  visible: boolean;
  status: OutcomeStatus;
  input?: string;
  expected?: string;
  actual?: string;
  stderr?: string;
};

export type Verdict = { passed: boolean; compileError: string | null; outcomes: TestOutcome[] };

function outcomeStatus(r: RunResult, expected: string): OutcomeStatus {
  // Délai dépassé pendant la compilation : erreur de compilation (« Compilation trop longue »).
  if (r.timedOut) return r.phase === "compile" ? "compile" : "timeout";
  if (!r.ok) return r.phase === "compile" ? "compile" : "runtime";
  return outputsMatch(r.stdout, expected) ? "ok" : "wrong";
}

/**
 * Verdict à partir des résultats d'exécution, dans l'ordre des tests. Les tests sans résultat
 * (arrêt après une erreur de compilation ou un délai dépassé) sont `skipped`.
 */
export function computeVerdict(tests: CheckTestData[], results: RunResult[]): Verdict {
  let compileError: string | null = null;
  const outcomes = tests.map((t, index): TestOutcome => {
    const r = results[index];
    const status: OutcomeStatus = r ? outcomeStatus(r, t.expected) : "skipped";
    if (status === "compile" && compileError === null) compileError = r.stderr || "Compilation échouée.";
    const o: TestOutcome = { index, visible: t.visible, status };
    if (t.visible && r) {
      o.input = t.input;
      o.expected = t.expected;
      o.actual = r.stdout;
      if (r.stderr) o.stderr = r.stderr;
    }
    return o;
  });
  return { passed: outcomes.length > 0 && outcomes.every((o) => o.status === "ok"), compileError, outcomes };
}

export type DiffLine = { expected: string | null; actual: string | null; same: boolean };

/** Comparaison ligne à ligne (sorties normalisées) pour l'affichage attendu / obtenu. */
export function diffLines(expected: string, actual: string): DiffLine[] {
  const split = (s: string) => {
    const n = normalizeOutput(s);
    return n === "" ? [] : n.split("\n");
  };
  const e = split(expected);
  const a = split(actual);
  return Array.from({ length: Math.max(e.length, a.length) }, (_, i) => {
    const ex = i < e.length ? e[i] : null;
    const ac = i < a.length ? a[i] : null;
    return { expected: ex, actual: ac, same: ex !== null && ex === ac };
  });
}
