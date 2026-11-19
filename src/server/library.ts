import { count, desc, isNull } from "drizzle-orm";
import type { Db } from "./db/client";
import { documents } from "./db/schema";
import type { Document } from "./documents";
import { normalize } from "./classify";

/** Nombre de documents par matière (clé `null` = sans matière). */
export function countBySubject(db: Db): Map<string | null, number> {
  const rows = db
    .select({ subjectId: documents.subjectId, n: count() })
    .from(documents)
    .groupBy(documents.subjectId)
    .all();
  return new Map(rows.map((r) => [r.subjectId, r.n]));
}

export function listUnclassified(db: Db): Document[] {
  return db.select().from(documents).where(isNull(documents.subjectId)).orderBy(desc(documents.createdAt)).all();
}

/** Filtre de titre simple (insensible casse/accents) en attendant la recherche FTS5. */
export function filterByTitle<T extends { title: string }>(docs: T[], q: string | undefined): T[] {
  const needle = normalize(q?.trim() ?? "");
  if (!needle) return docs;
  return docs.filter((d) => normalize(d.title).includes(needle));
}
