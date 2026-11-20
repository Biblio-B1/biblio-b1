import fs from "node:fs";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import { DOC_SOURCES, DOC_TYPES, documents, exercises, importExclusions, posts, progress, threads } from "./db/schema";
import { indexDocument, indexExercise, indexThread, removeFromIndex } from "./search";
import { resolveStoragePath } from "./storage";
import { removeUnreferencedImages } from "./threads";

export type Document = typeof documents.$inferSelect;

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  type: z.enum(DOC_TYPES),
  subjectId: z.string().min(1).nullish(),
  subjectConfirmed: z.boolean().optional(),
  filePath: z.string().min(1),
  mime: z.string().min(1),
  sha256: z.string().min(1),
  text: z.string().optional(),
  source: z.enum(DOC_SOURCES),
  sourcePath: z.string().nullish(),
  tags: z.array(z.string()).optional(),
  authorId: z.string().min(1).nullish(),
  correctionOfId: z.string().min(1).nullish(),
});

export type CreateDocumentInput = z.input<typeof createSchema>;

export function createDocument(db: Db, input: CreateDocumentInput): Document {
  const data = createSchema.parse(input);
  const doc = db.insert(documents).values(data).returning().get();
  indexDocument(db, doc);
  return doc;
}

export function getDocument(db: Db, id: string): Document | undefined {
  return db.select().from(documents).where(eq(documents.id, id)).get();
}

export function listDocuments(
  db: Db,
  filter: { subjectId?: string; type?: (typeof DOC_TYPES)[number] } = {},
): Document[] {
  const conds = [];
  if (filter.subjectId) conds.push(eq(documents.subjectId, filter.subjectId));
  if (filter.type) conds.push(eq(documents.type, filter.type));
  return db
    .select()
    .from(documents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(documents.createdAt))
    .all();
}

/** Reclasse manuellement un document (marqué confirmé). */
/**
 * Change la matière d'un document (confirmée). La matière est copiée dans ses exercices et dans
 * l'index de recherche : exercices et fils qui visent le document ou ses exercices sont réindexés.
 */
export function setDocumentSubject(
  db: Db,
  id: string,
  subjectId: string | null,
): Document | undefined {
  return db.$client.transaction(() => {
    const doc = db
      .update(documents)
      .set({ subjectId, subjectConfirmed: true })
      .where(eq(documents.id, id))
      .returning()
      .get();
    if (!doc) return undefined;
    indexDocument(db, doc);
    const exs = db.update(exercises).set({ subjectId }).where(eq(exercises.documentId, id)).returning().all();
    for (const e of exs) indexExercise(db, e);
    const exIds = exs.map((e) => e.id);
    const ths = db
      .select()
      .from(threads)
      .where(
        or(
          and(eq(threads.targetType, "document"), eq(threads.targetId, id)),
          exIds.length ? and(eq(threads.targetType, "exercise"), inArray(threads.targetId, exIds)) : undefined,
        ),
      )
      .all();
    for (const t of ths) {
      indexThread(db, t, db.select().from(posts).where(eq(posts.threadId, t.id)).orderBy(asc(posts.createdAt)).all());
    }
    return doc;
  })();
}

export type DeleteActor = { id: string | null; role: "admin" | "member" };

/** Auteur ou admin ; un document importé (local/github) n'est supprimable que par un admin. */
export function canDeleteDocument(doc: Pick<Document, "source" | "authorId">, actor: DeleteActor): boolean {
  if (actor.role === "admin") return true;
  return doc.source === "upload" && !!doc.authorId && doc.authorId === actor.id;
}

/**
 * Supprime un document avec ses exercices, la progression, les fils de discussion qui le visent
 * (ou visent ses exercices), délie les corrections qui pointent vers lui, puis efface le fichier
 * stocké s'il n'est plus utilisé et retire l'entrée de l'index. Erreurs : `not_found`, `forbidden`.
 * Un document importé supprimé est ajouté à `import_exclusions` (sauf `recordExclusion: false`).
 */
export function deleteDocument(
  db: Db,
  id: string,
  actor: DeleteActor,
  root?: string,
  opts: { recordExclusion?: boolean } = {},
): void {
  const doc = getDocument(db, id);
  if (!doc) throw new Error("not_found");
  if (!canDeleteDocument(doc, actor)) throw new Error("forbidden");

  const { exerciseIds, threadIds, fileShared, images } = db.$client.transaction(() => {
    const exerciseIds = db.select({ id: exercises.id }).from(exercises).where(eq(exercises.documentId, id)).all().map((e) => e.id);
    const threadRows = db
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.targetType, "document"), eq(threads.targetId, id)))
      .all();
    const exThreads = exerciseIds.length
      ? db.select({ id: threads.id }).from(threads).where(and(eq(threads.targetType, "exercise"), inArray(threads.targetId, exerciseIds))).all()
      : [];
    const threadIds = [...threadRows, ...exThreads].map((t) => t.id);
    const images = threadIds.length
      ? db.select({ p: posts.imagePath }).from(posts).where(inArray(posts.threadId, threadIds)).all().map((r) => r.p)
      : [];
    if (threadIds.length) db.delete(threads).where(inArray(threads.id, threadIds)).run(); // posts : cascade
    if (exerciseIds.length) {
      db.delete(progress).where(inArray(progress.exerciseId, exerciseIds)).run();
      db.delete(exercises).where(eq(exercises.documentId, id)).run();
    }
    db.update(documents).set({ correctionOfId: null }).where(eq(documents.correctionOfId, id)).run();
    if (doc.source !== "upload" && opts.recordExclusion !== false) {
      db.insert(importExclusions)
        .values({ sha256: doc.sha256, sourcePath: doc.sourcePath, deletedBy: actor.id })
        .onConflictDoNothing()
        .run();
    }
    db.delete(documents).where(eq(documents.id, id)).run();
    const fileShared = !!db.select({ id: documents.id }).from(documents).where(eq(documents.filePath, doc.filePath)).limit(1).get();
    return { exerciseIds, threadIds, fileShared, images };
  })();

  if (!fileShared) {
    try {
      fs.rmSync(resolveStoragePath(doc.filePath, root), { force: true });
    } catch {
      // fichier déjà absent ou chemin invalide : la base est déjà propre
    }
  }
  removeUnreferencedImages(db, images, root);
  removeFromIndex(db, "document", id);
  for (const e of exerciseIds) removeFromIndex(db, "exercise", e);
  for (const t of threadIds) removeFromIndex(db, "thread", t);
}
