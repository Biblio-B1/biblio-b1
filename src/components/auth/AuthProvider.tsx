"use client";

// Session de l'utilisateur pour tout le site : compte Supabase + profil (nom, rôle, statut), et
// déconnexion automatique après 15 minutes sans activité (src/lib/auth/inactivity.ts).
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createInactivityTracker, type InactivityTracker } from "@/lib/auth/inactivity";
import { getSupabase } from "@/lib/supabase/client";

export type Profile = { id: string; name: string; role: "admin" | "member"; status: "active" | "pending" };

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** Relit le profil (après validation d'un compte, changement de nom…). */
  refreshProfile(): Promise<void>;
  signOut(reason?: "expired"): Promise<void>;
  /** À appeler juste après une connexion par mot de passe (repart de zéro pour les 15 minutes). */
  markActive(): void;
};

const AuthContext = createContext<AuthState | null>(null);

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data } = await getSupabase().from("profiles").select("id, name, role, status").eq("id", userId).maybeSingle();
  return (data as Profile | null) ?? null;
}

function browserStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const trackerRef = useRef<InactivityTracker | null>(null);

  const signOut = useCallback(
    async (reason?: "expired") => {
      trackerRef.current?.clear();
      await getSupabase().auth.signOut();
      setSession(null);
      setProfile(null);
      router.replace(reason === "expired" ? "/login?expire=1" : "/login");
    },
    [router],
  );

  if (!trackerRef.current && typeof window !== "undefined") {
    trackerRef.current = createInactivityTracker({
      now: () => Date.now(),
      storage: browserStorage(),
      onExpire: () => void signOut("expired"),
    });
  }

  useEffect(() => {
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

  // Compteur d'inactivité : actif seulement quand quelqu'un est connecté.
  useEffect(() => {
    const tracker = trackerRef.current;
    if (!session || !tracker) return;
    const stop = tracker.start();
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last > 5_000) {
        last = now;
        tracker.touch();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && tracker.isExpired()) void signOut("expired");
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session, signOut]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      signOut,
      markActive: () => trackerRef.current?.touch(),
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
