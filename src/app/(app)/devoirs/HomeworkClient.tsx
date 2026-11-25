"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePageRefresh } from "@/components/PageRefresh";
import type { FormState } from "@/components/ActionForm";
import { AttachmentField, AttachmentList } from "@/components/AttachmentList";
import { DuplicateWarning, useDuplicateGuard } from "@/components/DuplicateWarning";
import type { ExamRow } from "@/lib/api/exams";
import { examItems, homeworkItems, type DueItem } from "@/lib/duplicates";
import { HOMEWORK_DONE_EVENT, HomeworkDoneToggle } from "@/components/HomeworkDone";
import { Spine } from "@/components/layout/Spine";
import { IconCalendar, IconHomework } from "@/components/layout/Icons";
import { labelDate, todayKeyInParis } from "@/lib/calendar-view";
import { HOMEWORK_FILES } from "@/lib/api/attachments";
import { createHomeworkAction, deleteHomeworkAction, type HomeworkRow } from "@/lib/api/homeworks";
import type { CalendarSubject, ScheduleEvent } from "@/lib/calendar-view";
import { CoursePicker } from "./CoursePicker";

type SubjectOpt = { id: string; name: string; slug: string; color: string };

function isEnglish(subject?: SubjectOpt): boolean {
  if (!subject) return false;
  const n = subject.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const s = subject.slug.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return n.includes("anglais") || n.includes("english") || s.includes("anglais") || s.includes("english");
}

function formatDueDate(dueDate: string): string {
  return labelDate(dueDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function HomeworkItem({ hw, highlighted, onChanged }: { hw: HomeworkRow; highlighted: boolean; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();
  const [delError, setDelError] = useState<string | null>(null);
  const kind = hw.isFinalProject ? "Projet final" : "Devoir";

  return (
    <li
      id={`devoir-${hw.id}`}
      className={`flex scroll-mt-24 flex-col gap-2.5 rounded-lg border bg-surface p-4 transition-opacity ${
        highlighted ? "border-focus ring-2 ring-focus/40" : "border-line"
      } ${hw.done ? "opacity-70" : ""}`}
      style={{ boxShadow: `inset 4px 0 0 ${hw.subjectColor}` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 pl-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <HomeworkDoneToggle id={hw.id} done={hw.done} label={`${kind} de ${hw.subjectName} pour le ${formatDueDate(hw.dueDate)}`} />
          {hw.isFinalProject && (
            <span className="rounded badge-alert px-1.5 py-0.5 text-[11px] font-bold uppercase">Projet final</span>
          )}
          <span className="text-sm font-semibold text-ink">{hw.subjectName}</span>
          {hw.englishGroup && (
            <span className="rounded-full border border-focus/30 bg-focus/10 px-2.5 py-0.5 text-xs font-medium text-ink">
              Groupe : {hw.englishGroup}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <time dateTime={hw.dueDate} className="text-xs font-medium capitalize text-ink-2">
            Pour le {formatDueDate(hw.dueDate)}
          </time>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Supprimer ce ${kind.toLowerCase()} pour toute la classe ?`)) return;
              setDelError(null);
              startTransition(async () => {
                const res = await deleteHomeworkAction(hw.id);
                if (res.error) setDelError(res.error);
                else onChanged();
              });
            }}
            className="btn btn-ghost h-7 px-2 text-xs text-danger"
          >
            {pending ? "…" : "Supprimer"}
          </button>
        </div>
      </div>

      <p className={`pl-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink ${hw.done ? "line-through decoration-ink-3" : ""}`}>
        {hw.title}
      </p>

      <div className="flex flex-wrap items-end justify-between gap-2 pl-1.5 text-xs text-ink-3">
        <AttachmentList
          target={HOMEWORK_FILES}
          parentId={hw.id}
          attachments={hw.attachments}
          addLabel={`Ajouter des pièces jointes au ${kind.toLowerCase()} de ${hw.subjectName}`}
          onChanged={onChanged}
        />
        <span>Ajouté par {hw.authorName ?? "un élève"}</span>
      </div>
      {delError && (
        <p role="alert" className="pl-1.5 text-xs text-danger">
          {delError}
        </p>
      )}
    </li>
  );
}

export function HomeworkClient({
  subjects,
  homeworks,
  courses = null,
  calendarSubjects = [],
  exams = [],
}: {
  subjects: SubjectOpt[];
  homeworks: HomeworkRow[];
  /** Contrôles, pour repérer un doublon possible (même matière, même jour). */
  exams?: ExamRow[];
  /** Cours de l'emploi du temps de l'élève (null : aucun calendrier lié). */
  courses?: ScheduleEvent[] | null;
  /** Matières avec leurs règles, pour reconnaître la matière d'un cours. */
  calendarSubjects?: CalendarSubject[];
}) {
  const router = usePageRefresh();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [title, setTitle] = useState("");
  const [englishGroup, setEnglishGroup] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [hideDone, setHideDone] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [dupes, setDupes] = useState<DueItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const existing = useMemo(() => [...homeworkItems(homeworks), ...examItems(exams)], [homeworks, exams]);
  const guard = useDuplicateGuard(existing);

  const selectedSubject = subjects.find((s) => s.id === subjectId);
  const englishSelected = isEnglish(selectedSubject);

  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await createHomeworkAction(prev, fd);
    if (!res?.error) {
      setTitle("");
      setEnglishGroup("");
      setFileError(null);
      setFormKey((k) => k + 1); // vide le champ des pièces jointes
      router.refresh();
    }
    return res;
  }, null);

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 30_000);
    // « Fait » coché ailleurs sur la page : on relit la liste (tri, filtre).
    const onDone = () => router.refresh();
    window.addEventListener(HOMEWORK_DONE_EVENT, onDone);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(HOMEWORK_DONE_EVENT, onDone);
    };
  }, [router]);

  // Lien depuis l'accueil ou l'emploi du temps (#devoir-<id>) : on montre le devoir visé.
  useEffect(() => {
    const id = window.location.hash.match(/^#devoir-(.+)$/)?.[1];
    if (!id) return;
    setHighlight(id);
    window.setTimeout(() => document.getElementById(`devoir-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    const t = window.setTimeout(() => setHighlight(null), 4000);
    return () => window.clearTimeout(t);
  }, []);

  const today = todayKeyInParis();
  const upcomingAll = homeworks.filter((h) => h.dueDate >= today);
  const doneCount = upcomingAll.filter((h) => h.done).length;
  const upcoming = hideDone ? upcomingAll.filter((h) => !h.done) : upcomingAll;
  const past = homeworks.filter((h) => h.dueDate < today);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="new-homework" className="rounded-lg border border-line bg-surface p-5">
        <div className="mb-4 flex items-center gap-2">
          <IconHomework size={18} className="text-ink-2" />
          <h2 id="new-homework" className="text-base font-semibold">
            Ajouter un devoir
          </h2>
        </div>

        <form
          ref={formRef}
          action={formAction}
          onSubmit={(e) => {
            // Même matière, même jour : on demande confirmation avant de publier (doublon possible).
            if (guard.check({ subjectId, subjectName: selectedSubject?.name ?? "", date: dueDate, group: englishSelected ? englishGroup : null }, setDupes))
              e.preventDefault();
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="label">
              Matière
              <div className="flex items-center gap-2">
                <Spine color={selectedSubject?.color ?? null} className="h-6" />
                <select
                  name="subjectId"
                  required
                  value={subjectId}
                  onChange={(e) => {
                    setSubjectId(e.target.value);
                    setEnglishGroup("");
                    setDupes([]);
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
              <label htmlFor="hw-due-date">Date de rendu</label>
              <div className="relative">
                {/* L'icône calendrier ouvre l'emploi du temps (et non le calendrier du navigateur). */}
                <input
                  id="hw-due-date"
                  type="date"
                  name="dueDate"
                  required
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    setDupes([]);
                  }}
                  className="input w-full pr-11 [&::-webkit-calendar-picker-indicator]:hidden"
                />
                <button
                  type="button"
                  onClick={() => setPickerOpen((o) => !o)}
                  aria-expanded={pickerOpen}
                  aria-controls="course-picker-panel"
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
          </div>

          {pickerOpen && (
            <div id="course-picker-panel">
              <CoursePicker
                events={courses}
                subjects={calendarSubjects}
                subjectId={subjectId}
                dueDate={dueDate}
                onClose={() => setPickerOpen(false)}
                onPick={(dayKey, pickedSubject) => {
                  setDueDate(dayKey);
                  setDupes([]);
                  if (pickedSubject && pickedSubject !== subjectId) {
                    setSubjectId(pickedSubject);
                    setEnglishGroup("");
                  }
                  setPickerOpen(false);
                }}
              />
            </div>
          )}

          <label className="flex items-start gap-2.5 rounded-lg border border-line bg-sunken p-3 text-sm text-ink">
            <input type="checkbox" name="finalProject" className="mt-0.5 h-4 w-4 accent-[var(--danger)]" />
            <span>
              <span className="font-medium">Projet final</span>
              <span className="block text-xs text-ink-2">
                Annoncé sur Telegram comme un projet final et rappelé comme un contrôle : 3, 2 et 1 semaine(s) avant, puis la veille.
              </span>
            </span>
          </label>

          {englishSelected && (
            <div className="flex flex-col gap-3 rounded-lg border border-focus/40 bg-focus/10 p-3.5">
              <p role="status" className="text-sm font-medium text-ink">
                Attention : il y a plusieurs groupes en anglais. Merci de préciser ci-dessous quel groupe est concerné par ce devoir.
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
            Devoir à faire / Consignes
            <textarea
              name="title"
              required
              rows={3}
              maxLength={2000}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex : Terminer les exercices 1 à 3 du TD sur les requêtes SQL…"
              className="input h-auto resize-y py-2"
            />
          </label>

          <AttachmentField key={formKey} hint="facultatif : sujet, consignes, fichiers…" onError={setFileError} />

          <DuplicateWarning
            matches={dupes}
            what="ce devoir"
            onConfirm={() => {
              setDupes([]);
              guard.confirm(formRef.current);
            }}
            onCancel={() => setDupes([])}
          />

          {state?.error && (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg p-2.5 text-sm text-danger">
              {state.error}
            </p>
          )}
          {state?.message && (
            <p role="status" className="text-sm text-ok">
              {state.message}
            </p>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={pending || subjects.length === 0 || Boolean(fileError)} className="btn btn-primary h-10 px-5">
              {pending ? "Enregistrement…" : "Publier le devoir"}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="upcoming-homeworks" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="upcoming-homeworks" className="text-[15px] font-semibold">
            Devoirs à venir ({upcomingAll.length - doneCount} à faire{doneCount ? `, ${doneCount} fait${doneCount > 1 ? "s" : ""}` : ""})
          </h2>
          <div className="flex items-center gap-3 text-xs text-ink-3">
            {doneCount > 0 && (
              <label className="flex cursor-pointer items-center gap-1.5 text-ink-2">
                <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="h-3.5 w-3.5" />
                Masquer les devoirs faits
              </label>
            )}
            <span>Synchronisé pour toute la classe · maj auto 30 s</span>
          </div>
        </div>
        {upcoming.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-2">
            {hideDone && doneCount > 0
              ? "Tous les devoirs à venir sont faits."
              : "Aucun devoir à venir pour le moment. Utilisez le formulaire ci-dessus pour en ajouter un."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {upcoming.map((hw) => (
              <HomeworkItem key={hw.id} hw={hw} highlighted={highlight === hw.id} onChanged={() => router.refresh()} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past-homeworks" className="flex flex-col gap-3">
          <h2 id="past-homeworks" className="text-[15px] font-semibold text-ink-2">
            Devoirs passés ({past.length})
          </h2>
          <ul className="flex flex-col gap-2.5 opacity-80">
            {past.map((hw) => (
              <HomeworkItem key={hw.id} hw={hw} highlighted={highlight === hw.id} onChanged={() => router.refresh()} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
