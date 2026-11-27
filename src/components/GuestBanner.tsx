"use client";

// Bandeau du mode invité : rappelle que la visite est en lecture seule et propose de créer un compte.
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";

export function GuestBanner() {
  const { isGuest } = useAuth();
  const router = useRouter();
  if (!isGuest) return null;

  async function leaveFor(path: "/signup" | "/login") {
    await getSupabase().auth.signOut();
    router.replace(path);
  }

  return (
    <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-sunken p-3 text-sm">
      <p>
        <strong>Mode invité</strong> : vous pouvez tout consulter, mais rien ajouter ni supprimer.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary h-9" onClick={() => void leaveFor("/signup")}>
          Créer un compte
        </button>
        <button type="button" className="btn h-9" onClick={() => void leaveFor("/login")}>
          Se connecter
        </button>
      </div>
    </div>
  );
}
