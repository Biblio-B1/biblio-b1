"use client";

import { DashboardSkeleton } from "@/components/Skeleton";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { CalendarView } from "@/components/calendar/CalendarView";
import { DocumentList } from "@/components/library/DocumentList";
import { UpcomingWork } from "@/components/home/UpcomingWork";
import { IconCamera, IconPen, IconUpload } from "@/components/layout/Icons";
import { getMyCalendar } from "@/lib/api/calendar";
import { examEvents, listExams } from "@/lib/api/exams";
import { visibleForMe } from "@/lib/english-groups";
import { listHomeworks } from "@/lib/api/homeworks";
import { listDocuments, listSubjects } from "@/lib/api/library";
import { useData } from "@/lib/api/use-data";
import { todayKeyInParis } from "@/lib/calendar-view";

export default function Dashboard() {
  const { profile } = useAuth();
  const { data, error } = useData(async () => {
    const [subjects, docs, homeworks, calendar, exams] = await Promise.all([
      listSubjects(),
      listDocuments({ limit: 9 }),
      listHomeworks(),
      getMyCalendar(),
      listExams(),
    ]);
    return { subjects, docs, homeworks, calendar, exams };
  }, []);
  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!data) return <DashboardSkeleton />;
  const { subjects, docs, calendar } = data;
  // Devoirs et contrôles d'anglais : seulement ceux de son groupe.
  const homeworks = visibleForMe(data.homeworks, calendar?.events, profile?.id);
  const exams = visibleForMe(data.exams, calendar?.events, profile?.id);
  const calendarSubjects = subjects.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    color: s.color,
    rules: s.rules,
  }));

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h1 className="page-title">Bonjour {profile?.name}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/upload" className="btn btn-primary">
            <IconUpload size={16} /> Déposer des fichiers
          </Link>
          <Link href="/upload#photo" className="btn sm:hidden">
            <IconCamera size={16} /> Prendre une photo
          </Link>
          <Link href="/notes/new" className="btn">
            <IconPen size={16} /> Écrire une fiche
          </Link>
        </div>
      </section>

      <UpcomingWork homeworks={homeworks} exams={exams} today={todayKeyInParis()} />

      <section aria-labelledby="timetable-preview" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="timetable-preview" className="min-w-0 text-[15px] font-semibold">
            Aperçu de l&apos;emploi du temps
          </h2>
          <Link href="/timetable" className="shrink-0 text-[14px] text-ink-2 hover:text-ink">
            Ouvrir
          </Link>
        </div>
        {calendar ? (
          <CalendarView events={[...calendar.events, ...examEvents(exams)]} subjects={calendarSubjects} homeworks={homeworks} />
        ) : (
          <div className="rounded-lg border border-dashed border-line-strong p-5 text-[14px] text-ink-2">
            Aucun emploi du temps lié pour l&apos;instant.{" "}
            <Link href="/timetable" className="text-ink underline underline-offset-2">
              Lier votre calendrier Boostcamp
            </Link>
            .
          </div>
        )}
      </section>

      <section aria-labelledby="recent" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="recent" className="text-[15px] font-semibold">Ajoutés récemment</h2>
          {docs.length > 8 && (
            <Link href="/library" className="text-[14px] text-ink-2 hover:text-ink">
              Toute la bibliothèque
            </Link>
          )}
        </div>
        <DocumentList
          docs={docs.slice(0, 8)}
          subjects={subjects}
          empty={
            <>
              La bibliothèque est vide.{" "}
              <Link href="/upload" className="text-ink underline underline-offset-2">
                Déposez un premier cours
              </Link>
              .
            </>
          }
        />
      </section>
    </div>
  );
}
