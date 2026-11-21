"use client";

import { useEffect, useState } from "react";
import { ActionForm, Field, type FormState } from "@/components/ActionForm";
import { CalendarView } from "@/components/calendar/CalendarView";
import { PageRefreshProvider } from "@/components/PageRefresh";
import { callCalendar, getMyCalendar, type StoredCalendar } from "@/lib/api/calendar";
import { listHomeworks } from "@/lib/api/homeworks";
import { listSubjects } from "@/lib/api/library";
import { useData } from "@/lib/api/use-data";

/** Au-delà, la page relit le flux Boostcamp à l'ouverture (comme l'ancien serveur : cache de 50 s). */
const RESYNC_AFTER_MS = 50_000;

export default function TimetablePage() {
  const { data, error } = useData(async () => {
    const [subjects, homeworks, calendar] = await Promise.all([listSubjects(), listHomeworks(), getMyCalendar()]);
    return {
      subjects: subjects.map((s) => ({ id: s.id, name: s.name, slug: s.slug, color: s.color, rules: s.rules })),
      homeworks,
      calendar,
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

  async function link(_prev: FormState, fd: FormData): Promise<FormState> {
    const r = await callCalendar({ action: "link", url: String(fd.get("calendarUrl") ?? "") });
    if (!r.ok) return { error: r.error };
    setCalendar(r.calendar);
    setSyncError(null);
    setReauthRequired(false);
    return null;
  }

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

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Emploi du temps</h1>
        <p className="text-ink-2">Consultez les événements Boostcamp synchronisés à votre compte.</p>
      </header>

      {!calendar ? (
        <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <div className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">Lier votre calendrier</h2>
            <p className="text-sm text-ink-2">
              Collez ici le lien d&apos;abonnement de votre emploi du temps (adresse https qui finit souvent par .ics, par
              exemple https://planning-paris.omneseducation.com/…/Edt_NOM.ics?…). Il est enregistré, chiffré, sur votre
              compte : vous n&apos;aurez plus à le saisir. Biblio B1 ne demande ni ne stocke votre mot de passe Boostcamp.
            </p>
            <p className="text-sm">
              <a className="underline underline-offset-2" href="https://boostcamp.omneseducation.com/home" target="_blank" rel="noreferrer">
                Ouvrir Boostcamp
              </a>
            </p>
          </div>
          <ActionForm action={link} submitLabel="Lier le calendrier">
            <Field label="Lien de votre calendrier (.ics)" name="calendarUrl" type="url" autoComplete="off" />
          </ActionForm>
        </section>
      ) : (
        <>
          {reauthRequired ? (
            <section role="alert" className="flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger-bg p-4 text-danger">
              <div>
                <h2 className="font-semibold">Reconnexion nécessaire</h2>
                <p className="mt-1 text-sm">
                  Le lien a expiré ou n&apos;est plus lisible. Les événements affichés datent de la dernière synchronisation.
                </p>
              </div>
              <ActionForm action={link} submitLabel="Reconnecter le calendrier">
                <Field label="Nouveau lien de votre calendrier (.ics)" name="calendarUrl" type="url" autoComplete="off" />
              </ActionForm>
            </section>
          ) : (
            syncError && (
              <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
                Synchronisation impossible : {syncError} Les événements affichés sont ceux de la dernière synchronisation.
              </p>
            )
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-2">
              Dernière synchronisation : {calendar.syncedAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={sync} submitLabel="Synchroniser maintenant">
                <span className="sr-only">Actualiser les événements depuis le flux Boostcamp.</span>
              </ActionForm>
              <button
                className="btn h-10"
                type="button"
                onClick={async () => {
                  const r = await callCalendar({ action: "unlink" });
                  if (r.ok) setCalendar(null);
                }}
              >
                Délier le calendrier
              </button>
            </div>
          </div>
          <PageRefreshProvider value={() => void sync()}>
            <CalendarView events={calendar.events} subjects={data.subjects} homeworks={data.homeworks} />
          </PageRefreshProvider>
        </>
      )}
    </div>
  );
}
