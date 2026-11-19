import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import { DOC_TYPES, documents, subjects } from "./db/schema";
import { classify } from "./classify";
import { createDocument, type Document } from "./documents";
import { createDraft, deleteDraft, readDraft } from "./drafts";
import { env } from "./env";
import { saveUpload } from "./storage";
import { listSubjects } from "./subjects";

export type DocType = (typeof DOC_TYPES)[number];

export type UploadDraft = {
  tmpId: string;
  fileName: string;
  title: string;
  mime: string;
  size: number;
  suggestedSubjectId: string | null;
  suggestedType: DocType;
  duplicateOfId: string | null;
};

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const CODE_EXT = new Set([".c", ".h", ".py"]);

/** Type de contenu proposé d'après le nom de fichier (modifiable à la confirmation). */
export function guessType(fileName: string): DocType {
  const ext = path.extname(fileName).toLowerCase();
  const name = fileName.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (IMAGE_EXT.has(ext)) return "photo";
  if (CODE_EXT.has(ext)) return "exercise";
  if (/\b(annales?|partiel|exam(en)?|ds\d*|controle)\b/.test(name)) return "exam";
  if (/\b(td|tp|lab|exo|exercices?|exercises?)\s*\d*\b/.test(name)) return "exercise";
  if (ext === ".md" || ext === ".txt") return "note";
  return "course";
}

export function titleFromFileName(fileName: string): string {
  const t = fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  return (t || fileName).slice(0, 300);
}

function findBySha(db: Db, sha256: string): string | null {
  return db.select({ id: documents.id }).from(documents).where(eq(documents.sha256, sha256)).get()?.id ?? null;
}

/** Étape 1 : stocke le fichier en brouillon et propose matière + type. */
export function prepareUpload(
  db: Db,
  buf: Buffer,
  originalName: string,
  ownerId: string,
  root: string = env.STORAGE_PATH,
): UploadDraft {
  const name = originalName.split(/[\\/]/).pop() ?? originalName;
  const { subjectId } = classify({ fileName: name }, listSubjects(db));
  const d = createDraft(buf, originalName, ownerId, subjectId, root);
  return {
    tmpId: d.tmpId,
    fileName: d.fileName,
    title: titleFromFileName(d.fileName),
    mime: d.mime,
    size: d.size,
    suggestedSubjectId: subjectId,
    suggestedType: guessType(d.fileName),
    duplicateOfId: findBySha(db, d.sha256),
  };
}

export const confirmItemSchema = z.object({
  tmpId: z.uuid(),
  subjectId: z.string().min(1).max(100).nullable(),
  title: z.string().trim().min(1, "Titre requis.").max(300, "Titre trop long."),
  type: z.enum(DOC_TYPES),
});
export type ConfirmItem = z.input<typeof confirmItemSchema>;

/** Étape 2 : transforme un brouillon de `ownerId` en document définitif. */
export function confirmDraft(
  db: Db,
  input: ConfirmItem,
  ownerId: string,
  root: string = env.STORAGE_PATH,
): Document {
  const item = confirmItemSchema.parse(input);
  const found = readDraft(item.tmpId, ownerId, root);
  if (!found) throw new Error("Brouillon introuvable ou expiré.");
  if (item.subjectId && !db.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, item.subjectId)).get()) {
    throw new Error("Matière inconnue.");
  }
  const existing = findBySha(db, found.draft.sha256);
  if (existing) {
    deleteDraft(item.tmpId, root);
    throw new Error("Ce fichier est déjà dans la bibliothèque.");
  }
  const saved = saveUpload(found.buf, found.draft.fileName, root);
  // Task 5 : extraction de texte (documents.text) branchée ici.
  const doc = createDocument(db, {
    title: item.title,
    type: item.type,
    subjectId: item.subjectId,
    subjectConfirmed: true,
    filePath: saved.filePath,
    mime: saved.mime,
    sha256: saved.sha256,
    source: "upload",
    authorId: ownerId,
  });
  deleteDraft(item.tmpId, root);
  return doc;
}
