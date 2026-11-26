"use client";

import { useAuth } from "@/components/auth/AuthProvider";
import { PageRefreshProvider } from "@/components/PageRefresh";
import { getMyCalendar } from "@/lib/api/calendar";
import { listExams } from "@/lib/api/exams";
import { listHomeworks } from "@/lib/api/homeworks";
import { listSubjects } from "@/lib/api/library";
import { useData } from "@/lib/api/use-data";
import { visibleForMe } from "@/lib/english-groups";
import { HomeworkClient } from "./HomeworkClient";

export default function DevoirsPage() {
  const { profile } = useAuth();
  const { data, error, reload } = useData(async () => {
    // Le calendrier est facultatif : sans lui, la page fonctionne (choix de la date seulement).
    const [subjects, homeworks, calendar, exams] = await Promise.all([
      listSubjects(),
      listHomeworks(),
      getMyCalendar().catch(() => null),
      listExams().catch(() => []),
    ]);
    return {
      subjects: subjects.map((s) => ({ id: s.id, name: s.name, slug: s.slug, color: s.color })),
      calendarSubjects: subjects.map((s) => ({ id: s.id, name: s.name, slug: s.slug, color: s.color, rules: s.rules })),
      homeworks,
      exams,
      courses: calendar ? calendar.events : null,
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Devoirs</h1>
        <p className="text-ink-2">
          Espace collaboratif : ajoutez et consultez les devoirs à rendre, visibles et mis à jour pour toute la classe.
        </p>
      </header>
      {error ? (
        <p role="alert" className="text-danger">{error}</p>
      ) : !data ? (
        <p className="text-sm text-ink-3">Chargement…</p>
      ) : (
        <PageRefreshProvider value={reload}>
          <HomeworkClient
            subjects={data.subjects}
            // Devoirs et contrôles d'anglais : seulement ceux de son groupe.
            homeworks={visibleForMe(data.homeworks, data.courses, profile?.id)}
            courses={data.courses}
            calendarSubjects={data.calendarSubjects}
            exams={visibleForMe(data.exams, data.courses, profile?.id)}
          />
        </PageRefreshProvider>
      )}
    </div>
  );
}
