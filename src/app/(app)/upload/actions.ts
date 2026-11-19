"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { cleanupDrafts } from "@/server/drafts";
import { MAX_UPLOAD_BYTES } from "@/server/storage";
import { confirmDraft, confirmItemSchema, prepareUpload, type UploadDraft } from "@/server/uploads";

export type UploadResult = { drafts: UploadDraft[]; errors: { fileName: string; error: string }[] };
export type ConfirmResult = {
  created: { tmpId: string; id: string; title: string }[];
  errors: { tmpId: string; error: string }[];
};

const MAX_FILES = 20;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erreur inattendue.");

/**
 * Étape 1 : enregistre chaque fichier comme brouillon (STORAGE_PATH/drafts)
 * et propose une matière (classification sur le nom de fichier).
 */
export async function uploadFiles(formData: FormData): Promise<UploadResult> {
  const user = await requireUser();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size >= 0);
  const result: UploadResult = { drafts: [], errors: [] };
  if (files.length === 0) return { ...result, errors: [{ fileName: "", error: "Aucun fichier reçu." }] };
  if (files.length > MAX_FILES) {
    return { ...result, errors: [{ fileName: "", error: `${MAX_FILES} fichiers maximum par envoi.` }] };
  }
  cleanupDrafts();
  const db = getDb();
  for (const file of files) {
    const fileName = z.string().min(1).max(255).safeParse(file.name);
    if (!fileName.success) {
      result.errors.push({ fileName: "", error: "Nom de fichier invalide." });
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      result.errors.push({ fileName: fileName.data, error: "Fichier trop volumineux (50 Mo maximum)" });
      continue;
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      result.drafts.push(prepareUpload(db, buf, fileName.data, user.id));
    } catch (e) {
      result.errors.push({ fileName: fileName.data, error: errMsg(e) });
    }
  }
  return result;
}

/** Étape 2 : confirme les brouillons (matière, titre, type choisis par l'utilisateur). */
export async function confirmUploads(items: unknown): Promise<ConfirmResult> {
  const user = await requireUser();
  const parsed = z.array(confirmItemSchema).min(1).max(MAX_FILES).safeParse(items);
  if (!parsed.success) {
    return { created: [], errors: [{ tmpId: "", error: parsed.error.issues[0]?.message ?? "Données invalides." }] };
  }
  const db = getDb();
  const out: ConfirmResult = { created: [], errors: [] };
  for (const item of parsed.data) {
    try {
      const doc = confirmDraft(db, item, user.id);
      out.created.push({ tmpId: item.tmpId, id: doc.id, title: doc.title });
    } catch (e) {
      out.errors.push({ tmpId: item.tmpId, error: errMsg(e) });
    }
  }
  if (out.created.length) revalidatePath("/", "layout");
  return out;
}
