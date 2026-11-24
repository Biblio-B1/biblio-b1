"use client";

// Choix du cours où rendre un devoir : les cours des deux prochaines semaines (emploi du temps de
// l'élève), groupés par jour. Un clic règle la matière et la date de rendu du formulaire.
import Link from "next/link";
import { useMemo, useState } from "react";
import { IconCalendar, IconChevron } from "@/components/layout/Icons";
import {
  labelDate,
  shiftDateKey,
  todayKeyInParis,
  upcomingCourses,
  type CalendarSubject,
  type ScheduleEvent,
} from "@/lib/calendar-view";

const SPAN_DAYS = 14;

function courseLabel(event: ScheduleEvent, subject?: CalendarSubject): string {
  if (subject) return subject.name;
  return event.title.split(" - ")[0] || event.title;
}

export function CoursePicker({
  events,
  subjects,
  subjectId,
  dueDate,
  onPick,
}: {
  /** null : aucun calendrier lié. */
  events: ScheduleEvent[] | null;
  subjects: CalendarSubject[];
  subjectId: string;
  dueDate: string;
  onPick: (dayKey: string, subjectId?: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [onlySubject, setOnlySubject] = useState(true);
  const today = todayKeyInParis();
  const from = shiftDateKey(today, offset * SPAN_DAYS);
  const subject = subjects.find((s) => s.id === subjectId);

  const days = useMemo(
    () => (events ? upcomingCourses(events, subjects, from, SPAN_DAYS, onlySubject ? subjectId : undefined) : []),
    [events, subjects, from, onlySubject, subjectId],
  );

  if (!events) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong p-3 text-sm text-ink-2">
        <IconCalendar size={16} className="shrink-0" />
        <span>
          Liez votre emploi du temps dans les{" "}
          <Link href="/settings" className="text-ink underline underline-offset-2">
            paramètres
          </Link>{" "}
          pour choisir directement le cours où rendre le devoir.
        </span>
      </p>
    );
  }

  const rangeLabel = `${labelDate(from, { day: "numeric", month: "short" })} – ${labelDate(shiftDateKey(from, SPAN_DAYS - 1), { day: "numeric", month: "short" })}`;

  return (
    <section aria-labelledby="course-picker" className="flex flex-col gap-3 rounded-lg border border-line bg-sunken p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="course-picker" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <IconCalendar size={16} />
          Choisir le cours sur l&apos;emploi du temps
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
            aria-label="Deux semaines précédentes"
            className="btn h-7 w-7 px-0"
          >
            <IconChevron dir="left" size={14} />
          </button>
          <span className="min-w-[7.5rem] text-center text-xs text-ink-2">{rangeLabel}</span>
          <button type="button" onClick={() => setOffset((o) => o + 1)} aria-label="Deux semaines suivantes" className="btn h-7 w-7 px-0">
            <IconChevron dir="right" size={14} />
          </button>
        </div>
      </div>

      {subject && (
        <div role="group" aria-label="Cours affichés" className="flex flex-wrap gap-1.5 text-xs">
          <button
            type="button"
            aria-pressed={onlySubject}
            onClick={() => setOnlySubject(true)}
            className={`rounded-full border px-2.5 py-1 ${onlySubject ? "border-ink bg-ink text-surface" : "border-line-strong text-ink-2"}`}
          >
            Cours de {subject.name}
          </button>
          <button
            type="button"
            aria-pressed={!onlySubject}
            onClick={() => setOnlySubject(false)}
            className={`rounded-full border px-2.5 py-1 ${!onlySubject ? "border-ink bg-ink text-surface" : "border-line-strong text-ink-2"}`}
          >
            Tous les cours
          </button>
        </div>
      )}

      {days.length === 0 ? (
        <p className="text-sm text-ink-2">
          {onlySubject && subject ? `Aucun cours de ${subject.name} sur cette période.` : "Aucun cours sur cette période."}{" "}
          {onlySubject && subject && (
            <button type="button" onClick={() => setOnlySubject(false)} className="text-ink underline underline-offset-2">
              Voir tous les cours
            </button>
          )}
        </p>
      ) : (
        <ol className="flex max-h-72 flex-col gap-2.5 overflow-y-auto pr-1">
          {days.map((d) => (
            <li key={d.dayKey} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium capitalize text-ink-2">
                {d.dayKey === today ? "Aujourd'hui · " : d.dayKey === shiftDateKey(today, 1) ? "Demain · " : ""}
                {labelDate(d.dayKey, { weekday: "long", day: "numeric", month: "long" })}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {d.courses.map((c) => {
                  const selected = dueDate === d.dayKey && (!c.subject || c.subject.id === subjectId);
                  return (
                    <button
                      key={`${c.event.uid}-${c.event.start}`}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onPick(d.dayKey, c.subject?.id)}
                      title={`${c.event.title}${c.event.location ? ` · ${c.event.location}` : ""}`}
                      className={`flex max-w-full items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-left text-xs transition-colors hover:border-line-strong ${
                        selected ? "border-ink ring-2 ring-focus/40" : "border-line"
                      }`}
                      style={{ borderLeft: `4px solid ${c.subject?.color ?? "var(--line-strong)"}` }}
                    >
                      <span className="tabular-nums text-ink-2">{c.time}</span>
                      <span className="truncate font-medium text-ink">{courseLabel(c.event, c.subject)}</span>
                      {c.event.location && <span className="hidden truncate text-ink-3 sm:inline">· {c.event.location}</span>}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
