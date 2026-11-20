import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/ActionForm";
import { AuthShell } from "@/components/layout/AuthShell";
import { getCurrentUser } from "@/server/auth/session";
import { signupAction } from "../(auth)/actions";

export const metadata = { title: "Créer un compte" };

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <AuthShell
      title="Créer un compte"
      intro="Votre demande est envoyée à l'administrateur : vous pourrez vous connecter dès qu'il l'aura acceptée."
    >
      <ActionForm action={signupAction} submitLabel="Envoyer la demande">
        <Field label="E-mail" name="email" type="email" autoComplete="email" />
        <Field label="Pseudo" name="pseudo" autoComplete="nickname" />
        <Field label="Mot de passe (8 caractères min.)" name="password" type="password" autoComplete="new-password" />
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
