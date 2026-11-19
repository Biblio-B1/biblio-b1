export type ExtractedExercise = { number: number; title: string; body: string };

const HEADING = /^[ \t]*(?:exercice|exercise|exo)[ \t]*(\d+)\b[^\n]*$/gim;

/**
 * Découpe un texte sur les lignes « Exercice N » / « Exercise N » / « Exo N ».
 * Le texte avant le premier titre est ignoré ; sans titre -> [].
 */
export function splitExercises(text: string): ExtractedExercise[] {
  const heads = [...text.matchAll(HEADING)];
  return heads.map((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index! : text.length;
    return { number: Number(m[1]), title: m[0].trim(), body: text.slice(start, end).trim() };
  });
}
