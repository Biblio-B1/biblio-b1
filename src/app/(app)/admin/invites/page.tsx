import { ActionForm, Field } from "@/components/ActionForm";
import { getDb } from "@/server/db/client";
import { listInvites } from "@/server/auth/invites";
import { requireUser } from "@/server/auth/session";
import { createInviteAction, revokeInviteAction } from "@/app/(auth)/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invitations" };

const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

export default async function InvitesPage() {
  await requireUser("admin");
  const rows = listInvites(getDb());
  const now = Date.now();
  const statusOf = (r: (typeof rows)[number]) =>
    r.revoked
      ? "Révoquée"
      : r.expiresAt && r.expiresAt.getTime() <= now
        ? "Expirée"
        : r.uses >= r.maxUses
          ? "Épuisée"
          : "Active";

  return (
    <div className="flex flex-col gap-8">
      <h1 className="page-title">Invitations</h1>
      <section className="max-w-sm">
        <h2 className="mb-3 text-[15px] font-semibold">Nouvelle invitation</h2>
        <ActionForm action={createInviteAction} submitLabel="Créer l'invitation">
          <Field label="Nombre d'utilisations" name="maxUses" type="number" defaultValue={1} min={1} />
          <Field label="Validité (jours)" name="expiresInDays" type="number" defaultValue={7} min={1} />
        </ActionForm>
      </section>
      <section>
        <h2 className="mb-3 text-[15px] font-semibold">Invitations existantes</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-2">Aucune invitation.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink-2">
                <th className="px-3 py-2 font-medium">Créée le</th>
                <th className="font-medium">Usages</th>
                <th className="font-medium">Expire le</th>
                <th className="font-medium">Statut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">{fmt.format(r.createdAt)}</td>
                  <td>
                    {r.uses} / {r.maxUses}
                  </td>
                  <td>{r.expiresAt ? fmt.format(r.expiresAt) : "—"}</td>
                  <td>{statusOf(r)}</td>
                  <td>
                    {statusOf(r) === "Active" && (
                      <form action={revokeInviteAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-danger underline underline-offset-2">Révoquer</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </div>
  );
}
