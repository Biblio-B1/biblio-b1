// Types partagés des moteurs d'exécution (C, Python, JavaScript).
// Ce fichier et tous ceux qu'importe `engine.ts` doivent rester compatibles navigateur
// (aucun import `node:`) et exécutables par Node sans transpilation (« type stripping ») :
// imports relatifs avec extension `.ts`, pas d'`enum`, pas de `namespace`.

export type Language = "c" | "python" | "javascript";

export const LANGUAGES: readonly Language[] = ["c", "python", "javascript"];

/**
 * Résultat d'une exécution.
 * - `ok` : compilation réussie, fin normale avec code 0, pas de délai dépassé.
 * - `phase` : étape atteinte — `compile` si l'échec vient de la compilation
 *   (C : erreur clang ; Python/JS : erreur de syntaxe), sinon `run`.
 * - `exitCode` : code de sortie du programme ; `null` s'il n'a pas terminé normalement
 *   (délai dépassé, plantage WebAssembly, échec de compilation).
 * - `durationMs` : durée de compilation + exécution (hors chargement du moteur).
 */
export type RunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  phase: "compile" | "run";
  timedOut: boolean;
  exitCode: number | null;
  durationMs: number;
};

export type RunOptions = { timeoutMs?: number };

/** Délai par défaut d'une exécution (compilation comprise). */
export const DEFAULT_TIMEOUT_MS = 5000;

/** Au-delà, la sortie capturée est tronquée (protège contre les boucles d'affichage). */
export const MAX_OUTPUT_CHARS = 1_000_000;

/**
 * API JavaScript fournie au code étudiant (exécuté dans un Worker) :
 * - `input()` : renvoie la ligne suivante de l'entrée standard (sans le saut de ligne),
 *   ou `null` quand l'entrée est épuisée. `readline()` est un alias.
 * - `console.log(...)` / `console.info` / `console.debug` : écrivent sur la sortie standard,
 *   arguments séparés par une espace, saut de ligne final. Chaînes telles quelles,
 *   autres valeurs en JSON (`[1,2]`, `{"a":1}`), sinon `String(valeur)`.
 * - `console.error(...)` / `console.warn` : écrivent sur la sortie d'erreur.
 * - `await` est autorisé au niveau principal.
 * - `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval` sont fournis : le programme
 *   se termine quand le code principal a fini ET qu'aucune minuterie n'est en attente
 *   (un `setInterval` jamais arrêté mène donc au délai dépassé).
 */
export type JavaScriptStudentApi = {
  input(): string | null;
  readline(): string | null;
  console: Pick<Console, "log" | "info" | "debug" | "error" | "warn">;
};

/** Fonction `runClang` de @yowasp/clang (arborescence de fichiers virtuelle en entrée/sortie). */
export type ClangTree = { [name: string]: ClangTree | string | Uint8Array };
export type RunClang = (
  args: string[],
  files: ClangTree,
  options?: {
    stdout?: ((b: Uint8Array | null) => void) | null;
    stderr?: ((b: Uint8Array | null) => void) | null;
  },
) => Promise<ClangTree | undefined>;

/** Module @yowasp/clang (sous-ensemble utilisé). */
export type ClangModule = {
  runClang: RunClang;
  runLLVM(args: null, files: ClangTree, options: { fetchProgress: () => void }): unknown;
};

/** Sous-ensemble de l'API Pyodide utilisé ici. */
export type PyodideLike = {
  runPython(code: string): unknown;
};

/**
 * Chargeurs des moteurs WebAssembly : Node les lit dans node_modules,
 * le navigateur depuis `public/runtimes/` (copiés par scripts/copy-runtimes.mjs).
 */
export type RuntimeLoaders = {
  clang(): Promise<RunClang>;
  pyodide(): Promise<PyodideLike>;
};

/** Appelé quand le code de l'utilisateur commence (le délai démarre à ce moment-là). */
export type PhaseListener = (phase: "compile" | "run") => void;
