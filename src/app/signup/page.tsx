"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionForm, Field, type FormState } from "@/components/ActionForm";
import { AuthShell } from "@/components/layout/AuthShell";
import { signupErrorMessage, validateSignup } from "@/lib/auth/signup-form";
import { getSupabase } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();

  async function signup(_prev: FormState, fd: FormData): Promise<FormState> {
    const v = validateSignup({
      email: String(fd.get("email") ?? ""),
      prenom: String(fd.get("prenom") ?? ""),
      nom: String(fd.get("nom") ?? ""),
      password: String(fd.get("password") ?? ""),
      confirm: String(fd.get("confirm") ?? ""),
    });
    if (!v.ok) return { error: v.error };
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signUp({
      email: v.value.email,
      password: v.value.password,
      options: { data: { name: v.value.name } },
    });
    if (error) return { error: signupErrorMessage(error.message) };
    if (!data.session) {
      // Confirmation par e-mail encore active dans Supabase : la personne doit d'abord cliquer le lien.
      return { message: "Demande enregistrée. Confirmez votre adresse e-mail, puis attendez la validation de l'administrateur." };
    }
    void supabase.functions.invoke("notify", { body: { event: "signup" } }).catch(() => undefined);
    router.replace("/pending");
    return null;
  }

  return (
    <AuthShell
      title="Créer un compte"
      intro="Votre demande est envoyée à l'administrateur : vous aurez accès au site dès qu'il l'aura acceptée."
    >
      <ActionForm action={signup} submitLabel="Envoyer la demande">
        <Field label="E-mail" name="email" type="email" autoComplete="email" />
        <Field label="Prénom" name="prenom" autoComplete="given-name" />
        <Field label="Nom" name="nom" autoComplete="family-name" />
        <Field label="Mot de passe (8 caractères min.)" name="password" type="password" autoComplete="new-password" />
        <Field label="Confirmez le mot de passe" name="confirm" type="password" autoComplete="new-password" />
      </ActionForm>
      <p className="text-sm text-ink-2">
        Déjà un compte ?{" "}
        <Link href="/login" className="text-ink underline underline-offset-2">
          Se connecter
        </Link>
      </p>
    </AuthShell>
  );
}
