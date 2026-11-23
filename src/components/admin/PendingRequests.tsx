"use client";

// Demandes de compte en attente, pour l'administrateur : relues chaque minute (et au retour sur
// l'onglet), signalées par une bannière en haut du site et, si activé dans les paramètres, par une
// notification du navigateur pour chaque nouvelle demande.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { browserNotificationsOn, loadSeen, newRequests, saveSeen } from "@/lib/admin-notify";
import { getSupabase } from "@/lib/supabase/client";

type Request = { id: string; name: string };
const POLL_MS = 60_000;

export function usePendingRequests(isAdmin: boolean): Request[] {
  const [requests, setRequests] = useState<Request[]>([]);

  const check = useCallback(async () => {
    const { data, error } = await getSupabase().rpc("pending_requests");
    if (error) return;
    const list = ((data as Request[] | null) ?? []).map((r) => ({ id: r.id, name: r.name }));
    setRequests(list);
    const fresh = newRequests(list, loadSeen());
    saveSeen(list.map((r) => r.id));
    if (fresh.length > 0 && browserNotificationsOn()) {
      for (const r of fresh) {
        try {
          const n = new Notification("Biblio B1 : nouvelle demande de compte", { body: `${r.name} demande l'accès au site.`, tag: r.id });
          n.onclick = () => {
            window.focus();
            window.location.assign(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/admin/users/`);
          };
        } catch {
          // Certains navigateurs mobiles refusent `new Notification` : la bannière suffit.
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    // La page des demandes prévient après une décision (accepté / refusé).
    window.addEventListener(PENDING_CHANGED, check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(PENDING_CHANGED, check);
    };
  }, [isAdmin, check]);

  return isAdmin ? requests : [];
}

export const PENDING_CHANGED = "bb1:pending-changed";

export function PendingBanner({ requests }: { requests: Request[] }) {
  const pathname = usePathname();
  if (requests.length === 0 || pathname === "/admin/users") return null;
  const names = requests.slice(0, 3).map((r) => r.name).join(", ") + (requests.length > 3 ? "…" : "");
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
      <p>
        <strong>
          {requests.length === 1 ? "1 demande de compte" : `${requests.length} demandes de compte`} en attente
        </strong>{" "}
        : {names}
      </p>
      <Link href="/admin/users" className="btn btn-primary h-9">
        Voir les demandes
      </Link>
    </div>
  );
}
