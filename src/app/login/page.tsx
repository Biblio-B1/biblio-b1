import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/ActionForm";
import { getCurrentUser } from "@/server/auth/session";
import { loginAction } from "../(auth)/actions";

export const metadata = { title: "Connexion — Biblio B1" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Connexion</h1>
      <ActionForm action={loginAction} submitLabel="Se connecter">
        <Field label="E-mail ou pseudo" name="identifier" autoComplete="username" />
        <Field label="Mot de passe" name="password" type="password" autoComplete="current-password" />
      </ActionForm>
      <p className="text-sm text-neutral-500">
        L&apos;inscription se fait uniquement sur invitation.
      </p>
    </main>
  );
}
