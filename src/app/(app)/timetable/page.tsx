"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionForm, type FormState } from "@/components/ActionForm";
import { CalendarView } from "@/components/calendar/CalendarView";
import { PageRefreshProvider } from "@/components/PageRefresh";
import { callCalendar, getMyCalendar, type StoredCalendar } from "@/lib/api/calendar";
import { useAuth } from "@/components/auth/AuthProvider";
import { examEvents, listExams } from "@/lib/api/exams";
import { visibleForMe } from "@/lib/english-groups";
import { listHomeworks } from "@/lib/api/homeworks";
import { listSubjects } from "@/lib/api/library";
import { useData } from "@/lib/api/use-data";

/** Au-delà, la page relit le flux Boostcamp à l'ouverture (comme l'ancien serveur : cache de 50 s). */
const RESYNC_AFTER_MS = 50_000;

export default function TimetablePage() {
  const { profile } = useAuth();
  const { data, error } = useData(async () => {
    const [subjects, homeworks, calendar, exams] = await Promise.all([listSubjects(), listHomeworks(), getMyCalendar(), listExams()]);
    return {
      subjects: subjects.map((s) => ({ id: s.id, name: s.name, slug: s.slug, color: s.color, rules: s.rules })),
      homeworks,
      calendar,
      exams,
    };
  }, []);
  const [calendar, setCalendar] = useState<StoredCalendar | null | undefined>(undefined);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);

  useEffect(() => {
    if (!data) return;
    setCalendar(data.calendar);
    if (!data.calendar || Date.now() - data.calendar.syncedAt.getTime() < RESYNC_AFTER_MS) return;
    void callCalendar({ action: "sync" }).then((r) => {
      if (r.ok) setCalendar(r.calendar);
      else {
        setSyncError(r.error);
        setReauthRequired(r.reauth);
      }
    });
  }, [data]);

  async function sync(): Promise<FormState> {
    const r = await callCalendar({ action: "sync" });
    if (!r.ok) {
      setReauthRequired(r.reauth);
      return { error: r.error };
    }
    setCalendar(r.calendar);
    setSyncError(null);
    return { message: "Emploi du temps à jour." };
  }

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!data || calendar === undefined) return <p className="text-sm text-ink-3">Chargement…</p>;
  // Devoirs et contrôles d'anglais : seulement ceux de son groupe.
  const myEvents = calendar?.events ?? data.calendar?.events;
  const myExamEvents = examEvents(visibleForMe(data.exams, myEvents, profile?.id));
  const myHomeworks = visibleForMe(data.homeworks, myEvents, profile?.id);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Emploi du temps</h1>
        <p className="text-ink-2">Vos événements Boostcamp et Outlook, synchronisés à votre compte.</p>
      </header>

      {myExamEvents.length > 0 && (
        <p className="text-sm text-ink-2">
          Les contrôles et projets ajoutés par la classe sont marqués <span className="rounded badge-alert px-1 text-[10px] font-bold uppercase">Éval</span>{" "}
          sur l&apos;emploi du temps.{" "}
          <Link href="/controles" className="underline underline-offset-2">
            Voir les contrôles
          </Link>
        </p>
      )}
      {!calendar ? (
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-base font-semibold">Aucun calendrier lié</h2>
          <p className="text-sm text-ink-2">
            Liez votre emploi du temps Boostcamp (iCal) et, si vous voulez, votre calendrier Outlook : leurs événements
            s&apos;afficheront ici ensemble.
          </p>
          <Link href="/settings" className="btn btn-primary self-start">
            Lier un calendrier dans les paramètres
          </Link>
        </section>
      ) : null}
      {!calendar && myExamEvents.length > 0 && (
        <CalendarView events={myExamEvents} subjects={data.subjects} homeworks={myHomeworks} />
      )}
      {calendar && (
        <>
          {syncError && (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
              {reauthRequired ? "Un lien de calendrier a expiré. " : "Synchronisation impossible : "}
              {syncError} Les événements affichés sont ceux de la dernière synchronisation.{" "}
              <Link href="/settings" className="underline underline-offset-2">
                Gérer les calendriers
              </Link>
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-2">
              Dernière synchronisation : {calendar.syncedAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={sync} submitLabel="Synchroniser maintenant">
                <span className="sr-only">Actualiser les événements depuis le flux Boostcamp.</span>
              </ActionForm>
              <Link href="/settings" className="btn h-10">
                Gérer les calendriers
              </Link>
            </div>
          </div>
          <PageRefreshProvider value={() => void sync()}>
            <CalendarView events={[...calendar.events, ...myExamEvents]} subjects={data.subjects} homeworks={myHomeworks} />
          </PageRefreshProvider>
        </>
      )}
    </div>
  );
}
