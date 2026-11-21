"use client";

import Link from "next/link";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { listOpenReports } from "@/lib/api/training";
import { useData } from "@/lib/api/use-data";
import { exerciseHref } from "@/lib/routes";

const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

/** Admin : signalements de tests erronés non traités, avec lien vers chaque exercice. */
function Reports() {
  const { data: rows, error } = useData(listOpenReports, []);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="page-title">Signalements</h1>
      <p className="max-w-2xl text-sm text-ink-2">
        Tests signalés comme faux par les étudiants. Ouvrez l&apos;exercice pour corriger les tests (outils
        administrateur) puis marquez le signalement comme traité.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">{error}</p>
      ) : !rows ? (
        <p className="text-sm text-ink-3">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-2">Aucun signalement en attente.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3 text-sm">
              <Link href={exerciseHref(r.exerciseId)} className="font-medium underline-offset-2 hover:underline">
                {r.exerciseTitle}
              </Link>
              <p className="text-[13px] text-ink-3">
                {r.authorName} · {fmt.format(r.createdAt)}
              </p>
              <p className="whitespace-pre-wrap break-words">{r.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <RequireAuth admin>
      <Reports />
    </RequireAuth>
  );
}
