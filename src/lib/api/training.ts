// Entraînement via Supabase. Les fonctions « …Action » gardent la signature des anciennes server
// actions (mêmes retours { error?, message? }) : les composants existants n'ont qu'un import à changer.
// La RLS garantit qu'un membre n'écrit que sa progression / ses tentatives et que seul un admin
// modifie les vérifications et les signalements.
import { canVerify, nextProgress, parseTestsJson, requeueDecision, type CheckTest, type ProgressStatus } from "@/lib/check-rules";
import { getSupabase } from "@/lib/supabase/client";
import type { ExerciseLite, Lang } from "./training-core";

type Result = { error?: string; message?: string };
const LANGUAGES = ["c", "python", "javascript"] as const;
const PROGRESS = ["todo", "doing", "mastered"] as const;
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

async function myId(): Promise<string | null> {
  const { data } = await getSupabase().auth.getUser();
  return data.user?.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------------------------
export async function listAllExercises(): Promise<ExerciseLite[]> {
  const { data, error } = await getSupabase()
    .from("exercises")
    .select("id, document_id, number, title, statement, lang, group_key, subject_id")
    .order("subject_id")
    .order("document_id")
    .order("number");
  if (error) throw new Error(`Exercices : ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    documentId: r.document_id,
    number: r.number,
    title: r.title,
    statement: r.statement,
    lang: r.lang as Lang,
    groupKey: r.group_key,
    subjectId: r.subject_id,
  }));
}

export async function getMyProgress(): Promise<Map<string, ProgressStatus>> {
  const { data, error } = await getSupabase().from("progress").select("exercise_id, status");
  if (error) throw new Error(`Progression : ${error.message}`);
  return new Map((data ?? []).map((r) => [r.exercise_id as string, r.status as ProgressStatus]));
}

export type CheckView = {
  status: string;
  language: (typeof LANGUAGES)[number] | null;
  tests: CheckTest[];
  verified: boolean;
  reports?: { id: string; message: string; authorName: string; createdAt: string }[];
};

export type ExerciseDetail = {
  exercise: ExerciseLite & { solution: string | null; hints: string[] | null };
  document: { id: string; title: string } | null;
  variants: { id: string; lang: Lang }[];
  status: ProgressStatus;
  check: CheckView | null;
  attempt: { language: (typeof LANGUAGES)[number]; code: string } | null;
};

export async function getExerciseDetail(id: string, isAdmin: boolean): Promise<ExerciseDetail | null> {
  if (!isUuid(id)) return null;
  const supabase = getSupabase();
  const uid = await myId();
  const { data: ex } = await supabase.from("exercises").select("*").eq("id", id).maybeSingle();
  if (!ex) return null;
  const [doc, variants, progress, check, attempt, reports] = await Promise.all([
    supabase.from("documents").select("id, title").eq("id", ex.document_id).maybeSingle(),
    supabase.from("exercises").select("id, lang").eq("group_key", ex.group_key).neq("id", ex.id).neq("lang", ex.lang),
    supabase.from("progress").select("status").eq("exercise_id", id).eq("user_id", uid ?? "").maybeSingle(),
    supabase.from("exercise_checks").select("status, language, tests, verified").eq("exercise_id", id).maybeSingle(),
    supabase.from("code_attempts").select("language, code").eq("exercise_id", id).eq("user_id", uid ?? "").maybeSingle(),
    isAdmin
      ? supabase.from("check_reports").select("id, message, created_at, profiles(name)").eq("exercise_id", id).eq("resolved", false).order("created_at")
      : Promise.resolve({ data: null }),
  ]);
  return {
    exercise: {
      id: ex.id,
      documentId: ex.document_id,
      number: ex.number,
      title: ex.title,
      statement: ex.statement,
      lang: ex.lang,
      groupKey: ex.group_key,
      subjectId: ex.subject_id,
      solution: ex.solution,
      hints: ex.hints,
    },
    document: doc.data ?? null,
    variants: (variants.data ?? []) as { id: string; lang: Lang }[],
    status: (progress.data?.status as ProgressStatus | undefined) ?? "todo",
    check: check.data
      ? {
          status: check.data.status,
          language: check.data.language,
          tests: (check.data.tests as CheckTest[]) ?? [],
          verified: check.data.verified,
          reports: isAdmin
            ? ((reports.data ?? []) as unknown as { id: string; message: string; created_at: string; profiles: { name: string } | null }[]).map((r) => ({
                id: r.id,
                message: r.message,
                authorName: r.profiles?.name ?? "?",
                createdAt: r.created_at,
              }))
            : undefined,
        }
      : null,
    attempt: attempt.data ? { language: attempt.data.language, code: attempt.data.code } : null,
  };
}

export type OpenReport = { id: string; exerciseId: string; exerciseTitle: string; message: string; authorName: string; createdAt: Date };

/** Admin : signalements non traités, du plus ancien au plus récent. */
export async function listOpenReports(): Promise<OpenReport[]> {
  const { data, error } = await getSupabase()
    .from("check_reports")
    .select("id, exercise_id, message, created_at, profiles(name), exercises(title)")
    .eq("resolved", false)
    .order("created_at");
  if (error) throw new Error(`Signalements : ${error.message}`);
  return ((data ?? []) as unknown as {
    id: string;
    exercise_id: string;
    message: string;
    created_at: string;
    profiles: { name: string } | null;
    exercises: { title: string } | null;
  }[]).map((r) => ({
    id: r.id,
    exerciseId: r.exercise_id,
    exerciseTitle: r.exercises?.title ?? "Exercice",
    message: r.message,
    authorName: r.profiles?.name ?? "?",
    createdAt: new Date(r.created_at),
  }));
}

// ---------------------------------------------------------------------------------------------
// Écriture (mêmes signatures que les anciennes server actions)
// ---------------------------------------------------------------------------------------------
async function writeProgress(exerciseId: string, status: ProgressStatus): Promise<string | null> {
  const uid = await myId();
  if (!uid) return "Session expirée : reconnectez-vous.";
  const { error } = await getSupabase()
    .from("progress")
    .upsert({ user_id: uid, exercise_id: exerciseId, status, updated_at: new Date().toISOString() });
  return error ? "Enregistrement impossible." : null;
}

export async function setStatusAction(exerciseId: string, status: string): Promise<Result> {
  if (!isUuid(exerciseId) || !(PROGRESS as readonly string[]).includes(status)) return { error: "Statut invalide." };
  const error = await writeProgress(exerciseId, status as ProgressStatus);
  return error ? { error } : {};
}

/** Enregistre le dernier code ; progression `doing`, ou `mastered` si réussi (jamais de rétrogradation). */
export async function saveAttemptAction(exerciseId: string, language: string, code: string, passed: boolean): Promise<Result> {
  if (!isUuid(exerciseId) || !(LANGUAGES as readonly string[]).includes(language) || code.length > 100_000) {
    return { error: "Code ou langage invalide." };
  }
  const uid = await myId();
  if (!uid) return { error: "Session expirée : reconnectez-vous." };
  const supabase = getSupabase();
  const { error } = await supabase
    .from("code_attempts")
    .upsert({ user_id: uid, exercise_id: exerciseId, language, code, passed, updated_at: new Date().toISOString() }, { onConflict: "user_id,exercise_id" });
  if (error) return { error: "Enregistrement impossible." };
  const { data: cur } = await supabase.from("progress").select("status").eq("exercise_id", exerciseId).eq("user_id", uid).maybeSingle();
  const next = nextProgress(cur?.status as ProgressStatus | undefined, passed);
  if (next) {
    const e = await writeProgress(exerciseId, next);
    if (e) return { error: e };
  }
  return {};
}

export async function reportCheckAction(exerciseId: string, message: string): Promise<Result> {
  const m = typeof message === "string" ? message.trim() : "";
  if (!m || m.length > 2000) return { error: "Message vide ou trop long (2 000 caractères max)." };
  if (!isUuid(exerciseId)) return { error: "Exercice introuvable." };
  const uid = await myId();
  const { error } = await getSupabase().from("check_reports").insert({ user_id: uid, exercise_id: exerciseId, message: m });
  return error ? { error: "Signalement impossible." } : { message: "Merci, le signalement a été envoyé." };
}

export async function verifyCheckAction(exerciseId: string): Promise<Result> {
  const supabase = getSupabase();
  const { data: row } = await supabase.from("exercise_checks").select("status, language, tests").eq("exercise_id", exerciseId).maybeSingle();
  if (!row) return { error: "Exercice introuvable." };
  if (!canVerify({ status: row.status, language: row.language, tests: row.tests as unknown[] })) {
    return {
      error:
        "Validation impossible : le pré-calcul n'a pas produit de tests (statut autre que « ready »). Modifiez les tests à la main.",
    };
  }
  const { data, error } = await supabase
    .from("exercise_checks")
    .update({ verified: true, verified_by: await myId(), updated_at: new Date().toISOString() })
    .eq("exercise_id", exerciseId)
    .eq("status", "ready")
    .select("exercise_id");
  if (error || !data?.length) return { error: "Action réservée aux administrateurs." };
  return { message: "Tests validés." };
}

export async function updateTestsAction(exerciseId: string, json: string, language?: string | null): Promise<Result> {
  if (language && !(LANGUAGES as readonly string[]).includes(language)) return { error: "Langage invalide." };
  const parsed = parseTestsJson(typeof json === "string" ? json : "");
  if (!parsed.ok) return { error: parsed.error };
  const supabase = getSupabase();
  const { data: row } = await supabase.from("exercise_checks").select("language").eq("exercise_id", exerciseId).maybeSingle();
  if (!row) return { error: "Exercice introuvable." };
  const lang = language || row.language;
  if (!lang) return { error: "Choisissez le langage des tests." };
  const { data, error } = await supabase
    .from("exercise_checks")
    .update({ tests: parsed.tests, language: lang, status: "ready", error: null, verified: true, verified_by: await myId(), updated_at: new Date().toISOString() })
    .eq("exercise_id", exerciseId)
    .select("exercise_id");
  if (error || !data?.length) return { error: "Action réservée aux administrateurs." };
  return { message: "Tests enregistrés et validés." };
}

export async function retryCheckAction(exerciseId: string, confirm?: boolean): Promise<Result> {
  const supabase = getSupabase();
  const { data: row } = await supabase.from("exercise_checks").select("status, verified").eq("exercise_id", exerciseId).maybeSingle();
  if (!row) return { error: "Exercice introuvable." };
  const decision = requeueDecision(row, confirm === true);
  if (decision === "verified") return { error: "Tests validés par un administrateur : confirmez pour retirer la validation et relancer le pré-calcul." };
  if (decision === "busy") return { error: "Pré-calcul en cours : réessayez quand il sera terminé." };
  const { data, error } = await supabase
    .from("exercise_checks")
    .update({ status: "pending", verified: false, verified_by: null, attempts: 0, error: null, updated_at: new Date().toISOString() })
    .eq("exercise_id", exerciseId)
    .select("exercise_id");
  if (error || !data?.length) return { error: "Action réservée aux administrateurs." };
  return { message: "Exercice remis en file du pré-calcul." };
}

export async function resolveReportAction(reportId: string): Promise<Result> {
  if (!isUuid(reportId)) return { error: "Signalement introuvable." };
  const { data, error } = await getSupabase().from("check_reports").update({ resolved: true }).eq("id", reportId).select("id");
  if (error || !data?.length) return { error: "Action réservée aux administrateurs." };
  return { message: "Signalement marqué comme traité." };
}
