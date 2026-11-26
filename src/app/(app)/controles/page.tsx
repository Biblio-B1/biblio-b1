"use client";

import { FormSkeleton, ListSkeleton } from "@/components/Skeleton";
import Link from "next/link";
import { useActionState, useMemo, useRef, useState, useTransition } from "react";
import type { FormState } from "@/components/ActionForm";
import { AttachmentField, AttachmentList } from "@/components/AttachmentList";
import { CoursePicker } from "@/components/CoursePicker";
import { DuplicateWarning, useDuplicateGuard } from "@/components/DuplicateWarning";
import { getMyCalendar } from "@/lib/api/calendar";
import type { CalendarSubject, ScheduleEvent } from "@/lib/calendar-view";
import { listHomeworks, type HomeworkRow } from "@/lib/api/homeworks";
import { examItems, homeworkItems, type DueItem } from "@/lib/duplicates";
import { PageRefreshProvider, usePageRefresh } from "@/components/PageRefresh";
import { IconCalendar } from "@/components/layout/Icons";
import { Spine } from "@/components/layout/Spine";
import { EXAM_FILES } from "@/lib/api/attachments";
import { useAuth } from "@/components/auth/AuthProvider";
import { createExamAction, deleteExamAction, listExams, type ExamRow } from "@/lib/api/exams";
import { visibleForMe } from "@/lib/english-groups";
import { listSubjects } from "@/lib/api/library";
import { isEnglishSubject } from "@/lib/homework-rules";
import { useData } from "@/lib/api/use-data";
import { labelDate, todayKeyInParis } from "@/lib/calendar-view";

type SubjectOpt = { id: string; name: string; slug: string; color: string };

const hour = (t: string) => t.replace(":", "h");

function when(e: ExamRow): string {
  const day = labelDate(e.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (!e.startTime) return day;
  return `${day}, ${hour(e.startTime)}${e.endTime ? `–${hour(e.endTime)}` : ""}`;
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
          {exam.englishGroup && (
            <span className="rounded-full border border-focus/30 bg-focus/10 px-2.5 py-0.5 text-xs font-medium text-ink">
              Groupe : {exam.englishGroup}
            </span>
          )}
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
      <div className="pl-1.5">
        <AttachmentList
          target={EXAM_FILES}
          parentId={exam.id}
          attachments={exam.attachments}
          addLabel={`Ajouter des pièces jointes au contrôle de ${exam.subjectName}`}
          onChanged={onDeleted}
        />
      </div>
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

/** « 08:30 » à Paris pour un instant ISO. */
const parisTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

function ExamsClient({
  subjects,
  exams,
  homeworks,
  courses,
  calendarSubjects,
}: {
  subjects: SubjectOpt[];
  exams: ExamRow[];
  homeworks: HomeworkRow[];
  /** Cours de l'emploi du temps de l'élève (null : aucun calendrier lié). */
  courses: ScheduleEvent[] | null;
  calendarSubjects: CalendarSubject[];
}) {
  const router = usePageRefresh();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [formKey, setFormKey] = useState(0);
  const [pickError, setPickError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const selected = subjects.find((s) => s.id === subjectId);
  const englishSelected = selected ? isEnglishSubject(selected) : false;
  const [englishGroup, setEnglishGroup] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dupes, setDupes] = useState<DueItem[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const existing = useMemo(() => [...examItems(exams), ...homeworkItems(homeworks)], [exams, homeworks]);
  const guard = useDuplicateGuard(existing);

  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await createExamAction(prev, fd);
    if (!res?.error) {
      setPickError(null);
      setFormKey((k) => k + 1);
      setEnglishGroup("");
      setDate("");
      setStartTime("");
      setEndTime("");
      setLocation("");
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
        <form
          key={formKey}
          ref={formRef}
          action={formAction}
          onSubmit={(e) => {
            // Même matière, même jour : on demande confirmation avant de publier (doublon possible).
            const date = String(new FormData(e.currentTarget).get("date") ?? "");
            if (guard.check({ subjectId, subjectName: selected?.name ?? "", date, group: englishSelected ? englishGroup : null }, setDupes))
              e.preventDefault();
          }}
          onChange={(e) => {
            const name = (e.target as unknown as HTMLInputElement).name;
            if (name === "date" || name === "subjectId") setDupes([]);
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="label">
              Matière
              <div className="flex items-center gap-2">
                <Spine color={selected?.color ?? null} className="h-6" />
                <select
                  name="subjectId"
                  required
                  value={subjectId}
                  onChange={(e) => {
                    setSubjectId(e.target.value);
                    setEnglishGroup("");
                  }}
                  className="input flex-1"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <div className="label">
              <label htmlFor="exam-date">Date</label>
              <div className="relative">
                {/* L'icône calendrier ouvre l'emploi du temps (et non le calendrier du navigateur). */}
                <input
                  id="exam-date"
                  type="date"
                  name="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input w-full pr-11 [&::-webkit-calendar-picker-indicator]:hidden"
                />
                <button
                  type="button"
                  onClick={() => setPickerOpen((o) => !o)}
                  aria-expanded={pickerOpen}
                  aria-controls="exam-picker-panel"
                  aria-label="Choisir la date sur l'emploi du temps"
                  title="Choisir sur l'emploi du temps"
                  className={`absolute inset-y-1 right-1 grid w-9 place-items-center rounded-md transition-colors ${
                    pickerOpen ? "bg-ink text-surface" : "text-ink-2 hover:bg-sunken hover:text-ink"
                  }`}
                >
                  <IconCalendar size={18} />
                </button>
              </div>
            </div>
            <label className="label">
              Heure de début (facultatif)
              <input type="time" name="startTime" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input" />
            </label>
            <label className="label">
              Heure de fin (facultatif)
              <input type="time" name="endTime" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input" />
            </label>
          </div>
          {pickerOpen && (
            <div id="exam-picker-panel">
              <CoursePicker
                events={courses}
                subjects={calendarSubjects}
                subjectId={subjectId}
                dueDate={date}
                onClose={() => setPickerOpen(false)}
                onPick={(dayKey, pickedSubject, course) => {
                  setDate(dayKey);
                  setDupes([]);
                  if (pickedSubject && pickedSubject !== subjectId) {
                    setSubjectId(pickedSubject);
                    setEnglishGroup("");
                  }
                  // Le contrôle a lieu pendant ce cours : on reprend son horaire et sa salle.
                  if (course) {
                    setStartTime(parisTime(course.start));
                    setEndTime(parisTime(course.end));
                    if (course.location) setLocation(course.location.slice(0, 200));
                  }
                  setPickerOpen(false);
                }}
              />
            </div>
          )}
          {englishSelected && (
            <div className="flex flex-col gap-3 rounded-lg border border-focus/40 bg-focus/10 p-3.5">
              <p role="status" className="text-sm font-medium text-ink">
                Attention : il y a plusieurs groupes en anglais. Précisez ci-dessous quel groupe passe ce contrôle.
              </p>
              <label className="label text-ink">
                Groupe d&apos;anglais concerné *
                <input
                  type="text"
                  name="englishGroup"
                  required
                  maxLength={120}
                  value={englishGroup}
                  onChange={(e) => setEnglishGroup(e.target.value)}
                  placeholder="Ex : Anglais intermédiaire Gr1, Anglais avancé Gr2…"
                  className="input"
                />
              </label>
            </div>
          )}
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
            <input
              type="text"
              name="location"
              maxLength={200}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Salle, visio…"
              className="input"
            />
          </label>
          <label className="label">
            Précisions (facultatif)
            <textarea name="details" rows={3} maxLength={2000} placeholder="Chapitres à réviser, documents autorisés…" className="input min-h-20 py-2" />
          </label>
          <AttachmentField hint="facultatif : sujet, consignes, fiches…" onError={setPickError} />
          <DuplicateWarning
            matches={dupes}
            what="ce contrôle"
            onConfirm={() => {
              setDupes([]);
              guard.confirm(formRef.current);
            }}
            onCancel={() => setDupes([])}
          />
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
  const { profile } = useAuth();
  const { data, error, reload } = useData(async () => {
    const [subjects, exams, homeworks, calendar] = await Promise.all([
      listSubjects(),
      listExams(),
      listHomeworks().catch(() => []),
      // Facultatif : sans calendrier lié, la date se tape à la main.
      getMyCalendar().catch(() => null),
    ]);
    return {
      subjects: subjects.map((s) => ({ id: s.id, name: s.name, slug: s.slug, color: s.color })),
      calendarSubjects: subjects.map((s) => ({ id: s.id, name: s.name, slug: s.slug, color: s.color, rules: s.rules })),
      courses: calendar ? calendar.events : null,
      exams,
      homeworks,
    };
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
        <div className="flex flex-col gap-6"><FormSkeleton /><ListSkeleton /></div>
      ) : (
        <PageRefreshProvider value={reload}>
          <ExamsClient
            subjects={data.subjects}
            exams={visibleForMe(data.exams, data.courses, profile?.id)}
            homeworks={visibleForMe(data.homeworks, data.courses, profile?.id)}
            courses={data.courses}
            calendarSubjects={data.calendarSubjects}
          />
        </PageRefreshProvider>
      )}
    </div>
  );
}
