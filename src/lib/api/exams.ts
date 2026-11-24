// Contrôles et projets finaux (onglet « Contrôles »). RLS : lus par les comptes actifs ; ceux ajoutés
// sur le site sont modifiables par leur auteur ou un admin ; ceux de l'emploi du temps (source edt)
// sont recopiés par l'Edge Function `channel` et ne se modifient pas ici.
import type { FormState } from "@/components/ActionForm";
import { FILES_BUCKET, getSupabase } from "@/lib/supabase/client";
import { mimeOf, sha256Hex, uploadStoragePath } from "@/lib/upload-core";
import type { ScheduleEvent } from "@/lib/calendar-view";
import { parisWallTimeToIso, shiftDateKey } from "@/lib/calendar-view";

export type ExamKind = "controle" | "projet";
export const EXAM_KIND_LABEL: Record<ExamKind, string> = { controle: "Contrôle", projet: "Projet final" };

export const MAX_EXAM_FILES = 10;
export const MAX_EXAM_FILE_MB = 30;
const MAX_EXAM_FILE_BYTES = MAX_EXAM_FILE_MB * 1024 * 1024;

export type ExamAttachment = { id: string; path: string; name: string; size: number; authorId: string | null };

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
  attachments: ExamAttachment[];
};

type Joined = Record<string, unknown> & {
  subjects: { name: string; color: string } | null;
  profiles: { name: string } | null;
  exam_attachments?: { id: string; path: string; name: string; size: number; author_id: string | null; created_at: string }[] | null;
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
    attachments: [...(r.exam_attachments ?? [])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((a) => ({ id: a.id, path: a.path, name: a.name, size: a.size, authorId: a.author_id })),
  };
}

export async function listExams(): Promise<ExamRow[]> {
  const { data, error } = await getSupabase()
    .from("exams")
    .select("*, subjects(name, color), profiles(name), exam_attachments(id, path, name, size, author_id, created_at)")
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
  const files = pickedFiles(fd.getAll("attachments"));
  const fileError = validateExamFiles(files);
  if (fileError) return { error: fileError };

  // Fichiers d'abord : le contrôle est annoncé sur Telegram avec ses pièces jointes.
  const uploaded = await uploadFiles(uid, files);
  if ("error" in uploaded) return { error: uploaded.error };
  const { data: created, error } = await supabase
    .from("exams")
    .insert({
      kind: v.value.kind,
      subject_id: v.value.subjectId,
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
  if (uploaded.files.length) {
    const { error: attError } = await supabase
      .from("exam_attachments")
      .insert(uploaded.files.map((f) => ({ ...f, exam_id: created.id, author_id: uid })));
    if (attError) return { error: "Contrôle enregistré, mais les pièces jointes n'ont pas pu être ajoutées." };
  }
  return { message: `${EXAM_KIND_LABEL[v.value.kind]} enregistré : il apparaît sur l'emploi du temps et sera annoncé sur Telegram.` };
}

export async function deleteExamAction(id: string): Promise<{ error?: string }> {
  const supabase = getSupabase();
  const { data: atts } = await supabase.from("exam_attachments").select("path").eq("exam_id", id);
  const { data, error } = await supabase.from("exams").delete().eq("id", id).select("id");
  if (error || !data?.length) return { error: "Suppression réservée à l'auteur ou à un administrateur." };
  await removeUnused(((atts ?? []) as { path: string }[]).map((a) => a.path));
  return {};
}

// ---------------------------------------------------------------------------------------------
// Pièces jointes
// ---------------------------------------------------------------------------------------------
/** Fichiers réellement choisis dans un champ <input type="file" multiple>. */
export function pickedFiles(values: FormDataEntryValue[]): File[] {
  return values.filter((v): v is File => typeof v !== "string" && v.name.trim() !== "" && v.size > 0);
}

/** null si la sélection est acceptable, sinon le message d'erreur. */
export function validateExamFiles(files: { name: string; size: number }[], already = 0): string | null {
  if (files.length + already > MAX_EXAM_FILES) return `${MAX_EXAM_FILES} pièces jointes maximum par contrôle.`;
  const big = files.find((f) => f.size > MAX_EXAM_FILE_BYTES);
  if (big) return `« ${big.name} » dépasse la limite de ${MAX_EXAM_FILE_MB} Mo.`;
  return null;
}

type Uploaded = { path: string; name: string; mime: string; size: number };

async function uploadFiles(uid: string, files: File[]): Promise<{ files: Uploaded[] } | { error: string }> {
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

/**
 * Retire du stockage les fichiers qui ne servent plus. Les chemins dépendent du contenu : le même
 * fichier peut être joint ailleurs (autre contrôle, devoir), on le garde alors.
 */
async function removeUnused(paths: string[]): Promise<void> {
  const supabase = getSupabase();
  const unused: string[] = [];
  for (const path of new Set(paths)) {
    const [a, h] = await Promise.all([
      supabase.from("exam_attachments").select("id", { count: "exact", head: true }).eq("path", path),
      supabase.from("homeworks").select("id", { count: "exact", head: true }).eq("attachment_path", path),
    ]);
    if (!a.count && !h.count) unused.push(path);
  }
  if (unused.length) await supabase.storage.from(FILES_BUCKET).remove(unused);
}

/** Ajoute des pièces jointes à un contrôle existant (y compris ceux de l'emploi du temps). */
export async function addExamAttachments(examId: string, files: File[], already: number): Promise<{ error?: string }> {
  const supabase = getSupabase();
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return { error: "Session expirée : reconnectez-vous." };
  const picked = pickedFiles(files);
  if (!picked.length) return { error: "Choisissez au moins un fichier." };
  const fileError = validateExamFiles(picked, already);
  if (fileError) return { error: fileError };
  const uploaded = await uploadFiles(uid, picked);
  if ("error" in uploaded) return { error: uploaded.error };
  const { error } = await supabase
    .from("exam_attachments")
    .insert(uploaded.files.map((f) => ({ ...f, exam_id: examId, author_id: uid })));
  if (error) {
    await removeUnused(uploaded.files.map((f) => f.path));
    return { error: "Ajout des pièces jointes impossible." };
  }
  return {};
}

export async function deleteExamAttachment(id: string): Promise<{ error?: string }> {
  const { data, error } = await getSupabase().from("exam_attachments").delete().eq("id", id).select("path");
  if (error || !data?.length) return { error: "Suppression réservée à l'auteur de la pièce jointe ou à un administrateur." };
  await removeUnused([(data[0] as { path: string }).path]);
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
