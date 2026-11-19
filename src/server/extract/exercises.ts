export type ExtractedExercise = { number: number; title: string; body: string };

/**
 * Titre d'exercice en début de ligne : « Exercice », « Exercise », « Exo », « Ex » / « Ex. »,
 * éventuellement suivi de « n° », « N° » ou « no », puis le numéro.
 */
const HEADING = /^[ \t]*(?:exercices?|exercise|exo|ex)\.?[ \t]*(?:(?:n[ \t]*[°º]|no\b)\.?[ \t]*)?(\d{1,3})(?!\d)(.*)$/i;
/** En-tête de partie : « Partie 2 », « Section B », « Chapitre 3 »… (sert à distinguer les numérotations qui repartent à 1). */
const PART = /^[ \t]*(?:partie|part|section|chapitre|chapter)[ \t]+(?:\d{1,3}|[IVX]{1,5}|[A-Z])\b.*$/i;
/** Points de conduite d'une table des matières. */
const DOT_LEADER = /(?:[.·…][ \t]*){4,}|(?:\.[ \t]){3,}/;
const SEPARATOR_START = /^[ \t]*[:.\-–—)]/;
const MIN_BODY_CHARS = 20;
const MAX_TITLE_REST = 80;

/**
 * Une ligne « Exercice N … » est un vrai titre si ce qui suit le numéro est vide, commence par un
 * séparateur (« : », « . », « - », « – », « ) ») ou est un titre court (≤ 80 car.) ne commençant
 * pas par une minuscule — ce qui rejette les phrases coupées (« exercice 1 pour calculer… »).
 */
function isHeadingRest(rest: string): boolean {
  const r = rest.trim();
  if (!r) return true;
  if (SEPARATOR_START.test(rest)) return true;
  return r.length <= MAX_TITLE_REST && !/^\p{Ll}/u.test(r);
}

const compact = (s: string) => s.replace(/\s/g, "").length;

type Head = { line: number; number: number; title: string; part: string; body: string };

/**
 * Découpe un texte sur les lignes de titre d'exercice.
 * - Texte avant le premier titre ignoré ; aucun titre -> [].
 * - Lignes de table des matières (points de conduite) retirées, titres et corps.
 * - Un même numéro répété (table des matières puis vrais titres) -> une seule occurrence, celle au
 *   corps le plus substantiel (≥ 20 caractères non blancs) ; les titres au corps vide/minuscule
 *   sont écartés quand le numéro réapparaît.
 * - Si une numérotation repart à 1 sous un autre en-tête « Partie/Section/Chapitre N », les deux
 *   exercices sont conservés et leurs titres préfixés par l'en-tête (« Partie 2 – Exercice 1 »).
 *   Sans en-tête de partie, les doublons d'un même numéro sont fusionnés.
 */
export function splitExercises(text: string): ExtractedExercise[] {
  const lines = text.split(/\r?\n/);
  const heads: Head[] = [];
  const stops = new Set<number>(); // lignes qui terminent un corps (titres, parties)
  let part = "";
  lines.forEach((raw, i) => {
    if (PART.test(raw) && !DOT_LEADER.test(raw)) {
      part = raw.trim();
      stops.add(i);
      return;
    }
    const m = HEADING.exec(raw);
    if (!m) return;
    if (DOT_LEADER.test(m[2])) {
      stops.add(i); // entrée de table des matières : ni titre ni corps
      return;
    }
    if (!isHeadingRest(m[2])) return;
    stops.add(i);
    heads.push({ line: i, number: Number(m[1]), title: raw.trim(), part, body: "" });
  });
  if (!heads.length) return [];

  for (const h of heads) {
    let end = h.line + 1;
    while (end < lines.length && !stops.has(end)) end++;
    h.body = lines
      .slice(h.line + 1, end)
      .filter((l) => !DOT_LEADER.test(l))
      .join("\n")
      .trim();
  }

  const groups = new Map<string, Head[]>();
  for (const h of heads) {
    const key = `${h.part}\u0000${h.number}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  const kept = new Set<Head>();
  for (const g of groups.values()) {
    const substantial = g.filter((h) => compact(h.body) >= MIN_BODY_CHARS);
    const pool = substantial.length ? substantial : g;
    kept.add(pool.reduce((a, b) => (b.body.length > a.body.length ? b : a)));
  }

  const result = heads.filter((h) => kept.has(h));
  const partsByNumber = new Map<number, Set<string>>();
  for (const h of result) partsByNumber.set(h.number, (partsByNumber.get(h.number) ?? new Set()).add(h.part));
  return result.map((h) => ({
    number: h.number,
    title: h.part && (partsByNumber.get(h.number)?.size ?? 0) > 1 ? `${h.part} – ${h.title}` : h.title,
    body: h.body,
  }));
}
