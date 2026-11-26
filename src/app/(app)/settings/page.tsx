"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionForm, Field, type FormState } from "@/components/ActionForm";
import { useAuth } from "@/components/auth/AuthProvider";
import { TelegramChannelLink } from "@/components/TelegramChannel";
import { TUTORIAL_EVENT } from "@/components/Tutorial";
import {
  browserNotificationsOn,
  disableBrowserNotifications,
  enableBrowserNotifications,
  notificationsSupported,
} from "@/lib/admin-notify";
import { CALENDAR_SOURCES, callCalendar, getMyCalendar, type CalendarSource, type StoredCalendar } from "@/lib/api/calendar";
import { getShowEmail, setShowEmail } from "@/lib/api/teachers";
import { OutlookLink } from "@/components/OutlookLink";
import { useData } from "@/lib/api/use-data";
import { renameErrorMessage, splitName, validatePasswordChange, validateRename } from "@/lib/auth/account-form";
import { getSupabase } from "@/lib/supabase/client";

const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

function Section({ title, intro, children, danger }: { title: string; intro?: React.ReactNode; children: React.ReactNode; danger?: boolean }) {
  return (
    <section className={`flex flex-col gap-4 rounded-lg border bg-surface p-5 ${danger ? "border-danger/40" : "border-line"}`}>
      <div className="flex flex-col gap-1">
        <h2 className={`text-base font-semibold ${danger ? "text-danger" : ""}`}>{title}</h2>
        {intro && <div className="text-sm text-ink-2">{intro}</div>}
      </div>
      {children}
    </section>
  );
}

/** Vérifie le mot de passe actuel (nouvelle connexion, la session reste la même personne). */
async function checkPassword(email: string, password: string): Promise<boolean> {
  const { error } = await getSupabase().auth.signInWithPassword({ email, password });
  return !error;
}

function ProfileSection() {
  const { profile, refreshProfile } = useAuth();
  const { prenom, nom } = splitName(profile?.name ?? "");
  async function rename(_prev: FormState, fd: FormData): Promise<FormState> {
    const v = validateRename({ prenom: String(fd.get("prenom") ?? ""), nom: String(fd.get("nom") ?? "") });
    if (!v.ok) return { error: v.error };
    if (!profile) return { error: "Session expirée : reconnectez-vous." };
    const { error } = await getSupabase().from("profiles").update({ name: v.name }).eq("id", profile.id);
    if (error) return { error: renameErrorMessage(error.message) };
    await refreshProfile();
    return { message: `Vous apparaissez maintenant sous le nom « ${v.name} ».` };
  }
  return (
    <Section title="Nom affiché" intro="Visible par les autres membres (questions, devoirs, dépôts).">
      <ActionForm action={rename} submitLabel="Enregistrer le nom">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prénom" name="prenom" autoComplete="given-name" defaultValue={prenom} />
          <Field label="Nom" name="nom" autoComplete="family-name" defaultValue={nom} />
        </div>
      </ActionForm>
    </Section>
  );
}

function DirectorySection({ email }: { email: string }) {
  const { profile } = useAuth();
  const [show, setShow] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (profile) void getShowEmail(profile.id).then(setShow);
  }, [profile]);
  return (
    <Section title="Annuaire" intro="Les autres élèves vous voient dans l'annuaire. Votre e-mail n'y apparaît que si vous le choisissez.">
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={show ?? false}
          disabled={show === null || !profile}
          onChange={async (e) => {
            const next = e.target.checked;
            setShow(next);
            setNote(null);
            try {
              await setShowEmail(profile!.id, next);
              setNote(next ? `${email} est visible dans l'annuaire.` : "Votre e-mail est masqué dans l'annuaire.");
            } catch (err) {
              setShow(!next);
              setNote(err instanceof Error ? err.message : "Réglage impossible à enregistrer.");
            }
          }}
        />
        Afficher mon e-mail ({email}) aux autres élèves
      </label>
      {note && <p role="status" className="text-sm text-ink-2">{note}</p>}
    </Section>
  );
}

function PasswordSection({ email }: { email: string }) {
  async function change(_prev: FormState, fd: FormData): Promise<FormState> {
    const input = {
      current: String(fd.get("current") ?? ""),
      password: String(fd.get("password") ?? ""),
      confirm: String(fd.get("confirm") ?? ""),
    };
    const v = validatePasswordChange(input);
    if (!v.ok) return { error: v.error };
    if (!(await checkPassword(email, input.current))) return { error: "Mot de passe actuel incorrect." };
    const { error } = await getSupabase().auth.updateUser({ password: input.password });
    if (error) return { error: "Le mot de passe n'a pas pu être changé. Réessayez plus tard." };
    return { message: "Mot de passe changé. Utilisez-le à votre prochaine connexion." };
  }
  return (
    <Section title="Mot de passe">
      <ActionForm action={change} submitLabel="Changer le mot de passe">
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        <Field label="Mot de passe actuel" name="current" type="password" autoComplete="current-password" />
        <Field label="Nouveau mot de passe (8 caractères min.)" name="password" type="password" autoComplete="new-password" />
        <Field label="Confirmez le nouveau mot de passe" name="confirm" type="password" autoComplete="new-password" />
      </ActionForm>
    </Section>
  );
}

const SOURCE_INFO: Record<CalendarSource, { title: string; help: React.ReactNode }> = {
  boostcamp: {
    title: "Emploi du temps Boostcamp (iCal)",
    help: (
      <>
        Dans Boostcamp, copiez le lien d&apos;abonnement de votre emploi du temps (adresse https qui finit souvent par
        .ics, par exemple https://planning-paris.omneseducation.com/…/Edt_NOM.ics?…).{" "}
        <a className="underline underline-offset-2" href="https://boostcamp.omneseducation.com/home" target="_blank" rel="noreferrer">
          Ouvrir Boostcamp
        </a>
      </>
    ),
  },
};

function CalendarCard({
  source,
  calendar,
  onChange,
}: {
  source: CalendarSource;
  calendar: StoredCalendar | null;
  onChange: (c: StoredCalendar | null) => void;
}) {
  const linked = calendar?.sources.find((s) => s.source === source);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = SOURCE_INFO[source];

  async function link(_prev: FormState, fd: FormData): Promise<FormState> {
    const r = await callCalendar({ action: "link", source, url: String(fd.get("calendarUrl") ?? "") });
    if (!r.ok) return { error: r.error };
    onChange(r.calendar);
    setError(null);
    return { message: "Calendrier lié." };
  }
  async function run(action: "sync" | "unlink") {
    setBusy(true);
    setError(null);
    const r = await callCalendar({ action, source });
    if (r.ok) onChange(r.calendar);
    else setError(r.error);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-medium">{info.title}</h3>
        <span className={`text-sm ${linked ? "text-ok" : "text-ink-3"}`}>
          {linked ? `Lié · synchronisé le ${fmt.format(linked.syncedAt)}` : "Non lié"}
        </span>
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg p-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {linked ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" disabled={busy} onClick={() => void run("sync")}>
            Synchroniser
          </button>
          <button type="button" className="btn text-danger" disabled={busy} onClick={() => void run("unlink")}>
            Délier
          </button>
        </div>
      ) : null}
      <details open={!linked}>
        <summary className="cursor-pointer text-sm text-ink-2">{linked ? "Remplacer le lien" : "Comment trouver le lien"}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-ink-2">{info.help}</p>
          <ActionForm action={link} submitLabel={linked ? "Remplacer le lien" : "Lier le calendrier"}>
            <Field label="Lien du calendrier (.ics)" name="calendarUrl" type="url" autoComplete="off" />
          </ActionForm>
        </div>
      </details>
    </div>
  );
}

function CalendarSection() {
  const { data, error, loading } = useData(getMyCalendar, []);
  const [calendar, setCalendar] = useState<StoredCalendar | null | undefined>(undefined);
  useEffect(() => {
    if (!loading && !error) setCalendar(data);
  }, [loading, data, error]);
  return (
    <Section
      title="Emploi du temps"
      intro="Vos cours Boostcamp s'affichent dans l'emploi du temps. Le lien est enregistré chiffré ; Biblio B1 ne demande aucun mot de passe Boostcamp."
    >
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {calendar === undefined ? (
        <p className="text-sm text-ink-3">Chargement…</p>
      ) : (
        CALENDAR_SOURCES.map((s) => <CalendarCard key={s} source={s} calendar={calendar} onChange={setCalendar} />)
      )}
    </Section>
  );
}

function OutlookSection() {
  return (
    <Section
      title="Messagerie de l'école (Outlook)"
      intro={
        <>
          Pour écrire aux professeurs depuis l&apos;annuaire, liez votre compte Outlook{" "}
          <strong className="text-ink">@edu.ece.fr</strong>. Biblio B1 ne garde que l&apos;adresse du compte : il ne voit ni
          votre mot de passe ni vos mails.
        </>
      }
    >
      <OutlookLink />
    </Section>
  );
}

function NotificationSection() {
  const [on, setOn] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setOn(browserNotificationsOn()), []);
  if (!notificationsSupported()) {
    return (
      <Section title="Alertes des demandes de compte">
        <p className="text-sm text-ink-2">Ce navigateur ne gère pas les notifications. Les demandes restent signalées sur le site et sur Telegram.</p>
      </Section>
    );
  }
  return (
    <Section
      title="Alertes des demandes de compte"
      intro="Les nouvelles demandes s'affichent en haut du site et dans le menu. Vous pouvez aussi recevoir une notification de ce navigateur tant que Biblio B1 est ouvert dans un onglet."
    >
      {note && <p role="status" className="text-sm text-ink-2">{note}</p>}
      {on ? (
        <button
          type="button"
          className="btn self-start"
          onClick={() => {
            disableBrowserNotifications();
            setOn(false);
            setNote("Notifications du navigateur désactivées.");
          }}
        >
          Désactiver les notifications du navigateur
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary self-start"
          onClick={async () => {
            const r = await enableBrowserNotifications();
            setOn(r === "granted");
            setNote(
              r === "granted"
                ? "Notifications activées sur ce navigateur."
                : "Notifications bloquées : autorisez-les pour ce site dans les réglages du navigateur.",
            );
          }}
        >
          Activer les notifications du navigateur
        </button>
      )}
    </Section>
  );
}

function DeleteSection({ email }: { email: string }) {
  const router = useRouter();
  async function remove(_prev: FormState, fd: FormData): Promise<FormState> {
    if (String(fd.get("confirmText") ?? "").trim().toUpperCase() !== "SUPPRIMER") {
      return { error: "Tapez SUPPRIMER pour confirmer." };
    }
    if (!(await checkPassword(email, String(fd.get("password") ?? "")))) return { error: "Mot de passe incorrect." };
    const supabase = getSupabase();
    const { error } = await supabase.functions.invoke("admin-users", { body: { action: "delete_self" } });
    if (error) {
      const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
      const payload = (await ctx?.json?.().catch(() => null)) as { error?: string } | null;
      return { error: payload?.error ?? "Suppression impossible. Réessayez plus tard." };
    }
    await supabase.auth.signOut();
    router.replace("/login");
    return null;
  }
  return (
    <Section
      danger
      title="Supprimer mon compte"
      intro="Définitif. Vos questions, messages, progression et calendriers sont effacés ; les documents et devoirs que vous avez déposés restent pour la classe, sans votre nom."
    >
      <ActionForm action={remove} submitLabel="Supprimer définitivement mon compte">
        <Field label="Mot de passe" name="password" type="password" autoComplete="current-password" />
        <Field label="Tapez SUPPRIMER pour confirmer" name="confirmText" autoComplete="off" />
      </ActionForm>
    </Section>
  );
}

function TutorialSection() {
  return (
    <Section title="Tutoriel" intro="La visite guidée du site : quoi y mettre, où trouver les cours, et les autres fonctionnalités.">
      <button type="button" onClick={() => window.dispatchEvent(new Event(TUTORIAL_EVENT))} className="btn self-start">
        Revoir le tutoriel
      </button>
    </Section>
  );
}

function TelegramSection() {
  return (
    <Section
      title="Canal Telegram"
      intro="Les alertes de la promo sur Telegram : nouveaux devoirs, contrôles et projets finaux, avec des rappels avant la date."
    >
      <TelegramChannelLink className="btn btn-primary self-start" />
    </Section>
  );
}

export default function SettingsPage() {
  const { session, profile } = useAuth();
  const email = session?.user.email ?? "";
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Paramètres</h1>
        <p className="text-ink-2">
          Connecté avec <span className="text-ink">{email}</span>.
        </p>
      </header>
      <CalendarSection />
      <TelegramSection />
      <OutlookSection />
      <ProfileSection key={profile?.name} />
      <DirectorySection email={email} />
      <PasswordSection email={email} />
      <TutorialSection />
      {profile?.role === "admin" && <NotificationSection />}
      <DeleteSection email={email} />
    </div>
  );
}
