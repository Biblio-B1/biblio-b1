"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { AuthShell } from "@/components/layout/AuthShell";

export default function PendingPage() {
  const { session, profile, loading, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (profile?.status === "active") router.replace("/");
  }, [loading, session, profile, router]);

  return (
    <AuthShell
      title="Compte en attente"
      intro="Votre demande a bien été envoyée. L'administrateur doit valider votre compte avant que vous puissiez accéder aux documents."
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            await refreshProfile();
            setChecking(false);
          }}
        >
          {checking ? "Vérification…" : "Vérifier à nouveau"}
        </button>
        <button type="button" className="btn" onClick={() => void signOut()}>
          Se déconnecter
        </button>
      </div>
    </AuthShell>
  );
}
