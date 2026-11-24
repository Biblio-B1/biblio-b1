"use client";

// Session de l'utilisateur pour tout le site : compte Supabase + profil (nom, rôle, statut).
// La session reste ouverte jusqu'à la déconnexion (pas de délai d'inactivité).
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

export type Profile = {
  id: string;
  name: string;
  role: "admin" | "member";
  status: "active" | "pending";
  /** Tutoriel de première connexion terminé ou passé (null : à montrer). */
  tutorial_done_at?: string | null;
};

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** Relit le profil (après validation d'un compte, changement de nom…). */
  refreshProfile(): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data } = await getSupabase().from("profiles").select("id, name, role, status, tutorial_done_at").eq("id", userId).maybeSingle();
  return (data as Profile | null) ?? null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    setSession(null);
    setProfile(null);
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    // Ancienne minuterie d'inactivité (retirée) : on efface sa trace.
    try {
      window.localStorage.removeItem("bb1-last-activity");
    } catch {
      // stockage indisponible : rien à effacer
    }
    const supabase = getSupabase();
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setProfile(data.session ? await loadProfile(data.session.user.id) : null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) setProfile(null);
      else void loadProfile(next.user.id).then(setProfile);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      signOut,
      refreshProfile: async () => {
        if (session) setProfile(await loadProfile(session.user.id));
      },
    }),
    [session, profile, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé sous <AuthProvider>");
  return ctx;
}
