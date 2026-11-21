import type { DOC_TYPES, LANGS } from "../db/schema";

export type DocType = (typeof DOC_TYPES)[number];
export type Lang = (typeof LANGS)[number];

/** Minuscule, sans accents, « _ » -> espace. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/_/g, " ");
}

const posix = (p: string) => p.replace(/\\/g, "/");
// Sans node:path : ce module sert aussi dans le navigateur (dépôt de fichiers).
const trimSlash = (p: string) => p.replace(/\/+$/, "");
const baseName = (relPath: string) => trimSlash(posix(relPath)).split("/").pop() ?? "";
const stem = (relPath: string) => baseName(relPath).replace(/\.[^.]+$/, "");
const dirName = (relPath: string) => {
  const p = trimSlash(posix(relPath));
  const i = p.lastIndexOf("/");
  return i <= 0 ? (i === 0 ? "/" : "") : p.slice(0, i);
};
/** Extension avec le point, comme path.extname (".pdf" ; "" pour « .bashrc » ou sans extension). */
const extName = (name: string) => /(\.[^.]*)$/.exec(name.replace(/^\.+/, ""))?.[1] ?? "";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const CODE_EXT = new Set([".c", ".h", ".py"]);
const EXAM_DIR = /^(exams?|examens?|annales?)$/;
const EXAM_WORD = /(?<![a-z])(exams?|examens?|partiels?|annales?)(?![a-z])/;
const EXERCISE_WORD = /(?<![a-z])(td|tp|lab|exos?|exercices?|exercises?)(?![a-z])/;

/**
 * Type d'un fichier importé d'après son chemin :
 * dossier `EXAMS/` (ou nom « exam », « partiel », « annale ») -> `exam` ;
 * image -> `photo` ; TD, TP, LAB, Exo, exercice, `EXERCISES/` (nom ou dossier) ou code -> `exercise` ;
 * sinon `course`.
 */
export function inferType(relPath: string): DocType {
  const p = norm(posix(relPath));
  const dirs = p.split("/").slice(0, -1).map((s) => s.trim());
  const name = baseName(p);
  const ext = extName(name);
  if (dirs.some((d) => EXAM_DIR.test(d)) || EXAM_WORD.test(name)) return "exam";
  if (IMAGE_EXT.has(ext)) return "photo";
  if (EXERCISE_WORD.test(p) || CODE_EXT.has(ext)) return "exercise";
  return "course";
}

/** Étiquettes : `0. Inspirations` -> `externe` ; `ARCHIVE/2026/NN_x` -> `chapitre-NN`. */
export function inferTags(relPath: string): string[] {
  const p = norm(posix(relPath));
  const tags: string[] = [];
  if (p.split("/").slice(0, -1).some((s) => /^\d*\.?\s*inspirations?$/.test(s.trim()))) tags.push("externe");
  const m = /(?:^|\/)archive\/\d{4}\/(\d{1,3}) /.exec(p);
  if (m) tags.push(`chapitre-${m[1].padStart(2, "0")}`);
  return tags;
}

const CORRECTION_WORD = /(?<![a-z])(corrig(e|es|ee|ees)|corrections?)(?![a-z])/;

/** Nom de corrigé : « (corrigé) », « corrige », « correction », « CORRECTION_… ». */
export function isCorrection(fileName: string): boolean {
  return CORRECTION_WORD.test(norm(stem(fileName)));
}

/** Nom sans marque de correction, normalisé (accents, casse, séparateurs). */
export function stripCorrection(fileName: string): string {
  return norm(stem(fileName))
    .replace(/\(\s*(corrig(e|es|ee|ees)|corrections?)\s*\)/g, " ")
    .replace(new RegExp(CORRECTION_WORD.source, "g"), " ")
    .replace(/[\s\-–—.()[\]]+/g, " ")
    .trim();
}

/**
 * Apparie chaque corrigé à son énoncé : même nom après retrait de la marque de correction.
 * Énoncé du même dossier en priorité, sinon un énoncé unique ailleurs. Résultat : énoncé -> corrigé.
 */
export function pairCorrections(docs: { id: string; relPath: string }[]): Map<string, string> {
  const statements = new Map<string, { id: string; dir: string }[]>();
  const corrections: { id: string; dir: string; key: string }[] = [];
  for (const d of docs) {
    const key = stripCorrection(d.relPath);
    if (!key) continue;
    const dir = norm(dirName(d.relPath));
    if (isCorrection(d.relPath)) corrections.push({ id: d.id, dir, key });
    else statements.set(key, [...(statements.get(key) ?? []), { id: d.id, dir }]);
  }
  const pairs = new Map<string, string>();
  for (const c of corrections) {
    const candidates = (statements.get(c.key) ?? []).filter((s) => s.id !== c.id);
    const sameDir = candidates.filter((s) => s.dir === c.dir);
    const target = sameDir.length ? sameDir[0] : candidates.length === 1 ? candidates[0] : undefined;
    if (target && !pairs.has(target.id)) pairs.set(target.id, c.id);
  }
  return pairs;
}

const LANG_SUFFIX = /(?:[\s\-]+\(?|\()(fr|en)\)?$/;

/**
 * Clé reliant les versions FR/EN d'un même document : même dossier et même préfixe numérique
 * (`01_Variables_Si_Boucles` ↔ `01_Variables_IF_Loops`) ; sans préfixe, même nom au suffixe
 * de langue près (`Exam_FR` ↔ `Exam_EN`).
 */
export function groupKey(relPath: string): string {
  const dir = norm(dirName(relPath));
  const s = norm(stem(relPath)).trim();
  const num = /^(\d{1,4})(?:[\s.\-]|$)/.exec(s);
  if (num) return `${dir}/#${Number(num[1])}`;
  return `${dir}/${s.replace(LANG_SUFFIX, "").replace(/\s+/g, " ").trim()}`;
}

const FR_WORDS = new Set([
  "le", "la", "les", "des", "une", "un", "et", "est", "pour", "avec", "qui", "que", "dans", "du",
  "ecrire", "fonction", "entier", "entiers", "valeur", "valeurs", "programme", "afficher", "chaque",
]);
const EN_WORDS = new Set([
  "the", "and", "is", "are", "of", "to", "with", "that", "this", "which", "write", "function",
  "integer", "integers", "value", "values", "program", "display", "each", "print",
]);

/** Langue : suffixe `_FR`/`_EN` du nom, sinon majorité de mots FR/EN du texte ; défaut `fr`. */
export function detectLang(fileName: string, text: string): Lang {
  const suffix = LANG_SUFFIX.exec(norm(stem(fileName)).trim()) ?? /_(fr|en)_/i.exec(stem(fileName));
  if (suffix) return suffix[1].toLowerCase() as Lang;
  let fr = 0;
  let en = 0;
  for (const w of norm(text.slice(0, 20000)).split(/[^a-z]+/)) {
    if (FR_WORDS.has(w)) fr++;
    else if (EN_WORDS.has(w)) en++;
  }
  return en > fr ? "en" : "fr";
}
