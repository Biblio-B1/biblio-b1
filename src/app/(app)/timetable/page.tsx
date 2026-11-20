import { ActionForm, Field } from "@/components/ActionForm";
import { requireUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { getCalendar, getStoredCalendar, CalendarError } from "@/server/boostcamp/calendar";
import { getDb } from "@/server/db/client";
import { listHomeworks } from "@/server/homeworks";
import { listSubjects } from "@/server/subjects";
import { CalendarView } from "@/components/calendar/CalendarView";
import { linkCalendarAction, syncCalendarAction, unlinkCalendarAction } from "./actions";

export const metadata = { title: "Emploi du temps" };

export default async function TimetablePage() {
  const user = await requireUser();
  const db = getDb();
  const subjects = listSubjects(db).map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    color: s.color,
    rules: s.rules,
  }));
  const homeworks = listHomeworks(db);
  const canLinkCalendar = Boolean(env.CALENDAR_ENCRYPTION_KEY);
  let calendar = getStoredCalendar(db, user.id);
  let syncError: string | undefined;
  let reauthRequired = false;

  if (calendar) {
    try {
      calendar = await getCalendar(db, user.id);
    } catch (error) {
      if (!(error instanceof CalendarError)) throw error;
      syncError = error.message;
      reauthRequired = error.code === "reauth_required";
    }
  }

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
              Connectez-vous sur Boostcamp, puis collez ici le lien HTTPS de votre proxy iCalendar (.ical).
              Biblio B1 ne demande ni ne stocke votre mot de passe Boostcamp.
            </p>
            <p className="text-sm">
              <a className="underline underline-offset-2" href="https://boostcamp.omneseducation.com/home" target="_blank" rel="noreferrer">
                Ouvrir Boostcamp
              </a>
            </p>
            <p className="text-sm text-ink-2">
              Le proxy doit être accessible publiquement en HTTPS et renvoyer un calendrier iCalendar valide.
            </p>
          </div>
          {canLinkCalendar ? (
            <ActionForm action={linkCalendarAction} submitLabel="Lier le calendrier">
              <Field label="Lien du proxy iCalendar (.ical)" name="calendarUrl" type="url" autoComplete="off" />
            </ActionForm>
          ) : (
            <p role="status" className="rounded-md border border-line bg-sunken p-3 text-sm text-ink-2">
              La liaison est désactivée : l’administrateur doit configurer <code>CALENDAR_ENCRYPTION_KEY</code> sur le serveur.
            </p>
          )}
        </section>
      ) : (
        <>
          {reauthRequired ? (
            <section role="alert" className="flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger-bg p-4 text-danger">
              <div>
                <h2 className="font-semibold">Reconnexion nécessaire</h2>
                <p className="mt-1 text-sm">
                  Le proxy iCalendar a refusé l’accès ou son lien a expiré. Les événements affichés datent de la dernière synchronisation.
                </p>
              </div>
              <a className="w-fit text-sm underline underline-offset-2" href="https://boostcamp.omneseducation.com/home" target="_blank" rel="noreferrer">
                Ouvrir Boostcamp
              </a>
              {canLinkCalendar ? (
                <ActionForm action={linkCalendarAction} submitLabel="Reconnecter le calendrier">
                  <Field label="Nouveau lien du proxy iCalendar (.ical)" name="calendarUrl" type="url" autoComplete="off" />
                </ActionForm>
              ) : (
                <p className="text-sm">L’administrateur doit configurer <code>CALENDAR_ENCRYPTION_KEY</code> sur le serveur.</p>
              )}
            </section>
          ) : syncError && (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
              Synchronisation impossible : {syncError} Les événements affichés sont ceux de la dernière synchronisation.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-2">
              Dernière synchronisation : {calendar.syncedAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={syncCalendarAction} submitLabel="Synchroniser maintenant">
                <span className="sr-only">Actualiser les événements depuis le flux Boostcamp.</span>
              </ActionForm>
              <form action={unlinkCalendarAction}>
                <button className="btn h-10" type="submit">Délier le calendrier</button>
              </form>
            </div>
          </div>
          <CalendarView events={calendar.events} subjects={subjects} homeworks={homeworks} />
        </>
      )}
    </div>
  );
}
