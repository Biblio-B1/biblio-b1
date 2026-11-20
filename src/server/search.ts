import { asc, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { z } from "zod";
import { documents, exercises, posts, threads, users } from "./db/schema";
import { DOC_TYPE_VALUES, type DocTypeValue } from "../lib/labels";

type Document = typeof documents.$inferSelect;
type Exercise = typeof exercises.$inferSelect;
type Thread = typeof threads.$inferSelect;
type Post = typeof posts.$inferSelect;

/**
 * Index plein texte FTS5 (table `search_index`, créée dans db/client.ts).
 *
 * Colonne `kind` = « <entité> » ou « document:<type> » :
 *   - `document:course|photo|exercise|exam|note` : un document (type = son type) ;
 *   - `exercise` : un exercice extrait d'un document (type de contenu « exercise ») ;
 *   - `thread`   : une note/question avec ses messages (type de contenu « note »).
 * Le filtre `kind` de search() prend les 5 types de contenu globaux : `exercise` regroupe donc
 * les documents « Exercice C » et les exercices extraits, `note` les documents « Note/Question »
 * et les fils.
 *
 * Seules `title` et `body` sont interrogées (la colonne `kind` n'est jamais appariée).
 */

/** Plafond de caractères indexés par ligne (corps) : garde `data.db` petite pour les gros PDF. */
export const MAX_BODY_CHARS = 200_000;

const cap = (s: string) => (s.length > MAX_BODY_CHARS ? s.slice(0, MAX_BODY_CHARS) : s);

type Entity = "document" | "exercise" | "thread";
type Row = {
  kind: string;
  refId: string;
  title: string;
  body: string;
  subjectId: string | null;
  authorId: string | null;
  createdAt: Date;
};

function insertRow(db: Db, r: Row): void {
  db.$client
    .prepare("INSERT INTO search_index (kind, ref_id, title, body, subject_id, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(r.kind, r.refId, r.title, cap(r.body), r.subjectId, r.authorId, r.createdAt.getTime());
}

/** Upsert : supprime les lignes de (entité, refId) puis insère. */
function upsert(db: Db, r: Row): void {
  removeFromIndex(db, r.kind.split(":")[0], r.refId);
  insertRow(db, r);
}

const documentRow = (d: Document): Row => ({
  kind: `document:${d.type}`,
  refId: d.id,
  title: d.title,
  body: [d.text, (d.tags ?? []).join(" ")].filter(Boolean).join("\n"),
  subjectId: d.subjectId,
  authorId: d.authorId,
  createdAt: d.createdAt,
});

const exerciseRow = (e: Exercise, authorId: string | null): Row => ({
  kind: "exercise",
  refId: e.id,
  title: e.title,
  body: [e.statement, e.solution ?? "", ...(e.hints ?? [])].filter(Boolean).join("\n"),
  subjectId: e.subjectId,
  authorId,
  createdAt: e.createdAt,
});

function threadRow(db: Db, t: Thread, ps: Post[]): Row {
  const target =
    t.targetType === "document"
      ? db.select({ subjectId: documents.subjectId }).from(documents).where(eq(documents.id, t.targetId)).get()
      : db.select({ subjectId: exercises.subjectId }).from(exercises).where(eq(exercises.id, t.targetId)).get();
  return {
    kind: "thread",
    refId: t.id,
    title: t.question,
    body: ps.map((p) => p.body).join("\n\n"),
    subjectId: target?.subjectId ?? null,
    authorId: t.authorId,
    createdAt: t.createdAt,
  };
}

const exerciseAuthor = (db: Db, documentId: string): string | null =>
  db.select({ a: documents.authorId }).from(documents).where(eq(documents.id, documentId)).get()?.a ?? null;

export function indexDocument(db: Db, doc: Document): void {
  upsert(db, documentRow(doc));
}

export function indexExercise(db: Db, ex: Exercise): void {
  upsert(db, exerciseRow(ex, exerciseAuthor(db, ex.documentId)));
}

export function indexThread(db: Db, thread: Thread, threadPosts: Post[]): void {
  upsert(db, threadRow(db, thread, threadPosts));
}

/** Retire de l'index les lignes d'une entité (`document` | `exercise` | `thread`). */
export function removeFromIndex(db: Db, kind: string, refId: string): void {
  db.$client
    .prepare("DELETE FROM search_index WHERE rowid IN (SELECT rowid FROM search_index WHERE ref_id = ? AND (kind = ? OR kind LIKE ?))")
    .run(refId, kind, `${kind}:%`);
}

/** Reconstruit tout l'index depuis la base (rattrapage des contenus créés avant l'index). */
export function reindexAll(db: Db): { documents: number; exercises: number; threads: number } {
  return db.$client.transaction(() => {
    db.$client.exec("DELETE FROM search_index");
    const docs = db.select().from(documents).all();
    const authors = new Map(docs.map((d) => [d.id, d.authorId]));
    for (const d of docs) insertRow(db, documentRow(d));
    const exs = db.select().from(exercises).all();
    for (const e of exs) insertRow(db, exerciseRow(e, authors.get(e.documentId) ?? null));
    const ths = db.select().from(threads).all();
    const byThread = new Map<string, Post[]>();
    for (const p of db.select().from(posts).orderBy(asc(posts.createdAt)).all()) {
      const l = byThread.get(p.threadId);
      if (l) l.push(p);
      else byThread.set(p.threadId, [p]);
    }
    for (const t of ths) insertRow(db, threadRow(db, t, byThread.get(t.id) ?? []));
    return { documents: docs.length, exercises: exs.length, threads: ths.length };
  })();
}

/** Réindexe automatiquement si l'index est vide alors que des documents existent. */
export function ensureIndex(db: Db): boolean {
  const hasIndex = db.$client.prepare("SELECT 1 FROM search_index LIMIT 1").get();
  if (hasIndex) return false;
  if (!db.select({ id: documents.id }).from(documents).limit(1).get()) return false;
  reindexAll(db);
  return true;
}

// --- Recherche ---------------------------------------------------------------

export type SearchParams = {
  q: string;
  subjectId?: string;
  /** Un des 5 types de contenu (`course`, `photo`, `exercise`, `exam`, `note`). */
  kind?: DocTypeValue;
  authorId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
};

export type SearchResult = {
  /** Type de contenu (5 valeurs globales). */
  kind: DocTypeValue;
  /** Entité indexée. */
  entity: Entity;
  refId: string;
  title: string;
  /** Extrait HTML sûr : texte échappé, correspondances entourées de `<mark>`. */
  snippet: string;
  subjectId: string | null;
  createdAt: Date;
  href: string;
};

const KIND_ROWS: Record<DocTypeValue, string[]> = {
  course: ["document:course"],
  photo: ["document:photo"],
  exam: ["document:exam"],
  exercise: ["document:exercise", "exercise"],
  note: ["document:note", "thread"],
};

/** Chaque terme devient `"terme"*` (guillemets doublés) ; les termes sans lettre/chiffre sont ignorés. */
export function toMatchQuery(q: string): string {
  const terms = q
    .split(/\s+/)
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .slice(0, 12)
    .map((t) => `"${t.replace(/"/g, '""')}"*`);
  return terms.length ? `{title body} : (${terms.join(" ")})` : "";
}

const MARK_OPEN = "\u0001";
const MARK_CLOSE = "\u0002";
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function contentType(kind: string): DocTypeValue {
  if (kind === "exercise") return "exercise";
  if (kind === "thread") return "note";
  const t = kind.split(":")[1] as DocTypeValue;
  return DOC_TYPE_VALUES.includes(t) ? t : "note";
}

export function search(db: Db, p: SearchParams): SearchResult[] {
  const match = toMatchQuery(p.q ?? "");
  if (!match) return [];
  ensureIndex(db);
  const where = ["search_index MATCH ?"];
  const args: (string | number)[] = [match];
  if (p.subjectId) (where.push("subject_id = ?"), args.push(p.subjectId));
  if (p.authorId) (where.push("author_id = ?"), args.push(p.authorId));
  if (p.kind) {
    const kinds = KIND_ROWS[p.kind] ?? [];
    where.push(`kind IN (${kinds.map(() => "?").join(",") || "NULL"})`);
    args.push(...kinds);
  }
  if (p.from) (where.push("CAST(created_at AS INTEGER) >= ?"), args.push(p.from.getTime()));
  if (p.to) (where.push("CAST(created_at AS INTEGER) <= ?"), args.push(p.to.getTime()));
  const limit = Math.min(Math.max(Math.trunc(p.limit ?? 20), 1), 100);
  let rows: { kind: string; ref_id: string; title: string; snippet: string; subject_id: string | null; created_at: number }[];
  try {
    rows = db.$client
      .prepare(
        `SELECT kind, ref_id, title,
                snippet(search_index, 3, '${MARK_OPEN}', '${MARK_CLOSE}', '…', 16) AS snippet,
                subject_id, CAST(created_at AS INTEGER) AS created_at
         FROM search_index WHERE ${where.join(" AND ")}
         ORDER BY bm25(search_index, 0, 0, 5, 1, 0, 0, 0) LIMIT ?`,
      )
      .all(...args, limit) as typeof rows;
  } catch {
    return []; // requête que FTS5 refuse malgré l'échappement : aucun résultat plutôt qu'une erreur
  }
  return rows.map((r) => {
    const entity = r.kind.split(":")[0] as Entity;
    return {
      kind: contentType(r.kind),
      entity,
      refId: r.ref_id,
      title: r.title,
      snippet: escapeHtml(r.snippet).replaceAll(MARK_OPEN, "<mark>").replaceAll(MARK_CLOSE, "</mark>"),
      subjectId: r.subject_id,
      createdAt: new Date(r.created_at),
      href: hrefFor(db, entity, r.ref_id),
    };
  });
}

function hrefFor(db: Db, entity: Entity, refId: string): string {
  if (entity === "document") return `/doc/${refId}`;
  if (entity === "exercise") return `/training/${refId}`;
  const t = db.select({ targetType: threads.targetType, targetId: threads.targetId }).from(threads).where(eq(threads.id, refId)).get();
  if (!t) return "/";
  return `${t.targetType === "exercise" ? "/training" : "/doc"}/${t.targetId}#thread-${refId}`;
}

// --- Paramètres d'URL (API et page /search) ---------------------------------------

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)));
const blank = (v: unknown) => (v === "" ? undefined : v);

const queryShape = z.object({
  q: z.string().max(200).default(""),
  subject: z.preprocess(blank, z.string().min(1).max(64).optional()),
  kind: z.preprocess(blank, z.enum(DOC_TYPE_VALUES).optional()),
  author: z.preprocess(blank, z.string().min(1).max(64).optional()),
  from: z.preprocess(blank, day.optional()),
  to: z.preprocess(blank, day.optional()),
  limit: z.preprocess(blank, z.coerce.number().int().min(1).max(100).optional()),
});

export type SearchQuery = z.infer<typeof queryShape>;

/** Valide les paramètres bruts (zod) ; `null` si invalides. Les dates `YYYY-MM-DD` sont inclusives (UTC). */
export function parseSearchQuery(raw: Record<string, string | undefined>): { query: SearchQuery; params: SearchParams } | null {
  const r = queryShape.safeParse({ ...raw, q: (raw.q ?? "").trim() });
  if (!r.success) return null;
  const v = r.data;
  return {
    query: v,
    params: {
      q: v.q,
      subjectId: v.subject,
      kind: v.kind,
      authorId: v.author,
      from: v.from ? new Date(`${v.from}T00:00:00.000Z`) : undefined,
      to: v.to ? new Date(`${v.to}T23:59:59.999Z`) : undefined,
      limit: v.limit,
    },
  };
}

/** Membres proposés dans le filtre « auteur ». */
export function listAuthors(db: Db): { id: string; name: string }[] {
  return db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)).all();
}
