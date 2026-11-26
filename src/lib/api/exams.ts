// Contrôles (onglet « Contrôles » ; les projets finaux sont des devoirs cochés « projet final »). RLS : lus par les comptes actifs ; ceux ajoutés
// sur le site sont modifiables par leur auteur ou un admin ; ceux de l'emploi du temps (source edt)
// sont recopiés par l'Edge Function `channel` et ne se modifient pas ici.
import type { FormState } from "@/components/ActionForm";
import { getSupabase } from "@/lib/supabase/client";
import { isEnglishSubject } from "@/lib/homework-rules";
import {
  addAttachments,
  attachmentPaths,
  deleteAttachment,
  EXAM_FILES,
  linkFiles,
  pickedFiles,
  removeUnused,
  toAttachments,
  uploadFiles,
  validateFiles,
  type Attachment,
  type AttachmentRow,
} from "@/lib/api/attachments";
import type { ScheduleEvent } from "@/lib/calendar-view";
import { parisWallTimeToIso, shiftDateKey } from "@/lib/calendar-view";

export type ExamAttachment = Attachment;

export type ExamRow = {
  id: string;
  subjectId: string | null;
  /** Nom affiché : matière du site, sinon matière Boostcamp. */
  subjectName: string;
  subjectColor: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  details: string | null;
  /** Groupe d'anglais concerné (contrôles d'anglais). */
  englishGroup: string | null;
  source: "manual" | "edt";
  edtUid: string | null;
  authorId: string | null;
  authorName: string | null;
  attachments: ExamAttachment[];
};

type Joined = Record<string, unknown> & {
  subjects: { name: string; color: string } | null;
  profiles: { name: string } | null;
  exam_attachments?: AttachmentRow[] | null;
};

const hhmm = (t: unknown) => (typeof t === "string" && t ? t.slice(0, 5) : null);

export function toExam(r: Joined): ExamRow {
  return {
    id: String(r.id),
    subjectId: (r.subject_id as string | null) ?? null,
    subjectName: r.subjects?.name ?? (r.subject_label as string | null) ?? "Sans matière",
    subjectColor: r.subjects?.color ?? "#6b7280",
    title: String(r.title ?? ""),
    date: String(r.exam_date),
    startTime: hhmm(r.start_time),
    endTime: hhmm(r.end_time),
    location: (r.location as string | null) ?? null,
    details: (r.details as string | null) ?? null,
    englishGroup: (r.english_group as string | null) ?? null,
    source: r.source === "edt" ? "edt" : "manual",
    edtUid: (r.edt_uid as string | null) ?? null,
    authorId: (r.author_id as string | null) ?? null,
    authorName: r.profiles?.name ?? null,
    attachments: toAttachments(r.exam_attachments),
  };
}

export async function listExams(): Promise<ExamRow[]> {
  const { data, error } = await getSupabase()
    .from("exams")
    .select("*, subjects(name, color), profiles!exams_author_id_fkey(name), exam_attachments(id, path, name, size, author_id, created_at)")
    .order("exam_date")
    .order("start_time", { nullsFirst: true });
  if (error) throw new Error(`Contrôles : ${error.message}`);
  return uniqueExams(((data ?? []) as Joined[]).map(toExam));
}

/** Le même contrôle de l'emploi du temps n'apparaît qu'une fois (même matière, groupe, date et heure). */
export function uniqueExams(exams: ExamRow[]): ExamRow[] {
  const seen = new Set<string>();
  return exams.filter((e) => {
    if (e.source !== "edt") return true;
    const k = [e.date, e.startTime ?? "", e.subjectName.trim().toLowerCase(), (e.englishGroup ?? "").trim().toLowerCase()].join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type ExamInput = {
  subjectId: string;
  englishGroup?: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  details: string;
};

export type ValidExam = {
  subjectId: string;
  englishGroup: string | null;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  details: string | null;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateExam(
  input: ExamInput,
  subjects: { id: string; name: string; slug: string }[],
): { ok: true; value: ValidExam } | { ok: false; error: string } {
  const subject = subjects.find((s) => s.id === input.subjectId);
  if (!subject) return { ok: false, error: "Choisissez une matière." };
  // Anglais : plusieurs groupes, on précise lequel passe le contrôle (comme pour les devoirs).
  const english = isEnglishSubject(subject);
  const group = english ? (input.englishGroup ?? "").trim().replace(/\s+/g, " ") || null : null;
  if (english && !group) return { ok: false, error: "Précisez quel groupe d'anglais passe ce contrôle." };
  if (group && group.length > 120) return { ok: false, error: "Nom de groupe trop long (120 caractères max.)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))) {
    return { ok: false, error: "Indiquez une date valide." };
  }
  const startTime = input.startTime.trim() || null;
  const endTime = input.endTime.trim() || null;
  if ((startTime && !TIME.test(startTime)) || (endTime && !TIME.test(endTime))) return { ok: false, error: "Heure invalide." };
  if (endTime && !startTime) return { ok: false, error: "Indiquez l'heure de début avant l'heure de fin." };
  if (startTime && endTime && endTime <= startTime) return { ok: false, error: "L'heure de fin doit suivre l'heure de début." };
  const title = input.title.trim().replace(/\s+/g, " ");
  if (title.length > 300) return { ok: false, error: "Intitulé trop long (300 caractères max.)." };
  const location = input.location.trim() || null;
  if (location && location.length > 200) return { ok: false, error: "Lieu trop long (200 caractères max.)." };
  const details = input.details.trim() || null;
  if (details && details.length > 2000) return { ok: false, error: "Précisions trop longues (2000 caractères max.)." };
  return { ok: true, value: { subjectId: input.subjectId, englishGroup: group, title, date: input.date, startTime, endTime, location, details } };
}

export async function createExamAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = getSupabase();
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return { error: "Session expirée : reconnectez-vous." };
  const { data: subjects } = await supabase.from("subjects").select("id, name, slug");
  const v = validateExam(
    {
      subjectId: String(fd.get("subjectId") ?? ""),
      englishGroup: String(fd.get("englishGroup") ?? ""),
      title: String(fd.get("title") ?? ""),
      date: String(fd.get("date") ?? ""),
      startTime: String(fd.get("startTime") ?? ""),
      endTime: String(fd.get("endTime") ?? ""),
      location: String(fd.get("location") ?? ""),
      details: String(fd.get("details") ?? ""),
    },
    (subjects ?? []) as { id: string; name: string; slug: string }[],
  );
  if (!v.ok) return { error: v.error };
  const files = pickedFiles(fd.getAll("attachments"));
  const fileError = validateFiles(files);
  if (fileError) return { error: fileError };

  // Fichiers d'abord : le contrôle est annoncé sur Telegram avec ses pièces jointes.
  const uploaded = await uploadFiles(uid, files);
  if ("error" in uploaded) return { error: uploaded.error };
  const { data: created, error } = await supabase
    .from("exams")
    .insert({
      subject_id: v.value.subjectId,
      english_group: v.value.englishGroup,
      title: v.value.title,
      exam_date: v.value.date,
      start_time: v.value.startTime,
      end_time: v.value.endTime,
      location: v.value.location,
      details: v.value.details,
      author_id: uid,
    })
    .select("id")
    .single();
  if (error || !created) {
    await removeUnused(uploaded.files.map((f) => f.path));
    return { error: "Enregistrement impossible." };
  }
  if (!(await linkFiles(EXAM_FILES, created.id, uid, uploaded.files))) {
    return { error: "Contrôle enregistré, mais les pièces jointes n'ont pas pu être ajoutées." };
  }
  return { message: `Contrôle enregistré : il apparaît sur l'emploi du temps et sera annoncé sur Telegram.` };
}

export async function deleteExamAction(id: string): Promise<{ error?: string }> {
  const paths = await attachmentPaths(EXAM_FILES, id);
  const { data, error } = await getSupabase().from("exams").delete().eq("id", id).select("id");
  if (error || !data?.length) return { error: "Suppression réservée à l'auteur ou à un administrateur." };
  await removeUnused(paths);
  return {};
}

/** Ajoute des pièces jointes à un contrôle existant (y compris ceux de l'emploi du temps). */
export const addExamAttachments = (examId: string, files: File[], already: number) => addAttachments(EXAM_FILES, examId, files, already);
export const deleteExamAttachment = (id: string) => deleteAttachment(EXAM_FILES, id);

/**
 * Contrôles ajoutés sur le site → événements de l'emploi du temps. Ceux de Boostcamp (source edt)
 * y sont déjà. Sans heure : toute la journée.
 */
export function examEvents(exams: ExamRow[]): ScheduleEvent[] {
  return exams
    .filter((e) => e.source === "manual")
    .map((e) => {
      const start = parisWallTimeToIso(e.date, e.startTime ?? "00:00");
      const end = !e.startTime
        ? parisWallTimeToIso(shiftDateKey(e.date, 1), "00:00")
        : e.endTime
          ? parisWallTimeToIso(e.date, e.endTime)
          : new Date(Date.parse(start) + 60 * 60_000).toISOString();
      return {
        uid: `exam:${e.id}`,
        title: `Contrôle · ${e.subjectName}${e.englishGroup ? ` (${e.englishGroup})` : ""}${e.title ? ` — ${e.title}` : ""}`,
        start,
        end,
        allDay: !e.startTime,
        categories: ["EVALUATION"],
        location: e.location ?? undefined,
        description: [`Matière : ${e.subjectName}`, e.englishGroup ? `Groupe : ${e.englishGroup}` : "", "Type : Contrôle", e.details ?? "", e.authorName ? `Ajouté par ${e.authorName}` : ""]
          .filter(Boolean)
          .join("\n"),
      };
    });
}
