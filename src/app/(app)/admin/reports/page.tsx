import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listOpenReports } from "@/server/checks";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signalements" };

const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

/** Admin : signalements de tests erronés non traités, avec lien vers chaque exercice. */
export default async function ReportsPage() {
  const user = await requireUser("admin");
  const rows = listOpenReports(getDb(), { id: user.id, role: user.role });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="page-title">Signalements</h1>
      <p className="max-w-2xl text-sm text-ink-2">
        Tests signalés comme faux par les étudiants. Ouvrez l&apos;exercice pour corriger les tests (outils
        administrateur) puis marquez le signalement comme traité.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">Aucun signalement en attente.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3 text-sm">
              <Link href={`/training/${r.exerciseId}`} className="font-medium underline-offset-2 hover:underline">
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
