// Devoirs collaboratifs (RLS : lus par les comptes actifs, modifiés par leur auteur ou un admin).
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
