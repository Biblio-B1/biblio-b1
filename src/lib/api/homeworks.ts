// Devoirs collaboratifs (RLS : lus par les comptes actifs, modifiés par leur auteur ou un admin).
import type { FormState } from "@/components/ActionForm";
import { MAX_HOMEWORK_ATTACHMENT_BYTES, MAX_HOMEWORK_ATTACHMENT_MB, validateHomework } from "@/lib/homework-rules";
import { mimeOf, sha256Hex, uploadStoragePath } from "@/lib/upload-core";
import { FILES_BUCKET, getSupabase } from "@/lib/supabase/client";

export type HomeworkRow = {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectSlug: string;
  subjectColor: string;
  title: string;
  dueDate: string;
  englishGroup: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  attachmentSize: number | null;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
};

type Joined = Record<string, unknown> & {
  subjects: { name: string; slug: string; color: string } | null;
  profiles: { name: string } | null;
};

export function toHomework(r: Joined): HomeworkRow {
  return {
    id: String(r.id),
    subjectId: String(r.subject_id),
    subjectName: r.subjects?.name ?? "",
    subjectSlug: r.subjects?.slug ?? "",
    subjectColor: r.subjects?.color ?? "#6b7280",
    title: String(r.title),
    dueDate: String(r.due_date),
    englishGroup: (r.english_group as string | null) ?? null,
    attachmentPath: (r.attachment_path as string | null) ?? null,
    attachmentName: (r.attachment_name as string | null) ?? null,
    attachmentMime: (r.attachment_mime as string | null) ?? null,
    attachmentSize: (r.attachment_size as number | null) ?? null,
    authorId: (r.author_id as string | null) ?? null,
    authorName: r.profiles?.name ?? null,
    createdAt: new Date(String(r.created_at)),
  };
}

export async function listHomeworks(): Promise<HomeworkRow[]> {
  const { data, error } = await getSupabase()
    .from("homeworks")
    .select("*, subjects(name, slug, color), profiles(name)")
    .order("due_date")
    .order("created_at");
  if (error) throw new Error(`Devoirs : ${error.message}`);
  return ((data ?? []) as Joined[]).map(toHomework);
}

// ---------------------------------------------------------------------------------------------
// Écriture (mêmes signatures que les anciennes server actions)
// ---------------------------------------------------------------------------------------------
export async function createHomeworkAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = getSupabase();
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return { error: "Session expirée : reconnectez-vous." };
  const { data: subjects } = await supabase.from("subjects").select("id, name, slug");
  const v = validateHomework(
    {
      subjectId: String(fd.get("subjectId") ?? ""),
      title: String(fd.get("title") ?? ""),
      dueDate: String(fd.get("dueDate") ?? ""),
      englishGroup: String(fd.get("englishGroup") ?? ""),
    },
    (subjects ?? []) as { id: string; name: string; slug: string }[],
  );
  if (!v.ok) return { error: v.error };

  let attachment: { path: string; name: string; mime: string; size: number } | null = null;
  const file = fd.get("attachment");
  if (file instanceof File && file.name.trim()) {
    if (file.size === 0) return { error: "La pièce jointe est vide." };
    if (file.size > MAX_HOMEWORK_ATTACHMENT_BYTES) return { error: `La pièce jointe dépasse la limite de ${MAX_HOMEWORK_ATTACHMENT_MB} Mo.` };
    const name = (file.name.split(/[\\/]/).pop() ?? file.name).trim().slice(0, 255) || "piece-jointe";
    const path = uploadStoragePath(uid, await sha256Hex(await file.arrayBuffer()), name);
    const up = await supabase.storage.from(FILES_BUCKET).upload(path, file, { contentType: mimeOf(name), upsert: true });
    if (up.error) return { error: "Envoi de la pièce jointe impossible." };
    attachment = { path, name, mime: mimeOf(name), size: file.size };
  }

  const { error } = await supabase.from("homeworks").insert({
    subject_id: v.value.subjectId,
    title: v.value.title,
    due_date: v.value.dueDate,
    english_group: v.value.englishGroup,
    attachment_path: attachment?.path ?? null,
    attachment_name: attachment?.name ?? null,
    attachment_mime: attachment?.mime ?? null,
    attachment_size: attachment?.size ?? null,
    author_id: uid,
  });
  if (error) {
    if (attachment) await supabase.storage.from(FILES_BUCKET).remove([attachment.path]);
    return { error: "Enregistrement impossible." };
  }
  return { message: "Devoir enregistré et partagé avec toute la promo." };
}

/** Supprime un devoir (son auteur ou un admin, RLS) et sa pièce jointe. */
export async function deleteHomeworkAction(id: string): Promise<{ error?: string }> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("homeworks").delete().eq("id", id).select("attachment_path");
  if (error || !data?.length) return { error: "Suppression réservée à l'auteur du devoir ou à un administrateur." };
  const path = data[0].attachment_path as string | null;
  if (path) await supabase.storage.from(FILES_BUCKET).remove([path]);
  return {};
}
