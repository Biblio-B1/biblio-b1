"use client";

// État de la liaison Outlook (compte Microsoft de l'école) : « Lié : … » ou bouton « Lier mon Outlook ».
// Déjà connecté à Outlook dans le navigateur : Microsoft renvoie aussitôt, sans mot de passe.
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { IconMail } from "@/components/layout/Icons";
import { getLinkedOutlook, unlinkOutlook } from "@/lib/api/outlook";
import { useData } from "@/lib/api/use-data";
import { isSchoolEmail, outlookLinkAvailable, startOutlookLink } from "@/lib/outlook-link";
import { SCHOOL_OUTLOOK_URL } from "@/lib/teachers";

export function OutlookLink({ compact = false }: { compact?: boolean }) {
  const { session } = useAuth();
  const pathname = usePathname();
  const { data: linked, error, loading, reload } = useData(getLinkedOutlook, []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const openMailbox = (
    <a href={SCHOOL_OUTLOOK_URL} target="_blank" rel="noreferrer" className={`btn ${compact ? "h-9" : ""} shrink-0`}>
      <IconMail size={16} />
      Ouvrir ma boîte Outlook
    </a>
  );

  if (loading && !linked) return <p className="text-sm text-ink-3">Chargement…</p>;

  if (linked) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink">
            <span className="font-medium text-ok">✓ Outlook lié</span> : <strong className="break-all">{linked.email}</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            {openMailbox}
            <button
              type="button"
              className={`btn ${compact ? "h-9" : ""} text-danger`}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await unlinkOutlook();
                  setNote("Compte Outlook délié.");
                  reload();
                } catch (e) {
                  setNote(e instanceof Error ? e.message : "Erreur.");
                }
                setBusy(false);
              }}
            >
              Délier
            </button>
          </div>
        </div>
        {!isSchoolEmail(linked.email) && (
          <p role="status" className="text-sm text-danger">
            Ce n&apos;est pas une adresse @edu.ece.fr : les professeurs risquent de ne pas répondre. Déliez puis liez votre compte
            de l&apos;école.
          </p>
        )}
        {note && <p role="status" className="text-sm text-ink-2">{note}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {outlookLinkAvailable() ? (
          <button
            type="button"
            className={`btn btn-primary ${compact ? "h-9" : ""}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await startOutlookLink({ returnTo: pathname || "/settings", siteEmail: session?.user.email });
            }}
          >
            <IconMail size={16} />
            {busy ? "Connexion à Microsoft…" : "Lier mon Outlook"}
          </button>
        ) : null}
        {openMailbox}
      </div>
      {outlookLinkAvailable() && (
        <p className="text-[13px] text-ink-3">
          Déjà connecté à Outlook dans ce navigateur ? La liaison se fait sans redemander le mot de passe.
        </p>
      )}
      {note && <p role="status" className="text-sm text-ink-2">{note}</p>}
    </div>
  );
}
