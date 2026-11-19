import { ActionForm, Field } from "@/components/ActionForm";
import { getDb } from "@/server/db/client";
import { listInvites } from "@/server/auth/invites";
import { requireUser } from "@/server/auth/session";
import { createInviteAction, revokeInviteAction } from "../../(auth)/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invitations — Biblio B1" };

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
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <h1 className="text-2xl font-semibold">Invitations</h1>
      <section className="max-w-sm">
        <h2 className="mb-3 font-medium">Nouvelle invitation</h2>
        <ActionForm action={createInviteAction} submitLabel="Créer l'invitation">
          <Field label="Nombre d'utilisations" name="maxUses" type="number" defaultValue={1} min={1} />
          <Field label="Validité (jours)" name="expiresInDays" type="number" defaultValue={7} min={1} />
        </ActionForm>
      </section>
      <section>
        <h2 className="mb-3 font-medium">Invitations existantes</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-500">Aucune invitation.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2">Créée le</th>
                <th>Usages</th>
                <th>Expire le</th>
                <th>Statut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="py-2">{fmt.format(r.createdAt)}</td>
                  <td>
                    {r.uses} / {r.maxUses}
                  </td>
                  <td>{r.expiresAt ? fmt.format(r.expiresAt) : "—"}</td>
                  <td>{statusOf(r)}</td>
                  <td>
                    {statusOf(r) === "Active" && (
                      <form action={revokeInviteAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-red-700 underline">Révoquer</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
