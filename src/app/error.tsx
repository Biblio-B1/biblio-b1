"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 px-6">
      <p className="text-[13px] font-medium text-ink-3">Erreur</p>
      <h1 className="page-title">Une erreur est survenue</h1>
      <p className="text-ink-2">
        Quelque chose s&apos;est mal passé de notre côté. Réessayez ; si cela se reproduit, prévenez l&apos;administrateur.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="btn btn-primary">
          Réessayer
        </button>
        <Link href="/" className="btn">
          Accueil
        </Link>
      </div>
    </main>
  );
}
