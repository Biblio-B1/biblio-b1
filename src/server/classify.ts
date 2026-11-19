import { slugify, type Subject, type SubjectRules } from "./subjects";

export type ClassifyInput = { fileName: string; path?: string; text?: string };
export type ClassifyResult = { subjectId: string | null; scores: Record<string, number> };

const PATH_PATTERN_SCORE = 10;
/** Un segment du chemin égal au nom (ou au slug) d'une matière : indice très fort. */
export const FOLDER_MATCH_SCORE = 20;
const MAX_OCCURRENCES = 5;
export const MIN_SCORE = 3;

/** Minuscule + suppression des accents. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(haystack: string, keyword: string): number {
  const norm = normalize(keyword);
  const kw = escapeRegExp(norm).replace(/\s+/g, "\\s+");
  // Frontière de mot seulement côté mot : "#include" / "char *" finissent ou
  // commencent par un caractère non-mot, où un lookaround \w serait faux.
  const before = /^[a-z0-9_#]/.test(norm) ? "(?<![a-z0-9_])" : "";
  const after = /[a-z0-9_]$/.test(norm) ? "(?![a-z0-9_])" : "";
  return haystack.match(new RegExp(`${before}${kw}${after}`, "g"))?.length ?? 0;
}

function isRules(r: unknown): r is SubjectRules {
  return !!r && typeof r === "object" && "pathPatterns" in r && "keywords" in r;
}

/** Dossiers du chemin (sans le nom de fichier), normalisés. */
function folderSegments(p: string | undefined): string[] {
  if (!p) return [];
  return p.split(/[\\/]+/).slice(0, -1).map((s) => normalize(s).trim()).filter(Boolean);
}

/**
 * Score par matière : dossier du chemin égal au nom/slug = +20 ; motif de chemin/nom = +10
 * chacun ; mot-clé = poids × min(occurrences, 5) ; en dessous de MIN_SCORE -> aucune matière (null).
 * Dans les noms, « _ » compte comme un espace (« 2_CSS_Flexbox » -> « 2 css flexbox »).
 */
export function classify(input: ClassifyInput, subjects: Subject[]): ClassifyResult {
  const asWords = (s: string) => normalize(s).replace(/_/g, " ");
  const names = [input.fileName, input.path ?? ""].map(asWords);
  const body = `${asWords(input.fileName)}\n${normalize(input.text ?? "")}`;
  const segments = folderSegments(input.path);
  const scores: Record<string, number> = {};
  let best: string | null = null;
  let bestScore = 0;

  for (const subject of subjects) {
    if (!isRules(subject.rules)) continue;
    let score = 0;
    const subjectName = normalize(subject.name).trim();
    if (segments.some((seg) => seg === subjectName || seg === subject.slug || slugify(seg) === subject.slug)) {
      score += FOLDER_MATCH_SCORE;
    }
    for (const p of subject.rules.pathPatterns) {
      let re: RegExp;
      try {
        re = new RegExp(p, "i");
      } catch {
        continue;
      }
      if (names.some((n) => n && re.test(n))) score += PATH_PATTERN_SCORE;
    }
    for (const [kw, weight] of Object.entries(subject.rules.keywords)) {
      const n = countOccurrences(body, kw);
      if (n > 0) score += weight * Math.min(n, MAX_OCCURRENCES);
    }
    scores[subject.id] = score;
    if (score > bestScore) {
      best = subject.id;
      bestScore = score;
    }
  }
  return { subjectId: bestScore >= MIN_SCORE ? best : null, scores };
}
