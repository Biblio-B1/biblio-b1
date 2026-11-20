// Prompts (en français) et schémas de sortie du modèle pour le solveur.
import { z } from "zod";

export type PromptExercise = {
  title: string;
  statement: string;
  subject: string | null;
  lang: "fr" | "en";
};

export type SolverLanguage = "c" | "python" | "javascript";

/** Retour d'une tentative précédente rejetée, renvoyé au modèle. */
export type Feedback = { reason: string; code?: string };

/** Au-delà, l'énoncé est tronqué (num_ctx 8192 jetons, prompt et réponse compris). */
// Budgets (caractères) pour tenir dans num_ctx 8192 jetons avec la réponse (num_predict 3000).
const MAX_STATEMENT_CHARS = 6_000;
const MAX_CODE_CHARS = 4_000;
const MAX_REASON_CHARS = 1_500;
/** Énoncé plus long : l'ancien code n'est pas renvoyé avec l'erreur (seule la raison l'est). */
const LONG_STATEMENT_CHARS = 3_500;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[…tronqué]` : s);

/** Langage attendu : C pour le cours de C (sauf énoncé clairement en Python), sinon celui de l'énoncé. */
export function preferredLanguage(subject: string | null, statement: string): SolverLanguage | null {
  const python = /\bpython\b/i.test(statement);
  if (subject && /\bprog(rammation)?\.?\s*(structurée\s+en\s+)?C\b|\blangage\s+C\b/i.test(subject)) {
    return python ? "python" : "c";
  }
  return python ? "python" : null;
}

function header(ex: PromptExercise): string {
  return `Tu es enseignant d'informatique. Tu prépares la correction automatique d'un exercice pour des étudiants de première année : leur programme sera exécuté sur des entrées de test et sa sortie comparée à celle d'une solution de référence.

Matière : ${ex.subject ?? "(inconnue)"}
Exercice : ${ex.title}
Énoncé (${ex.lang === "en" ? "en anglais" : "en français"}) :
"""
${clip(ex.statement.trim(), MAX_STATEMENT_CHARS)}
"""
`;
}

const PROGRAM_RULES = `- Écris un programme complet qui lit l'entrée standard et écrit sur la sortie standard.
- Si l'exercice demande seulement une fonction (ou un sous-programme), écris-la et ajoute un programme principal (main) qui lit les données sur l'entrée standard, appelle la fonction et affiche le résultat.
- N'affiche AUCUN message d'invite (pas de « Entrez un nombre : ») ni texte décoratif : uniquement les résultats, car la sortie sera comparée mot pour mot à celle des étudiants.
- Si l'énoncé impose un format de sortie exact, respecte-le à la lettre (il prime sur la règle précédente).
- Pas d'aléatoire, pas de date ni d'heure, pas de fichiers, pas de réseau : la sortie doit dépendre uniquement de l'entrée.
- C : C99 standard (stdio.h, stdlib.h, string.h, math.h), fonction main qui renvoie 0. Python : Python 3, lecture avec input() ou sys.stdin. JavaScript : input() renvoie la ligne suivante de l'entrée (null à la fin), console.log() affiche.`;

const TEST_RULES = `- Propose 4 à 6 tests. Pour chacun : "input" = le texte exact fourni sur l'entrée standard (valeurs séparées par des espaces ou des sauts de ligne, dans l'ordre où le programme les lit) ; "note" = ce que le test vérifie, en une phrase courte.
- Inclure au moins un cas limite (zéro, valeur négative, un seul élément, valeur maximale…). Les entrées doivent être valides au regard de l'énoncé.
- N'écris pas les sorties attendues : elles seront calculées en exécutant la solution.`;

function feedbackBlock(feedback: Feedback | undefined, statement: string): string {
  if (!feedback) return "";
  const code = feedback.code && statement.length <= LONG_STATEMENT_CHARS
    ? `Code précédent :\n"""\n${clip(feedback.code, MAX_CODE_CHARS)}\n"""\n`
    : "";
  return `
ATTENTION — ta réponse précédente a été rejetée :
${clip(feedback.reason, MAX_REASON_CHARS)}
${code}Corrige le problème et renvoie une réponse complète.
`;
}

/** Prompt principal : le modèle décide s'il faut du code, choisit le langage, écrit la solution et les entrées. */
export function buildSolvePrompt(ex: PromptExercise, feedback?: Feedback): string {
  const pref = preferredLanguage(ex.subject, ex.statement);
  const langRule =
    pref === "c"
      ? `"c" (cours de C), sauf si l'énoncé exige explicitement un autre langage`
      : pref === "python"
        ? `"python" (l'énoncé demande du Python)`
        : `le langage demandé par l'énoncé : "c", "python" ou "javascript" ; si rien n'est précisé, "python"`;
  return `${header(ex)}
Réponds uniquement avec un objet JSON conforme au schéma demandé :
1. "needsCode" : true si l'exercice demande d'écrire un programme ou une fonction dont on peut vérifier le résultat en l'exécutant ; false sinon (question de cours, algorithme en pseudo-code ou logigramme, calcul à la main, schéma, démonstration…).
2. "language" : ${langRule}. Utilise "other" si l'exercice exige un autre langage, et null si needsCode vaut false.
3. "solution" : la solution de référence.
${PROGRAM_RULES}
4. "tests" : 4 à 6 tests.
${TEST_RULES}
Si needsCode vaut false : "solution" = "" et "tests" = [].
${feedbackBlock(feedback, ex.statement)}`;
}

/** Prompt réduit (correction du prof déjà exécutable) : seules les entrées de test sont demandées. */
export function buildInputsPrompt(ex: PromptExercise, language: SolverLanguage, code: string, feedback?: Feedback): string {
  return `${header(ex)}
Voici la correction officielle du professeur (programme en ${language === "c" ? "C" : language}) :
"""
${clip(code, MAX_CODE_CHARS)}
"""

Réponds uniquement avec un objet JSON conforme au schéma demandé : "tests" = 4 à 6 entrées de test pour ce programme.
${TEST_RULES}
- Respecte exactement l'ordre et le format des lectures du programme (scanf, fgets, getchar…).
${feedbackBlock(feedback, ex.statement)}`;
}

// --- Schémas : JSON Schema pour `format` (grammaire imposée par Ollama) + zod pour valider ---

const testItemJson = {
  type: "object",
  properties: { input: { type: "string" }, note: { type: "string" } },
  required: ["input", "note"],
};

export const SOLVE_JSON_SCHEMA = {
  type: "object",
  properties: {
    needsCode: { type: "boolean" },
    language: { type: ["string", "null"], enum: ["c", "python", "javascript", "other", null] },
    solution: { type: "string" },
    tests: { type: "array", items: testItemJson, minItems: 0, maxItems: 6 },
  },
  required: ["needsCode", "language", "solution", "tests"],
};

export const INPUTS_JSON_SCHEMA = {
  type: "object",
  properties: { tests: { type: "array", items: testItemJson, minItems: 4, maxItems: 6 } },
  required: ["tests"],
};

const testItem = z.object({ input: z.string().max(10_000), note: z.string() });

export const solveOutputSchema = z
  .object({
    needsCode: z.boolean(),
    language: z.enum(["c", "python", "javascript", "other"]).nullable(),
    solution: z.string(),
    tests: z.array(testItem).max(6),
  })
  .superRefine((o, ctx) => {
    if (!o.needsCode) return;
    if (o.language === null) ctx.addIssue({ code: "custom", message: "language requis quand needsCode vaut true" });
    if (o.language !== "other") {
      if (o.solution.trim() === "") ctx.addIssue({ code: "custom", message: "solution vide" });
      if (o.tests.length < 4) ctx.addIssue({ code: "custom", message: "4 à 6 tests requis" });
    }
  });

export const inputsOutputSchema = z.object({ tests: z.array(testItem).min(4).max(6) });

export type SolveOutput = z.infer<typeof solveOutputSchema>;
