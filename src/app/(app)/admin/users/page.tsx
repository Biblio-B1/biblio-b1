"use client";

import { useCallback, useEffect, useState } from "react";
import { PENDING_CHANGED } from "@/components/admin/PendingRequests";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { getSupabase } from "@/lib/supabase/client";

type Request = { id: string; name: string; email: string; created_at: string };

const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

function PendingRequests() {
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await getSupabase().rpc("pending_requests");
    if (e) setError("Impossible de charger les demandes.");
    else setRequests((data as Request[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, accept: boolean) {
    setBusy(id);
    setError(null);
    const supabase = getSupabase();
    const res = accept
      ? await supabase.from("profiles").update({ status: "active" }).eq("id", id)
      : await supabase.functions.invoke("admin-users", { body: { action: "reject", userId: id } });
    if (res.error) setError(accept ? "Validation impossible." : "Refus impossible.");
    await load();
    window.dispatchEvent(new Event(PENDING_CHANGED));
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Demandes de compte</h1>
        <p className="text-ink-2">
          Une personne inscrite ne voit rien tant que vous n&apos;avez pas accepté sa demande. Ensuite, elle se reconnecte
          simplement avec son mot de passe. Refuser supprime la demande.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg p-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {requests === null ? (
        <p className="text-sm text-ink-3">Chargement…</p>
      ) : requests.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-5 text-[14px] text-ink-2">Aucune demande en attente.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
          {requests.map((u) => (
            <li key={u.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium break-words">{u.name}</p>
                <p className="text-sm break-all text-ink-2">{u.email}</p>
                <p className="text-xs text-ink-3">Demandé le {fmt.format(new Date(u.created_at))}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className="btn btn-primary" disabled={busy === u.id} onClick={() => void decide(u.id, true)}>
                  Accepter
                </button>
                <button type="button" className="btn text-danger" disabled={busy === u.id} onClick={() => void decide(u.id, false)}>
                  Refuser
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PendingUsersPage() {
  return (
    <RequireAuth admin>
      <PendingRequests />
    </RequireAuth>
  );
}
