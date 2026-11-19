import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import { DOC_SOURCES, DOC_TYPES, documents } from "./db/schema";
import { indexDocument } from "./search";

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
export function setDocumentSubject(
  db: Db,
  id: string,
  subjectId: string | null,
): Document | undefined {
  const doc = db
    .update(documents)
    .set({ subjectId, subjectConfirmed: true })
    .where(eq(documents.id, id))
    .returning()
    .get();
  if (doc) indexDocument(db, doc);
  return doc;
}
