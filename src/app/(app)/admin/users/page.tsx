import Link from "next/link";
import { listPendingUsers } from "@/server/auth/signup";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { approveUserAction, rejectUserAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demandes de compte" };

const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

export default async function PendingUsersPage() {
  await requireUser("admin");
  const pending = listPendingUsers(getDb());

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Demandes de compte</h1>
        <p className="text-ink-2">
          Les personnes inscrites depuis <code className="font-mono text-[13px]">/signup</code> ne peuvent pas se
          connecter tant que vous n&apos;avez pas accepté leur demande. Un refus supprime la demande.
        </p>
      </header>

      {!env.NTFY_TOPIC && (
        <p role="status" className="max-w-2xl rounded-md border border-line bg-sunken p-3 text-sm text-ink-2">
          Notifications désactivées : définissez <code>NTFY_TOPIC</code> dans le fichier <code>.env</code> pour être
          prévenu sur votre téléphone (application ntfy) à chaque nouvelle demande.
        </p>
      )}

      {pending.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-5 text-[14px] text-ink-2">
          Aucune demande en attente. Vous pouvez aussi{" "}
          <Link href="/admin/invites" className="text-ink underline underline-offset-2">
            créer une invitation
          </Link>{" "}
          (accès direct, sans validation).
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
          {pending.map((u) => (
            <li key={u.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium break-words">{u.name}</p>
                <p className="text-sm break-all text-ink-2">{u.email}</p>
                <p className="text-xs text-ink-3">Demandé le {fmt.format(u.createdAt)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <form action={approveUserAction}>
                  <input type="hidden" name="id" value={u.id} />
                  <button type="submit" className="btn btn-primary">
                    Accepter
                  </button>
                </form>
                <form action={rejectUserAction}>
                  <input type="hidden" name="id" value={u.id} />
                  <button type="submit" className="btn text-danger">
                    Refuser
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
