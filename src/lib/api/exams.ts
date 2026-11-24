// Contrôles et projets finaux (onglet « Contrôles »). RLS : lus par les comptes actifs ; ceux ajoutés
// sur le site sont modifiables par leur auteur ou un admin ; ceux de l'emploi du temps (source edt)
// sont recopiés par l'Edge Function `channel` et ne se modifient pas ici.
import type { FormState } from "@/components/ActionForm";
import { getSupabase } from "@/lib/supabase/client";
import type { ScheduleEvent } from "@/lib/calendar-view";
import { parisWallTimeToIso, shiftDateKey } from "@/lib/calendar-view";

export type ExamKind = "controle" | "projet";
export const EXAM_KIND_LABEL: Record<ExamKind, string> = { controle: "Contrôle", projet: "Projet final" };

export type ExamRow = {
  id: string;
  kind: ExamKind;
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
  source: "manual" | "edt";
  edtUid: string | null;
  authorId: string | null;
  authorName: string | null;
};

type Joined = Record<string, unknown> & {
  subjects: { name: string; color: string } | null;
  profiles: { name: string } | null;
};

const hhmm = (t: unknown) => (typeof t === "string" && t ? t.slice(0, 5) : null);

export function toExam(r: Joined): ExamRow {
  return {
    id: String(r.id),
    kind: r.kind === "projet" ? "projet" : "controle",
    subjectId: (r.subject_id as string | null) ?? null,
    subjectName: r.subjects?.name ?? (r.subject_label as string | null) ?? "Sans matière",
    subjectColor: r.subjects?.color ?? "#6b7280",
    title: String(r.title ?? ""),
    date: String(r.exam_date),
    startTime: hhmm(r.start_time),
    endTime: hhmm(r.end_time),
    location: (r.location as string | null) ?? null,
    details: (r.details as string | null) ?? null,
    source: r.source === "edt" ? "edt" : "manual",
    edtUid: (r.edt_uid as string | null) ?? null,
    authorId: (r.author_id as string | null) ?? null,
    authorName: r.profiles?.name ?? null,
  };
}

export async function listExams(): Promise<ExamRow[]> {
  const { data, error } = await getSupabase()
    .from("exams")
    .select("*, subjects(name, color), profiles(name)")
    .order("exam_date")
    .order("start_time", { nullsFirst: true });
  if (error) throw new Error(`Contrôles : ${error.message}`);
  return ((data ?? []) as Joined[]).map(toExam);
}

export type ExamInput = {
  kind: string;
  subjectId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  details: string;
};

export type ValidExam = {
  kind: ExamKind;
  subjectId: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  details: string | null;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateExam(input: ExamInput, subjectIds: string[]): { ok: true; value: ValidExam } | { ok: false; error: string } {
  const kind = input.kind === "projet" ? "projet" : input.kind === "controle" ? "controle" : null;
  if (!kind) return { ok: false, error: "Choisissez : contrôle ou projet final." };
  if (!subjectIds.includes(input.subjectId)) return { ok: false, error: "Choisissez une matière." };
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
  return { ok: true, value: { kind, subjectId: input.subjectId, title, date: input.date, startTime, endTime, location, details } };
}

export async function createExamAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = getSupabase();
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return { error: "Session expirée : reconnectez-vous." };
  const { data: subjects } = await supabase.from("subjects").select("id");
  const v = validateExam(
    {
      kind: String(fd.get("kind") ?? ""),
      subjectId: String(fd.get("subjectId") ?? ""),
      title: String(fd.get("title") ?? ""),
      date: String(fd.get("date") ?? ""),
      startTime: String(fd.get("startTime") ?? ""),
      endTime: String(fd.get("endTime") ?? ""),
      location: String(fd.get("location") ?? ""),
      details: String(fd.get("details") ?? ""),
    },
    ((subjects ?? []) as { id: string }[]).map((s) => s.id),
  );
  if (!v.ok) return { error: v.error };
  const { error } = await supabase.from("exams").insert({
    kind: v.value.kind,
    subject_id: v.value.subjectId,
    title: v.value.title,
    exam_date: v.value.date,
    start_time: v.value.startTime,
    end_time: v.value.endTime,
    location: v.value.location,
    details: v.value.details,
    author_id: uid,
  });
  if (error) return { error: "Enregistrement impossible." };
  return { message: `${EXAM_KIND_LABEL[v.value.kind]} enregistré : il apparaît sur l'emploi du temps et sera annoncé sur Telegram.` };
}

export async function deleteExamAction(id: string): Promise<{ error?: string }> {
  const { data, error } = await getSupabase().from("exams").delete().eq("id", id).select("id");
  if (error || !data?.length) return { error: "Suppression réservée à l'auteur ou à un administrateur." };
  return {};
}

/**
 * Contrôles ajoutés sur le site → événements de l'emploi du temps. Ceux de Boostcamp (source edt)
 * y sont déjà. Sans heure : toute la journée.
 */
export function examEvents(exams: ExamRow[]): ScheduleEvent[] {
  return exams
    .filter((e) => e.source === "manual")
    .map((e) => {
      const label = EXAM_KIND_LABEL[e.kind];
      const start = parisWallTimeToIso(e.date, e.startTime ?? "00:00");
      const end = !e.startTime
        ? parisWallTimeToIso(shiftDateKey(e.date, 1), "00:00")
        : e.endTime
          ? parisWallTimeToIso(e.date, e.endTime)
          : new Date(Date.parse(start) + 60 * 60_000).toISOString();
      return {
        uid: `exam:${e.id}`,
        title: `${label} · ${e.subjectName}${e.title ? ` — ${e.title}` : ""}`,
        start,
        end,
        allDay: !e.startTime,
        categories: ["EVALUATION"],
        location: e.location ?? undefined,
        description: [`Matière : ${e.subjectName}`, `Type : ${label}`, e.details ?? "", e.authorName ? `Ajouté par ${e.authorName}` : ""]
          .filter(Boolean)
          .join("\n"),
      };
    });
}
