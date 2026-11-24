"use client";

// Choix du cours où rendre un devoir, sur l'emploi du temps de l'élève (grille de la semaine).
// S'ouvre depuis l'icône calendrier du champ « Date de rendu ». Un clic sur un cours règle la date
// et la matière ; un clic sur l'en-tête d'un jour règle seulement la date.
import Link from "next/link";
import { useMemo, useState } from "react";
import { IconCalendar, IconChevron, IconClose } from "@/components/layout/Icons";
import {
  labelDate,
  matchEventSubject,
  mondayOfWeek,
  shiftDateKey,
  timeLabel,
  timedEventsForDay,
  todayKeyInParis,
  visibleHourRange,
  weekDateKeys,
  type CalendarSubject,
  type ScheduleEvent,
} from "@/lib/calendar-view";

const PX_PER_MIN = 0.8;

function courseLabel(event: ScheduleEvent, subject?: CalendarSubject): string {
  return subject?.name ?? (event.title.split(" - ")[0] || event.title);
}

export function CoursePicker({
  events,
  subjects,
  subjectId,
  dueDate,
  onPick,
  onClose,
}: {
  /** null : aucun calendrier lié. */
  events: ScheduleEvent[] | null;
  subjects: CalendarSubject[];
  subjectId: string;
  dueDate: string;
  onPick: (dayKey: string, subjectId?: string) => void;
  onClose: () => void;
}) {
  const today = todayKeyInParis();
  const [weekStart, setWeekStart] = useState(() => mondayOfWeek(dueDate && dueDate >= today ? dueDate : today));
  const [onlySubject, setOnlySubject] = useState(true);
  const subject = subjects.find((s) => s.id === subjectId);

  // Cours utiles : sans annulés, journées entières ni contrôles ajoutés sur le site.
  const courses = useMemo(
    () =>
      (events ?? []).filter((e) => {
        if (e.allDay || e.status === "cancelled" || e.uid.startsWith("exam:")) return false;
        return !onlySubject || !subject || matchEventSubject(e, subjects)?.id === subject.id;
      }),
    [events, onlySubject, subject, subjects],
  );

  const allDays = useMemo(() => weekDateKeys(weekStart), [weekStart]);
  // Week-end seulement s'il y a cours.
  const days = allDays.filter((d, i) => i < 5 || timedEventsForDay(courses, d).length > 0);
  const hours = visibleHourRange(courses, days);
  const height = (hours.end - hours.start) * 60 * PX_PER_MIN;
  const weekHasCourses = days.some((d) => timedEventsForDay(courses, d).length > 0);

  return (
    <section aria-labelledby="course-picker" className="flex flex-col gap-3 rounded-lg border border-line-strong bg-sunken p-3 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="course-picker" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <IconCalendar size={16} />
          Choisir le cours sur l&apos;emploi du temps
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={weekStart <= mondayOfWeek(today)}
            onClick={() => setWeekStart((w) => shiftDateKey(w, -7))}
            aria-label="Semaine précédente"
            className="btn h-7 w-7 px-0"
          >
            <IconChevron dir="left" size={14} />
          </button>
          <span className="min-w-[8.5rem] text-center text-xs text-ink-2">
            {labelDate(weekStart, { day: "numeric", month: "short" })} – {labelDate(shiftDateKey(weekStart, 6), { day: "numeric", month: "short" })}
          </span>
          <button type="button" onClick={() => setWeekStart((w) => shiftDateKey(w, 7))} aria-label="Semaine suivante" className="btn h-7 w-7 px-0">
            <IconChevron dir="right" size={14} />
          </button>
          <button type="button" onClick={onClose} aria-label="Fermer l'emploi du temps" className="btn btn-ghost ml-1 h-7 w-7 px-0">
            <IconClose size={14} />
          </button>
        </div>
      </div>

      {!events ? (
        <p className="text-sm text-ink-2">
          Aucun emploi du temps lié. Liez-le dans les{" "}
          <Link href="/settings" className="text-ink underline underline-offset-2">
            paramètres
          </Link>{" "}
          pour choisir directement le cours, ou tapez la date dans le champ.
        </p>
      ) : (
        <>
          {subject && (
            <div role="group" aria-label="Cours affichés" className="flex flex-wrap gap-1.5 text-xs">
              {[true, false].map((only) => (
                <button
                  key={String(only)}
                  type="button"
                  aria-pressed={onlySubject === only}
                  onClick={() => setOnlySubject(only)}
                  className={`rounded-full border px-2.5 py-1 ${onlySubject === only ? "border-ink bg-ink text-surface" : "border-line-strong text-ink-2 hover:text-ink"}`}
                >
                  {only ? `Seulement ${subject.name}` : "Tous les cours"}
                </button>
              ))}
            </div>
          )}

          <div className="overflow-x-auto">
            <div className="grid" style={{ gridTemplateColumns: `2.75rem repeat(${days.length}, minmax(0, 1fr))`, minWidth: `${2.75 + days.length * 4.5}rem` }}>
              <div />
              {days.map((d) => {
                const past = d < today;
                const picked = d === dueDate;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={past}
                    onClick={() => onPick(d)}
                    title="Choisir ce jour sans cours précis"
                    className={`mx-0.5 mb-1 rounded-md px-1 py-1 text-center text-xs disabled:opacity-40 ${
                      picked ? "bg-ink text-surface" : d === today ? "bg-surface font-semibold text-ink" : "text-ink-2 hover:bg-surface"
                    }`}
                  >
                    <span className="block capitalize">{labelDate(d, { weekday: "short" }).replace(".", "")}</span>
                    <span className="block font-semibold tabular-nums">{Number(d.slice(-2))}</span>
                  </button>
                );
              })}

              {/* Heures */}
              <div className="relative" style={{ height }}>
                {Array.from({ length: hours.end - hours.start }, (_, i) => (
                  <span key={i} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-ink-3 tabular-nums" style={{ top: i * 60 * PX_PER_MIN }}>
                    {timeLabel((hours.start + i) * 60)}
                  </span>
                ))}
              </div>

              {days.map((d) => {
                const past = d < today;
                return (
                  <div key={d} className="relative mx-0.5 rounded-md bg-surface/40" style={{ height }}>
                    {Array.from({ length: hours.end - hours.start }, (_, i) => (
                      <span key={i} aria-hidden className="absolute inset-x-0 border-t border-line/60" style={{ top: i * 60 * PX_PER_MIN }} />
                    ))}
                    {timedEventsForDay(courses, d).map((seg) => {
                      const s = matchEventSubject(seg.event, subjects);
                      const selected = dueDate === d && (!s || s.id === subjectId);
                      const top = (seg.startMinutes - hours.start * 60) * PX_PER_MIN;
                      const h = Math.max(26, (seg.endMinutes - seg.startMinutes) * PX_PER_MIN);
                      return (
                        <button
                          key={`${seg.event.uid}-${seg.event.start}`}
                          type="button"
                          disabled={past}
                          aria-pressed={selected}
                          onClick={() => onPick(d, s?.id)}
                          title={`${timeLabel(seg.startMinutes)}–${timeLabel(seg.endMinutes)} · ${seg.event.title}${seg.event.location ? ` · ${seg.event.location}` : ""}`}
                          className={`absolute overflow-hidden rounded border-l-[3px] px-1 py-0.5 text-left text-[10.5px] leading-tight text-ink transition-shadow hover:ring-2 hover:ring-focus/50 disabled:cursor-not-allowed disabled:opacity-40 ${
                            selected ? "ring-2 ring-focus" : ""
                          }`}
                          style={{
                            top,
                            height: h,
                            left: `calc(${(seg.lane * 100) / seg.laneCount}% + 1px)`,
                            width: `calc(${100 / seg.laneCount}% - 2px)`,
                            borderLeftColor: s?.color ?? "var(--line-strong)",
                            backgroundColor: `color-mix(in srgb, ${s?.color ?? "#888"} 22%, var(--surface))`,
                          }}
                        >
                          <span className="block truncate font-semibold">{courseLabel(seg.event, s)}</span>
                          <span className="block truncate text-ink-2 tabular-nums">
                            {timeLabel(seg.startMinutes)}
                            {seg.event.location ? ` · ${seg.event.location}` : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {!weekHasCourses && (
            <p className="text-sm text-ink-2">
              {onlySubject && subject ? `Aucun cours de ${subject.name} cette semaine.` : "Aucun cours cette semaine."}{" "}
              {onlySubject && subject && (
                <button type="button" onClick={() => setOnlySubject(false)} className="text-ink underline underline-offset-2">
                  Voir tous les cours
                </button>
              )}
            </p>
          )}
          <p className="text-xs text-ink-3">Cliquez sur un cours pour le choisir, ou sur un jour pour ne choisir que la date.</p>
        </>
      )}
    </section>
  );
}
