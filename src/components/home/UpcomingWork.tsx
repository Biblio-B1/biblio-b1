"use client";

// Accueil : devoirs de la semaine (sinon les 3 plus proches) avec la case « Fait », et contrôles à venir.
import Link from "next/link";
import { HomeworkDoneToggle } from "@/components/HomeworkDone";
import { IconExam, IconFlag, IconHomework } from "@/components/layout/Icons";
import type { ExamRow } from "@/lib/api/exams";
import type { HomeworkRow } from "@/lib/api/homeworks";
import { daysBetween, homeworksForHome, relativeDayLabel } from "@/lib/calendar-view";

const MAX_EXAMS = 5;

function HomeworkLine({ hw, today }: { hw: HomeworkRow; today: string }) {
  const kind = hw.isFinalProject ? "Projet final" : "Devoir";
  return (
    <li
      className={`flex items-start gap-3 rounded-lg border bg-surface p-3 ${hw.isFinalProject && !hw.done ? "border-danger/50" : "border-line"}`}
      style={{ boxShadow: `inset 3px 0 0 ${hw.subjectColor}` }}
    >
      <HomeworkDoneToggle id={hw.id} done={hw.done} size="sm" label={`${kind} de ${hw.subjectName}`} />
      <Link href={`/devoirs#devoir-${hw.id}`} className={`min-w-0 flex-1 ${hw.done ? "opacity-70" : ""}`}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {hw.isFinalProject && (
            <span className="inline-flex items-center gap-1 rounded badge-alert px-1.5 py-0.5 text-[10px] font-bold uppercase">
              <IconFlag size={10} />
              Projet final
            </span>
          )}
          <span className="min-w-0 font-semibold break-words text-ink">{hw.subjectName}</span>
          <span className="capitalize text-ink-2">· {relativeDayLabel(hw.dueDate, today)}</span>
          {hw.attachments.length > 0 && (
            <span className="text-ink-3">
              · {hw.attachments.length} pièce{hw.attachments.length > 1 ? "s" : ""} jointe{hw.attachments.length > 1 ? "s" : ""}
            </span>
          )}
        </span>
        <span className={`mt-1 line-clamp-2 block break-words text-[14px] text-ink ${hw.done ? "line-through decoration-ink-3" : ""}`}>{hw.title}</span>
      </Link>
    </li>
  );
}

function ExamLine({ exam, today }: { exam: ExamRow; today: string }) {
  const n = daysBetween(today, exam.date);
  const hour = exam.startTime ? exam.startTime.replace(":", "h") : null;
  return (
    <li>
      <Link
        href="/controles"
        className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3 transition-colors hover:border-line-strong"
        style={{ boxShadow: `inset 3px 0 0 ${exam.subjectColor}` }}
      >
        <span
          className={`grid h-10 w-12 shrink-0 place-items-center rounded-md text-center leading-none ${
            n <= 7 ? "badge-alert" : "border border-line-strong bg-sunken text-ink"
          }`}
        >
          <span>
            <span className="block text-[15px] font-bold tabular-nums">{n === 0 ? "Auj." : `J-${n}`}</span>
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-ink">
            {exam.subjectName}
            {exam.englishGroup && <span className="font-normal text-ink-2"> · {exam.englishGroup}</span>}
          </span>
          <span className="block truncate text-xs capitalize text-ink-2">
            {relativeDayLabel(exam.date, today)}
            {hour ? ` · ${hour}` : ""}
            {exam.title ? ` · ${exam.title}` : ""}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function UpcomingWork({ homeworks, exams, today }: { homeworks: HomeworkRow[]; exams: ExamRow[]; today: string }) {
  const { mode, items } = homeworksForHome(homeworks, today);
  const todo = items.filter((h) => !h.done).length;
  const nextExams = exams.filter((e) => e.date >= today).slice(0, MAX_EXAMS);
  const moreExams = exams.filter((e) => e.date >= today).length - nextExams.length;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section aria-labelledby="home-homeworks" className="flex min-w-0 flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="home-homeworks" className="flex items-center gap-2 text-[15px] font-semibold">
            <IconHomework size={17} className="text-ink-2" />
            {mode === "week" ? "Devoirs de la semaine" : "Prochains devoirs"}
            {items.length > 0 && <span className="text-xs font-normal text-ink-3">{todo ? `${todo} à faire` : "tout est fait"}</span>}
          </h2>
          <Link href="/devoirs" className="text-[14px] text-ink-2 hover:text-ink">
            Tous les devoirs
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong p-4 text-[14px] text-ink-2">
            Aucun devoir à venir.{" "}
            <Link href="/devoirs" data-write className="text-ink underline underline-offset-2">
              Ajouter un devoir
            </Link>
          </p>
        ) : (
          <>
            {mode === "next" && <p className="-mt-1 text-xs text-ink-3">Rien à rendre ces 7 prochains jours : voici les plus proches.</p>}
            <ul className="flex flex-col gap-2">
              {items.map((hw) => (
                <HomeworkLine key={hw.id} hw={hw} today={today} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="home-exams" className="flex min-w-0 flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="home-exams" className="flex items-center gap-2 text-[15px] font-semibold">
            <IconExam size={17} className="text-ink-2" />
            Contrôles à venir
          </h2>
          <Link href="/controles" className="text-[14px] text-ink-2 hover:text-ink">
            {moreExams > 0 ? `Voir les ${nextExams.length + moreExams}` : "Tous les contrôles"}
          </Link>
        </div>
        {nextExams.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong p-4 text-[14px] text-ink-2">Aucun contrôle prévu.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {nextExams.map((e) => (
              <ExamLine key={e.id} exam={e} today={today} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
