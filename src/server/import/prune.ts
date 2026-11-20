import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { documents, subjects } from "../db/schema";
import { deleteDocument } from "../documents";
import { DEFAULT_SUBJECTS } from "../subjects";
import { isExcludedPath } from "./exclusions";

export type PruneResult = {
  documents: { id: string; title: string; sourcePath: string }[];
  /** Noms des matières supprimées (vides, hors matières par défaut). */
  subjects: string[];
};

/**
 * Nettoyage : supprime les documents importés dont le chemin source est désormais exclu, puis les
 * matières vides absentes de DEFAULT_SUBJECTS. Idempotent. `dryRun` : calcule sans rien modifier.
 * Les documents supprimés ne sont pas ajoutés à `import_exclusions` : les règles suffisent.
 */
export function pruneImported(db: Db, storage?: string, opts: { dryRun?: boolean } = {}): PruneResult {
  const result: PruneResult = { documents: [], subjects: [] };
  const imported = db
    .select()
    .from(documents)
    .where(inArray(documents.source, ["local", "github"]))
    .all();
  const doomed = imported.filter((d) => d.sourcePath && isExcludedPath(d.sourcePath));
  for (const d of doomed) {
    result.documents.push({ id: d.id, title: d.title, sourcePath: d.sourcePath! });
    if (!opts.dryRun) deleteDocument(db, d.id, { id: null, role: "admin" }, storage, { recordExclusion: false });
  }

  const keep = new Set(DEFAULT_SUBJECTS.map((s) => s.slug));
  const empty = db
    .select()
    .from(subjects)
    .where(sql`not exists (select 1 from documents d where d.subject_id = ${subjects.id}) and not exists (select 1 from exercises e where e.subject_id = ${subjects.id})`)
    .all()
    .filter((s) => !keep.has(s.slug));
  for (const s of empty) {
    result.subjects.push(s.name);
    if (!opts.dryRun) db.delete(subjects).where(and(eq(subjects.id, s.id))).run();
  }
  return result;
}
