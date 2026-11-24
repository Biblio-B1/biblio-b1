// Pièces jointes multiples des contrôles (exam_attachments) et des devoirs (homework_attachments).
// Fichiers dans le bucket privé « files », sous uploads/<auteur>/<sha256>.<ext> (RLS du stockage).
// Lecture : comptes actifs ; ajout : tout compte actif ; retrait : auteur de la pièce jointe ou admin.
import { FILES_BUCKET, getSupabase } from "@/lib/supabase/client";
import { mimeOf, sha256Hex, uploadStoragePath } from "@/lib/upload-core";

export const MAX_FILES = 10;
export const MAX_FILE_MB = 30;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

export type Attachment = { id: string; path: string; name: string; size: number; authorId: string | null };
export type AttachmentRow = { id: string; path: string; name: string; size: number; author_id: string | null; created_at: string };

/** Table et clé du parent : contrôle ou devoir. */
export type AttachmentTarget = { table: "exam_attachments"; fk: "exam_id" } | { table: "homework_attachments"; fk: "homework_id" };
export const EXAM_FILES: AttachmentTarget = { table: "exam_attachments", fk: "exam_id" };
export const HOMEWORK_FILES: AttachmentTarget = { table: "homework_attachments", fk: "homework_id" };

/** Lignes jointes (select « …_attachments(id, path, name, size, author_id, created_at) ») → liste triée. */
export function toAttachments(rows: AttachmentRow[] | null | undefined): Attachment[] {
  return [...(rows ?? [])]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((a) => ({ id: a.id, path: a.path, name: a.name, size: a.size, authorId: a.author_id }));
}
export const ATTACHMENT_COLUMNS = "id, path, name, size, author_id, created_at";

/** Fichiers réellement choisis dans un champ <input type="file" multiple>. */
export function pickedFiles(values: FormDataEntryValue[]): File[] {
  return values.filter((v): v is File => typeof v !== "string" && v.name.trim() !== "" && v.size > 0);
}

/** null si la sélection est acceptable, sinon le message d'erreur. `already` : pièces déjà jointes. */
export function validateFiles(files: { name: string; size: number }[], already = 0): string | null {
  if (files.length + already > MAX_FILES) return `${MAX_FILES} pièces jointes maximum.`;
  const big = files.find((f) => f.size > MAX_FILE_BYTES);
  if (big) return `« ${big.name} » dépasse la limite de ${MAX_FILE_MB} Mo.`;
  return null;
}

export type Uploaded = { path: string; name: string; mime: string; size: number };

/** Envoie les fichiers dans le stockage ; en cas d'échec, retire ceux déjà envoyés. */
export async function uploadFiles(uid: string, files: File[]): Promise<{ files: Uploaded[] } | { error: string }> {
  const storage = getSupabase().storage.from(FILES_BUCKET);
  const done: Uploaded[] = [];
  for (const file of files) {
    const name = (file.name.split(/[\\/]/).pop() ?? file.name).trim().slice(0, 255) || "piece-jointe";
    const path = uploadStoragePath(uid, await sha256Hex(await file.arrayBuffer()), name);
    const up = await storage.upload(path, file, { contentType: mimeOf(name), upsert: true });
    if (up.error) {
      await removeUnused(done.map((f) => f.path));
      return { error: `Envoi de « ${name} » impossible.` };
    }
    done.push({ path, name, mime: mimeOf(name), size: file.size });
  }
  return { files: done };
}

/** Enregistre des fichiers déjà envoyés comme pièces jointes de `parentId`. */
export async function linkFiles(target: AttachmentTarget, parentId: string, uid: string, files: Uploaded[]): Promise<boolean> {
  if (!files.length) return true;
  const { error } = await getSupabase()
    .from(target.table)
    .insert(files.map((f) => ({ ...f, [target.fk]: parentId, author_id: uid })));
  return !error;
}

/**
 * Retire du stockage les fichiers qui ne servent plus. Les chemins dépendent du contenu : le même
 * fichier peut être joint ailleurs (autre contrôle, autre devoir), on le garde alors.
 */
export async function removeUnused(paths: string[]): Promise<void> {
  const supabase = getSupabase();
  const unused: string[] = [];
  for (const path of new Set(paths)) {
    const counts = await Promise.all([
      supabase.from("exam_attachments").select("id", { count: "exact", head: true }).eq("path", path),
      supabase.from("homework_attachments").select("id", { count: "exact", head: true }).eq("path", path),
      supabase.from("homeworks").select("id", { count: "exact", head: true }).eq("attachment_path", path),
    ]);
    if (counts.every((c) => !c.count)) unused.push(path);
  }
  if (unused.length) await supabase.storage.from(FILES_BUCKET).remove(unused);
}

/** Ajoute des pièces jointes à un contrôle ou un devoir existant. */
export async function addAttachments(
  target: AttachmentTarget,
  parentId: string,
  files: File[],
  already: number,
): Promise<{ error?: string }> {
  const uid = (await getSupabase().auth.getUser()).data.user?.id;
  if (!uid) return { error: "Session expirée : reconnectez-vous." };
  const picked = pickedFiles(files);
  if (!picked.length) return { error: "Choisissez au moins un fichier." };
  const fileError = validateFiles(picked, already);
  if (fileError) return { error: fileError };
  const uploaded = await uploadFiles(uid, picked);
  if ("error" in uploaded) return { error: uploaded.error };
  if (!(await linkFiles(target, parentId, uid, uploaded.files))) {
    await removeUnused(uploaded.files.map((f) => f.path));
    return { error: "Ajout des pièces jointes impossible." };
  }
  return {};
}

export async function deleteAttachment(target: AttachmentTarget, id: string): Promise<{ error?: string }> {
  const { data, error } = await getSupabase().from(target.table).delete().eq("id", id).select("path");
  if (error || !data?.length) return { error: "Suppression réservée à l'auteur de la pièce jointe ou à un administrateur." };
  await removeUnused([(data[0] as { path: string }).path]);
  return {};
}

/** Chemins des pièces jointes d'un parent (à lire avant de le supprimer : la cascade les efface). */
export async function attachmentPaths(target: AttachmentTarget, parentId: string): Promise<string[]> {
  const { data } = await getSupabase().from(target.table).select("path").eq(target.fk, parentId);
  return ((data ?? []) as { path: string }[]).map((a) => a.path);
}
