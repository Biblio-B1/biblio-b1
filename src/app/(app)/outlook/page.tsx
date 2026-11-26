"use client";

// Retour de Microsoft après « Lier mon Outlook » : enregistre l'adresse du compte puis revient
// sur la page d'où la liaison a été lancée.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { saveLinkedOutlook } from "@/lib/api/outlook";
import { finishOutlookLink } from "@/lib/outlook-link";

export default function OutlookCallbackPage() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [back, setBack] = useState("/settings");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const r = await finishOutlookLink(window.location.search).catch(() => ({ error: "La connexion à Outlook n'a pas abouti. Réessayez.", returnTo: "/settings" }));
      setBack(r.returnTo);
      if ("error" in r) return setError(r.error);
      try {
        await saveLinkedOutlook(r.account);
        router.replace(r.returnTo);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Le compte Outlook n'a pas pu être enregistré.");
      }
    })();
  }, [router]);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-10">
      <h1 className="page-title">Liaison Outlook</h1>
      {error ? (
        <>
          <p role="alert" className="text-danger">{error}</p>
          <Link href={back} className="btn self-start">
            Retour
          </Link>
        </>
      ) : (
        <p className="text-ink-2">Connexion à votre compte Outlook…</p>
      )}
    </div>
  );
}
