"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { getMyCalendar } from "@/lib/api/calendar";
import { addTeacher, deleteTeacher, listTeachers, registerTeachers, setTeacherEmail, type Teacher } from "@/lib/api/teachers";
import { useData } from "@/lib/api/use-data";
import { displayTeacherName, extractTeachers, mailLinks } from "@/lib/teachers";

/** Relève les profs de son emploi du temps (nouveaux noms ou matières), puis lit l'annuaire. */
async function loadTeachers(): Promise<Teacher[]> {
  const [teachers, calendar] = await Promise.all([listTeachers(), getMyCalendar().catch(() => null)]);
  if (!calendar) return teachers;
  const known = new Map(teachers.map((t) => [t.name.toLowerCase(), t]));
  const missing = extractTeachers(calendar.events).filter((f) => {
    const t = known.get(f.name.toLowerCase());
    return !t || f.subjects.some((s) => !t.subjects.includes(s));
  });
  if (missing.length === 0) return teachers;
  await registerTeachers(missing).catch(() => undefined);
  return listTeachers();
}

function EmailEditor({ teacher, onSaved }: { teacher: Teacher; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(teacher.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <button type="button" className="text-[13px] text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={() => setEditing(true)}>
        {teacher.email ? "Corriger l'e-mail" : "Ajouter l'e-mail"}
      </button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await setTeacherEmail(teacher.id, value.trim() || null);
          setEditing(false);
          onSaved();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Enregistrement impossible.");
        }
        setBusy(false);
      }}
    >
      <div className="flex gap-2">
        <input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="prenom.nom@…"
          aria-label={`E-mail de ${displayTeacherName(teacher.name)}`}
          className="input h-9 min-w-0 flex-1"
          autoFocus
        />
        <button type="submit" className="btn btn-primary h-9" disabled={busy}>
          Enregistrer
        </button>
        <button type="button" className="btn h-9" onClick={() => setEditing(false)}>
          Annuler
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  );
}

function Composer({ teachers, to, setTo }: { teachers: Teacher[]; to: string[]; setTo: (ids: string[]) => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);
  const withEmail = teachers.filter((t) => t.email);
  const recipients = withEmail.filter((t) => to.includes(t.id));
  const links = mailLinks({ to: recipients.map((t) => t.email!), subject, body });
  const disabled = recipients.length === 0;

  return (
    <section id="ecrire" className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Écrire à un professeur</h2>
        <p className="text-sm text-ink-2">
          Le message part de votre propre adresse : « Envoyer avec Outlook » ouvre un brouillon prêt dans Outlook (compte de
          l&apos;école), il ne reste qu&apos;à cliquer sur Envoyer.
        </p>
      </div>
      {withEmail.length === 0 ? (
        <p className="text-sm text-ink-3">Aucun professeur n&apos;a encore d&apos;e-mail : ajoutez-en un dans la liste ci-dessous.</p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-ink-2">Destinataires</legend>
          <div className="flex flex-wrap gap-2">
            {withEmail.map((t) => {
              const checked = to.includes(t.id);
              return (
                <label
                  key={t.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                    checked ? "border-primary bg-primary/10 text-ink" : "border-line-strong text-ink-2"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => setTo(checked ? to.filter((x) => x !== t.id) : [...to, t.id])}
                  />
                  {checked ? "✓ " : ""}
                  {displayTeacherName(t.name)}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      <label className="label">
        Objet
        <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
      </label>
      <label className="label">
        Message
        <textarea
          className="input min-h-32 py-2"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={"Bonjour,\n\n…\n\nCordialement,"}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <a
          href={disabled ? undefined : links.outlook}
          target="_blank"
          rel="noreferrer"
          aria-disabled={disabled}
          className={`btn btn-primary h-10 ${disabled ? "pointer-events-none opacity-50" : ""}`}
        >
          Envoyer avec Outlook
        </a>
        <a
          href={disabled ? undefined : links.mailto}
          aria-disabled={disabled}
          className={`btn h-10 ${disabled ? "pointer-events-none opacity-50" : ""}`}
        >
          Ouvrir dans ma messagerie
        </a>
        <button
          type="button"
          className="btn h-10"
          disabled={disabled}
          onClick={async () => {
            await navigator.clipboard?.writeText(recipients.map((t) => t.email).join(", "));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Adresses copiées" : "Copier les adresses"}
        </button>
      </div>
      {disabled && withEmail.length > 0 && <p className="text-sm text-ink-3">Choisissez au moins un destinataire.</p>}
    </section>
  );
}

function AddTeacher({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <details className="rounded-lg border border-line bg-surface p-4">
      <summary className="cursor-pointer text-sm font-medium">Ajouter un professeur absent de la liste</summary>
      <form
        className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (name.trim().length < 2) return setError("Saisissez le nom du professeur.");
          try {
            await addTeacher(name.trim(), email.trim() || null);
            setName("");
            setEmail("");
            onAdded();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Ajout impossible.");
          }
        }}
      >
        <label className="label flex-1">
          Nom
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mme Dupont Anne" maxLength={80} />
        </label>
        <label className="label flex-1">
          E-mail (facultatif)
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary h-10">
          Ajouter
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </details>
  );
}

export default function TeachersPage() {
  const { profile } = useAuth();
  const { data, error, reload } = useData(loadTeachers, []);
  const [query, setQuery] = useState("");
  const [to, setTo] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter(
      (t) => !q || t.name.toLowerCase().includes(q) || t.subjects.some((s) => s.toLowerCase().includes(q)) || t.email?.includes(q),
    );
  }, [data, query]);

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-ink-3">Chargement…</p>;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Professeurs</h1>
        <p className="text-ink-2">
          Les noms viennent des emplois du temps Boostcamp. Les e-mails sont partagés par la classe : si vous en connaissez
          un (fiche du cours sur{" "}
          <a className="underline underline-offset-2" href="https://boostcamp.omneseducation.com/home" target="_blank" rel="noreferrer">
            Boostcamp
          </a>{" "}
          ou annuaire{" "}
          <a className="underline underline-offset-2" href="https://outlook.office.com/people/" target="_blank" rel="noreferrer">
            Outlook
          </a>
          ), ajoutez-le.
        </p>
      </header>

      <Composer teachers={data} to={to} setTo={setTo} />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Annuaire ({data.length})</h2>
          <input
            type="search"
            className="input h-9 max-w-xs"
            placeholder="Nom, matière…"
            aria-label="Filtrer les professeurs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {data.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong p-5 text-[14px] text-ink-2">
            Aucun professeur pour l&apos;instant. Liez votre emploi du temps Boostcamp dans les paramètres : les enseignants de
            vos cours apparaîtront ici.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
            {shown.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{displayTeacherName(t.name)}</p>
                    {t.subjects.length > 0 && <p className="text-sm text-ink-2">{t.subjects.join(" · ")}</p>}
                    {t.email ? (
                      <a href={`mailto:${t.email}`} className="text-sm break-all text-ink underline-offset-2 hover:underline">
                        {t.email}
                      </a>
                    ) : (
                      <p className="text-sm text-ink-3">E-mail inconnu</p>
                    )}
                  </div>
                  {t.email && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <a
                        href="#ecrire"
                        className="btn h-9"
                        onClick={() => setTo(to.includes(t.id) ? to : [...to, t.id])}
                      >
                        Écrire
                      </a>
                      <button
                        type="button"
                        className="btn h-9"
                        onClick={async () => {
                          await navigator.clipboard?.writeText(t.email!);
                          setCopiedId(t.id);
                          setTimeout(() => setCopiedId(null), 2000);
                        }}
                      >
                        {copiedId === t.id ? "Copié" : "Copier"}
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <EmailEditor key={t.email ?? ""} teacher={t} onSaved={reload} />
                  {profile?.role === "admin" && (
                    <button
                      type="button"
                      className="text-[13px] text-danger underline-offset-2 hover:underline"
                      onClick={async () => {
                        if (!window.confirm(`Retirer ${displayTeacherName(t.name)} de l'annuaire ?`)) return;
                        await deleteTeacher(t.id).catch(() => undefined);
                        reload();
                      }}
                    >
                      Retirer
                    </button>
                  )}
                </div>
              </li>
            ))}
            {shown.length === 0 && <li className="p-4 text-sm text-ink-3">Aucun résultat.</li>}
          </ul>
        )}
      </section>

      <AddTeacher onAdded={reload} />
    </div>
  );
}
