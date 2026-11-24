"use client";

import Link from "next/link";
import { useEffect } from "react";
import { isStaleBuildError, reloadOnce } from "@/lib/stale-build";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleBuildError(error);

  useEffect(() => {
    console.error(error);
    // Site mis à jour pendant que l'onglet était ouvert : on recharge la nouvelle version.
    if (stale && reloadOnce()) window.location.reload();
  }, [error, stale]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 px-6">
      <p className="text-[13px] font-medium text-ink-3">Erreur</p>
      <h1 className="page-title">{stale ? "Le site vient d'être mis à jour" : "Une erreur est survenue"}</h1>
      <p className="text-ink-2">
        {stale
          ? "Rechargez la page pour utiliser la nouvelle version."
          : "Quelque chose s'est mal passé de notre côté. Réessayez ; si cela se reproduit, prévenez l'administrateur."}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          // Un rechargement complet règle aussi les versions périmées, que reset() ne corrige pas.
          onClick={() => (stale ? window.location.reload() : reset())}
          className="btn btn-primary"
        >
          {stale ? "Recharger" : "Réessayer"}
        </button>
        <Link href="/" className="btn">
          Accueil
        </Link>
      </div>
      {!stale && error.message && <p className="text-xs break-all text-ink-3">Détail : {error.message}</p>}
    </main>
  );
}
