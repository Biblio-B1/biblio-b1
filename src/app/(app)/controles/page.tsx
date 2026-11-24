"use client";

import Link from "next/link";
import { useActionState, useRef, useState, useTransition } from "react";
import type { FormState } from "@/components/ActionForm";
import { useAuth } from "@/components/auth/AuthProvider";
import { PageRefreshProvider, usePageRefresh } from "@/components/PageRefresh";
import { IconCalendar, IconClose, IconDownload } from "@/components/layout/Icons";
import { Spine } from "@/components/layout/Spine";
import {
  addExamAttachments,
  createExamAction,
  deleteExamAction,
  deleteExamAttachment,
  listExams,
  MAX_EXAM_FILE_MB,
  MAX_EXAM_FILES,
  pickedFiles,
  validateExamFiles,
  type ExamRow,
} from "@/lib/api/exams";
import { signedFileUrl } from "@/lib/api/files";
import { listSubjects } from "@/lib/api/library";
import { useData } from "@/lib/api/use-data";
import { labelDate, todayKeyInParis } from "@/lib/calendar-view";
import { formatSize, UPLOAD_ACCEPT } from "@/lib/labels";

type SubjectOpt = { id: string; name: string; color: string };

const hour = (t: string) => t.replace(":", "h");

function when(e: ExamRow): string {
  const day = labelDate(e.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (!e.startTime) return day;
  return `${day}, ${hour(e.startTime)}${e.endTime ? `–${hour(e.endTime)}` : ""}`;
}

/** Pièces jointes d'un contrôle : téléchargement, ajout (tout membre), retrait (auteur ou admin). */
function Attachments({ exam, onChanged }: { exam: ExamRow; onChanged: () => void }) {
  const { session, profile } = useAuth();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = session?.user.id;
  const full = exam.attachments.length >= MAX_EXAM_FILES;

  const run = (job: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await job();
      if (res.error) setError(res.error);
      else onChanged();
    });
  };

  return (
    <div className="flex flex-col gap-2 pl-1.5">
      {exam.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Pièces jointes">
          {exam.attachments.map((a) => (
            <li key={a.id} className="inline-flex items-center overflow-hidden rounded-md border border-line bg-sunken text-xs">
              <a
                href="#"
                onClick={async (e) => {
                  e.preventDefault();
                  window.location.href = await signedFileUrl(a.path, { download: a.name });
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 font-medium text-ink hover:bg-surface"
              >
                <IconDownload size={14} />
                <span className="max-w-[16rem] truncate">{a.name}</span>
                <span className="text-ink-3">({formatSize(a.size)})</span>
              </a>
              {(profile?.role === "admin" || a.authorId === uid) && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => deleteExamAttachment(a.id))}
                  aria-label={`Retirer ${a.name}`}
                  title="Retirer la pièce jointe"
                  className="border-l border-line px-1.5 py-1 text-ink-3 hover:bg-surface hover:text-danger"
                >
                  <IconClose size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            aria-label={`Ajouter des pièces jointes au contrôle de ${exam.subjectName}`}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) run(() => addExamAttachments(exam.id, files, exam.attachments.length));
            }}
          />
          <button type="button" disabled={pending} onClick={() => inputRef.current?.click()} className="btn btn-ghost h-7 px-2 text-xs">
            {pending ? "Envoi…" : "+ Ajouter des pièces jointes"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function ExamItem({ exam, onDeleted }: { exam: ExamRow; onDeleted: () => void }) {
  const [pending, startTransition] = useTransition();
  const [delError, setDelError] = useState<string | null>(null);
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4" style={{ boxShadow: `inset 4px 0 0 ${exam.subjectColor}` }}>
      <div className="flex flex-wrap items-start justify-between gap-2 pl-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded badge-alert px-1.5 py-0.5 text-[11px] font-bold uppercase">Contrôle</span>
          <span className="text-sm font-semibold text-ink">{exam.subjectName}</span>
          {exam.source === "edt" && (
            <span className="rounded-full border border-line bg-sunken px-2 py-0.5 text-xs text-ink-2">Emploi du temps Boostcamp</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <time dateTime={exam.date} className="text-xs font-medium capitalize text-ink-2">
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
      <Attachments exam={exam} onChanged={onDeleted} />
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
  const [formKey, setFormKey] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const selected = subjects.find((s) => s.id === subjectId);

  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await createExamAction(prev, fd);
    if (!res?.error) {
      setPicked([]);
      setPickError(null);
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
            Ajouter un contrôle
          </h2>
        </div>
        <form key={formKey} action={formAction} className="flex flex-col gap-4">
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
              Date
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
              placeholder="Ex. : DS chapitres 1 à 3"
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
          <label className="label">
            Pièces jointes (facultatif : sujet, consignes, fiches… {MAX_EXAM_FILES} fichiers, {MAX_EXAM_FILE_MB} Mo chacun)
            <input
              type="file"
              name="attachments"
              multiple
              accept={UPLOAD_ACCEPT}
              onChange={(e) => {
                const files = pickedFiles([...(e.target.files ?? [])]);
                setPicked(files.map((f) => `${f.name} (${formatSize(f.size)})`));
                setPickError(validateExamFiles(files));
              }}
              className="input h-auto py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-sunken file:px-2.5 file:py-1 file:text-ink"
            />
          </label>
          {picked.length > 1 && <p className="-mt-2 text-xs text-ink-3">{picked.join(" · ")}</p>}
          {pickError && (
            <p role="alert" className="-mt-2 text-xs text-danger">
              {pickError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending || Boolean(pickError)} className="btn btn-primary">
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
          <p className="text-sm text-ink-3">Aucun contrôle prévu.</p>
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
          Contrôles de la classe : ceux de l&apos;emploi du temps Boostcamp sont ajoutés automatiquement, les autres par les
          élèves. Ils apparaissent sur l&apos;
          <Link href="/timetable" className="underline underline-offset-2">
            emploi du temps
          </Link>
          , sont annoncés sur Telegram dès leur ajout, puis rappelés 3, 2 et 1 semaine(s) avant et la veille au soir. Un projet
          final s&apos;ajoute dans les{" "}
          <Link href="/devoirs" className="underline underline-offset-2">
            devoirs
          </Link>{" "}
          (case « Projet final »).
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
