// Conversion des lignes entre SQLite (drizzle : camelCase, Date) et Supabase (snake_case, ISO),
// et décision de ce que le PC rapatrie. Sans accès aux données : testé seul.

const DATE_COLUMNS = new Set(["created_at", "updated_at", "synced_at", "deleted_at", "expires_at"]);
/** Colonnes calculées côté Postgres, jamais copiées. */
const SKIP_FROM_PG = new Set(["search"]);

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Postgres refuse le caractère nul dans le texte et le JSON (présent dans certains PDF extraits). */
function stripNul(v: unknown): unknown {
  if (typeof v === "string") return v.includes("\u0000") ? v.replaceAll("\u0000", "") : v;
  if (Array.isArray(v)) return v.map(stripNul);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, stripNul(x)]));
  }
  return v;
}

/** Ligne drizzle → ligne Supabase. */
export function toPg(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toSnake(k)] = v instanceof Date ? v.toISOString() : stripNul(v);
  return out;
}

/** Ligne Supabase → ligne drizzle (insérable dans SQLite). */
export function fromPg(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SKIP_FROM_PG.has(k)) continue;
    out[toCamel(k)] = DATE_COLUMNS.has(k) && typeof v === "string" ? new Date(v) : v;
  }
  return out;
}

export type RemotePending = { exerciseId: string; status: string; verified: boolean; updatedAt: Date };
export type LocalCheck = { status: string; updatedAt: Date };

/**
 * Vérifications en attente côté Supabase → actions locales :
 * - `fetch` : exercice inconnu du PC (déposé sur le site) → rapatrier exercice, document, matière ;
 * - `requeue` : relancé par un admin sur le site après le dernier résultat local → remettre en file.
 * Une ligne locale déjà en file ou en cours, ou un résultat local plus récent, ne change pas.
 */
export function pullPlan(remote: RemotePending[], local: Map<string, LocalCheck>): { fetch: string[]; requeue: string[] } {
  const fetch: string[] = [];
  const requeue: string[] = [];
  for (const r of remote) {
    if (r.status !== "pending" || r.verified) continue;
    const l = local.get(r.exerciseId);
    if (!l) fetch.push(r.exerciseId);
    else if (l.status !== "pending" && l.status !== "running" && r.updatedAt > l.updatedAt) requeue.push(r.exerciseId);
  }
  return { fetch, requeue };
}
