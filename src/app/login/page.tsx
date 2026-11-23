"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ActionForm, Field, type FormState } from "@/components/ActionForm";
import { useAuth } from "@/components/auth/AuthProvider";
import { AuthShell } from "@/components/layout/AuthShell";
import { getSupabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && session) router.replace("/");
  }, [loading, session, router]);

  async function login(_prev: FormState, fd: FormData): Promise<FormState> {
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    const password = String(fd.get("password") ?? "");
    if (!email || !password) return { error: "Saisissez votre e-mail et votre mot de passe." };
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return {
        error: /invalid login|invalid credentials/i.test(error.message)
          ? "Identifiants incorrects."
          : /rate limit/i.test(error.message)
            ? "Trop de tentatives. Réessayez dans quelques minutes."
            : "Connexion impossible pour le moment.",
      };
    }
    // Notification à l'administrateur ; un échec ne bloque jamais la connexion.
    void supabase.functions.invoke("notify", { body: { event: "login" } }).catch(() => undefined);
    router.replace("/");
    return null;
  }

  return (
    <AuthShell title="Connexion">
      <ActionForm action={login} submitLabel="Se connecter">
        <Field label="E-mail" name="email" type="email" autoComplete="email" />
        <Field label="Mot de passe" name="password" type="password" autoComplete="current-password" />
      </ActionForm>
      <p className="text-sm text-ink-2">
        Pas encore de compte ?{" "}
        <Link href="/signup" className="text-ink underline underline-offset-2">
          Créer un compte
        </Link>{" "}
        (validé par l&apos;administrateur).
      </p>
    </AuthShell>
  );
}
