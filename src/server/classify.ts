import type { Subject, SubjectRules } from "./subjects";

export type ClassifyInput = { fileName: string; path?: string; text?: string };
export type ClassifyResult = { subjectId: string | null; scores: Record<string, number> };

const PATH_PATTERN_SCORE = 10;
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

/**
 * Score par matière : motif de chemin/nom = +10 chacun ; mot-clé = poids ×
 * min(occurrences, 5) ; en dessous de MIN_SCORE -> aucune matière (null).
 */
export function classify(input: ClassifyInput, subjects: Subject[]): ClassifyResult {
  const names = [input.fileName, input.path ?? ""].map(normalize);
  const body = normalize(`${input.fileName}\n${input.text ?? ""}`);
  const scores: Record<string, number> = {};
  let best: string | null = null;
  let bestScore = 0;

  for (const subject of subjects) {
    if (!isRules(subject.rules)) continue;
    let score = 0;
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
