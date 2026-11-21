import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import { DOC_TYPES, documents, subjects } from "./db/schema";
import { classify } from "./classify";
import { createDocument, type Document } from "./documents";
import { createDraft, deleteDraft, draftFilePath, readDraft, updateDraft } from "./drafts";
import { extractText } from "./extract/text";
import { env } from "./env";
import { createExercises, wantsExercises } from "./exercises";
import { resolveStoragePath, saveUpload } from "./storage";
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

export { guessType, titleFromFileName } from "@/lib/upload-core";
import { guessType, titleFromFileName } from "@/lib/upload-core";

function findBySha(db: Db, sha256: string): string | null {
  return db.select({ id: documents.id }).from(documents).where(eq(documents.sha256, sha256)).get()?.id ?? null;
}

/** Étape 1 : stocke le fichier en brouillon et propose matière + type. */
export async function prepareUpload(
  db: Db,
  buf: Buffer,
  originalName: string,
  ownerId: string,
  root: string = env.STORAGE_PATH,
): Promise<UploadDraft> {
  const name = originalName.split(/[\\/]/).pop() ?? originalName;
  const subjects = listSubjects(db);
  const first = classify({ fileName: name }, subjects).subjectId;
  let d = createDraft(buf, originalName, ownerId, first, root);
  // Le texte extrait affine la matière proposée et est conservé pour la confirmation.
  const text = await extractText(draftFilePath(d, root), d.mime);
  const subjectId = text ? classify({ fileName: name, text }, subjects).subjectId ?? first : first;
  d = updateDraft(d, { suggestedSubjectId: subjectId, text }, root);
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
  let doc: Document;
  try {
    // Document et exercices (énoncé exercice/annale) dans une même transaction.
    doc = db.$client.transaction(() => {
      const created = createDocument(db, {
        title: item.title,
        type: item.type,
        subjectId: item.subjectId,
        subjectConfirmed: true,
        filePath: saved.filePath,
        mime: saved.mime,
        sha256: saved.sha256,
        text: found.draft.text ?? "",
        source: "upload",
        authorId: ownerId,
      });
      if (wantsExercises(created, found.draft.fileName)) createExercises(db, created, found.draft.fileName);
      return created;
    })();
  } catch (e) {
    // Pas de fichier orphelin ; le brouillon reste pour une nouvelle tentative.
    fs.rmSync(resolveStoragePath(saved.filePath, root), { force: true });
    throw e;
  }
  deleteDraft(item.tmpId, root);
  return doc;
}
