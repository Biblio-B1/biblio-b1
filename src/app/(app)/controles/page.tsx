"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import type { FormState } from "@/components/ActionForm";
import { PageRefreshProvider, usePageRefresh } from "@/components/PageRefresh";
import { IconCalendar } from "@/components/layout/Icons";
import { Spine } from "@/components/layout/Spine";
import { createExamAction, deleteExamAction, EXAM_KIND_LABEL, listExams, type ExamRow } from "@/lib/api/exams";
import { listSubjects } from "@/lib/api/library";
import { useData } from "@/lib/api/use-data";
import { labelDate, todayKeyInParis } from "@/lib/calendar-view";

type SubjectOpt = { id: string; name: string; color: string };

const hour = (t: string) => t.replace(":", "h");

function when(e: ExamRow): string {
  const day = labelDate(e.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (!e.startTime) return day;
  return `${day}, ${hour(e.startTime)}${e.endTime ? `–${hour(e.endTime)}` : ""}`;
}

function ExamItem({ exam, onDeleted }: { exam: ExamRow; onDeleted: () => void }) {
  const [pending, startTransition] = useTransition();
  const [delError, setDelError] = useState<string | null>(null);
  const projet = exam.kind === "projet";
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4" style={{ boxShadow: `inset 4px 0 0 ${exam.subjectColor}` }}>
      <div className="flex flex-wrap items-start justify-between gap-2 pl-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${projet ? "bg-focus text-white" : "bg-danger text-white"}`}
          >
            {EXAM_KIND_LABEL[exam.kind]}
          </span>
          <span className="text-sm font-semibold text-ink">{exam.subjectName}</span>
          {exam.source === "edt" && (
            <span className="rounded-full border border-line bg-sunken px-2 py-0.5 text-xs text-ink-2">Emploi du temps Boostcamp</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <time dateTime={exam.date} className="text-xs font-medium capitalize text-ink-2">
            {projet && !exam.startTime ? "À rendre le " : ""}
            {when(exam)}
          </time>
          {exam.source === "manual" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setDelError(null);
                startTransition(async () => {
                  const res = await deleteExamAction(exam.id);
                  if (res.error) setDelError(res.error);
                  else onDeleted();
                });
              }}
              className="btn btn-ghost h-7 px-2 text-xs text-danger"
            >
              {pending ? "…" : "Supprimer"}
            </button>
          )}
        </div>
      </div>
      {exam.title && <p className="pl-1.5 text-[15px] leading-relaxed text-ink">{exam.title}</p>}
      {exam.details && <p className="pl-1.5 whitespace-pre-wrap text-sm text-ink-2">{exam.details}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 pl-1.5 text-xs text-ink-3">
        <span>{exam.location ? `📍 ${exam.location}` : ""}</span>
        {exam.source === "manual" && <span>Ajouté par {exam.authorName ?? "un élève"}</span>}
      </div>
      {delError && (
        <p role="alert" className="pl-1.5 text-xs text-danger">
          {delError}
        </p>
      )}
    </li>
  );
}

function ExamsClient({ subjects, exams }: { subjects: SubjectOpt[]; exams: ExamRow[] }) {
  const router = usePageRefresh();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [kind, setKind] = useState<"controle" | "projet">("controle");
  const [formKey, setFormKey] = useState(0);
  const [showPast, setShowPast] = useState(false);
  const selected = subjects.find((s) => s.id === subjectId);

  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await createExamAction(prev, fd);
    if (!res?.error) {
      setFormKey((k) => k + 1);
      router.refresh();
    }
    return res;
  }, null);

  const today = todayKeyInParis();
  const upcoming = exams.filter((e) => e.date >= today);
  const past = exams.filter((e) => e.date < today).reverse();

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="new-exam" className="rounded-lg border border-line bg-surface p-5">
        <div className="mb-4 flex items-center gap-2">
          <IconCalendar size={18} className="text-ink-2" />
          <h2 id="new-exam" className="text-base font-semibold">
            Ajouter un contrôle ou un projet final
          </h2>
        </div>
        <form key={formKey} action={formAction} className="flex flex-col gap-4">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Type</legend>
            {(["controle", "projet"] as const).map((k) => (
              <label
                key={k}
                className={`btn h-9 cursor-pointer ${kind === k ? "border-ink bg-ink text-surface" : ""}`}
              >
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                {EXAM_KIND_LABEL[k]}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="label">
              Matière
              <div className="flex items-center gap-2">
                <Spine color={selected?.color ?? null} className="h-6" />
                <select name="subjectId" required value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="input flex-1">
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label className="label">
              {kind === "projet" ? "Date de rendu" : "Date"}
              <input type="date" name="date" required className="input" />
            </label>
            <label className="label">
              Heure de début (facultatif)
              <input type="time" name="startTime" className="input" />
            </label>
            <label className="label">
              Heure de fin (facultatif)
              <input type="time" name="endTime" className="input" />
            </label>
          </div>
          <label className="label">
            Intitulé (facultatif)
            <input
              type="text"
              name="title"
              maxLength={300}
              placeholder={kind === "projet" ? "Ex. : projet final, soutenance…" : "Ex. : DS chapitres 1 à 3"}
              className="input"
            />
          </label>
          <label className="label">
            Lieu (facultatif)
            <input type="text" name="location" maxLength={200} placeholder="Salle, visio…" className="input" />
          </label>
          <label className="label">
            Précisions (facultatif)
            <textarea name="details" rows={3} maxLength={2000} placeholder="Chapitres à réviser, documents autorisés…" className="input min-h-20 py-2" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending} className="btn btn-primary">
              {pending ? "Enregistrement…" : "Enregistrer"}
            </button>
            <p className="text-xs text-ink-3">Visible par toute la classe, ajouté à l&apos;emploi du temps et annoncé sur Telegram.</p>
          </div>
          {state?.error && (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          )}
          {state?.message && (
            <p role="status" className="text-sm text-ok">
              {state.message}
            </p>
          )}
        </form>
      </section>

      <section aria-labelledby="upcoming-exams" className="flex flex-col gap-3">
        <h2 id="upcoming-exams" className="text-base font-semibold">
          À venir ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-ink-3">Aucun contrôle ni projet prévu.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((e) => (
              <ExamItem key={e.id} exam={e} onDeleted={router.refresh} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="flex flex-col gap-3">
          <button type="button" onClick={() => setShowPast((v) => !v)} className="self-start text-sm text-ink-2 underline underline-offset-2">
            {showPast ? "Masquer" : "Afficher"} les contrôles passés ({past.length})
          </button>
          {showPast && (
            <ul className="flex flex-col gap-3 opacity-80">
              {past.map((e) => (
                <ExamItem key={e.id} exam={e} onDeleted={router.refresh} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

export default function ControlesPage() {
  const { data, error, reload } = useData(async () => {
    const [subjects, exams] = await Promise.all([listSubjects(), listExams()]);
    return { subjects: subjects.map((s) => ({ id: s.id, name: s.name, color: s.color })), exams };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Contrôles</h1>
        <p className="text-ink-2">
          Contrôles et projets finaux de la classe : ceux de l&apos;emploi du temps Boostcamp sont ajoutés automatiquement, les autres
          par les élèves. Ils apparaissent sur l&apos;
          <Link href="/timetable" className="underline underline-offset-2">
            emploi du temps
          </Link>{" "}
          et déclenchent une alerte Telegram une semaine avant et la veille.
        </p>
      </header>
      {error ? (
        <p role="alert" className="text-danger">{error}</p>
      ) : !data ? (
        <p className="text-sm text-ink-3">Chargement…</p>
      ) : (
        <PageRefreshProvider value={reload}>
          <ExamsClient subjects={data.subjects} exams={data.exams} />
        </PageRefreshProvider>
      )}
    </div>
  );
}
