// Devoirs collaboratifs (RLS : lus par les comptes actifs, modifiés par leur auteur ou un admin).
// Pièces jointes multiples (homework_attachments) ; « fait » propre à chaque élève (homework_done).
import type { FormState } from "@/components/ActionForm";
import {
  addAttachments,
  ATTACHMENT_COLUMNS,
  attachmentPaths,
  deleteAttachment,
  HOMEWORK_FILES,
  linkFiles,
  pickedFiles,
  removeUnused,
  toAttachments,
  uploadFiles,
  validateFiles,
  type Attachment,
  type AttachmentRow,
} from "@/lib/api/attachments";
import { validateHomework } from "@/lib/homework-rules";
import { getSupabase } from "@/lib/supabase/client";

export type HomeworkRow = {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectSlug: string;
  subjectColor: string;
  title: string;
  dueDate: string;
  englishGroup: string | null;
  /** Projet final : annoncé et rappelé sur Telegram comme un contrôle. */
  isFinalProject: boolean;
  attachments: Attachment[];
  /** Marqué « fait » par l'élève connecté. */
  done: boolean;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
};

type Joined = Record<string, unknown> & {
  subjects: { name: string; slug: string; color: string } | null;
  profiles: { name: string } | null;
  homework_attachments?: AttachmentRow[] | null;
  homework_done?: { user_id: string }[] | null;
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
    isFinalProject: r.is_final_project === true,
    attachments: toAttachments(r.homework_attachments),
    // La RLS ne renvoie que la ligne « fait » de l'élève connecté.
    done: (r.homework_done ?? []).length > 0,
    authorId: (r.author_id as string | null) ?? null,
    authorName: r.profiles?.name ?? null,
    createdAt: new Date(String(r.created_at)),
  };
}

export async function listHomeworks(): Promise<HomeworkRow[]> {
  const { data, error } = await getSupabase()
    .from("homeworks")
    .select(`*, subjects(name, slug, color), profiles(name), homework_attachments(${ATTACHMENT_COLUMNS}), homework_done(user_id)`)
    .order("due_date")
    .order("created_at");
  if (error) throw new Error(`Devoirs : ${error.message}`);
  return ((data ?? []) as Joined[]).map(toHomework);
}

// ---------------------------------------------------------------------------------------------
// Écriture
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
  const files = pickedFiles(fd.getAll("attachments"));
  const fileError = validateFiles(files);
  if (fileError) return { error: fileError };

  // Fichiers d'abord : le devoir est annoncé sur Telegram avec ses pièces jointes.
  const uploaded = await uploadFiles(uid, files);
  if ("error" in uploaded) return { error: uploaded.error };
  const finalProject = fd.get("finalProject") === "on";
  const { data: created, error } = await supabase
    .from("homeworks")
    .insert({
      subject_id: v.value.subjectId,
      title: v.value.title,
      due_date: v.value.dueDate,
      english_group: v.value.englishGroup,
      is_final_project: finalProject,
      author_id: uid,
    })
    .select("id")
    .single();
  if (error || !created) {
    await removeUnused(uploaded.files.map((f) => f.path));
    return { error: "Enregistrement impossible." };
  }
  if (!(await linkFiles(HOMEWORK_FILES, created.id, uid, uploaded.files))) {
    return { error: "Devoir enregistré, mais les pièces jointes n'ont pas pu être ajoutées." };
  }
  return {
    message: finalProject
      ? "Projet final enregistré : annoncé sur Telegram et rappelé 3, 2 et 1 semaine(s) avant, puis la veille."
      : "Devoir enregistré et partagé avec toute la promo.",
  };
}

/** Supprime un devoir (son auteur ou un admin, RLS) et ses pièces jointes. */
export async function deleteHomeworkAction(id: string): Promise<{ error?: string }> {
  const supabase = getSupabase();
  const paths = await attachmentPaths(HOMEWORK_FILES, id);
  const { data, error } = await supabase.from("homeworks").delete().eq("id", id).select("attachment_path");
  if (error || !data?.length) return { error: "Suppression réservée à l'auteur du devoir ou à un administrateur." };
  const legacy = data[0].attachment_path as string | null;
  await removeUnused(legacy ? [...paths, legacy] : paths);
  return {};
}

export const addHomeworkAttachments = (homeworkId: string, files: File[], already: number) =>
  addAttachments(HOMEWORK_FILES, homeworkId, files, already);
export const deleteHomeworkAttachment = (id: string) => deleteAttachment(HOMEWORK_FILES, id);

/** Marque (ou démarque) un devoir comme fait, pour l'élève connecté seulement. */
export async function setHomeworkDone(homeworkId: string, done: boolean): Promise<{ error?: string }> {
  const supabase = getSupabase();
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return { error: "Session expirée : reconnectez-vous." };
  const { error } = done
    ? await supabase.from("homework_done").upsert({ homework_id: homeworkId, user_id: uid }, { ignoreDuplicates: true })
    : await supabase.from("homework_done").delete().eq("homework_id", homeworkId).eq("user_id", uid);
  return error ? { error: "Enregistrement impossible." } : {};
}
