import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { documents, exercises, subjects } from "../db/schema";
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
  // Matières sans document ni exercice (en simulation : une fois les documents condamnés retirés).
  const doomedIds = new Set(result.documents.map((d) => d.id));
  const counts = new Map<string, number>();
  for (const d of db.select({ id: documents.id, subjectId: documents.subjectId }).from(documents).all()) {
    if (d.subjectId && !doomedIds.has(d.id)) counts.set(d.subjectId, (counts.get(d.subjectId) ?? 0) + 1);
  }
  const withExercises = new Set(
    db.select({ s: exercises.subjectId }).from(exercises).all().map((e) => e.s).filter((x): x is string => !!x),
  );
  const empty = db
    .select()
    .from(subjects)
    .all()
    .filter((s) => !keep.has(s.slug) && !counts.has(s.id) && !withExercises.has(s.id));
  for (const s of empty) {
    result.subjects.push(s.name);
    if (!opts.dryRun) db.delete(subjects).where(eq(subjects.id, s.id)).run();
  }
  return result;
}
