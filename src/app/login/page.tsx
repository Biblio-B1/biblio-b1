import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/ActionForm";
import { AuthShell } from "@/components/layout/AuthShell";
import { getDb } from "@/server/db/client";
import { setupAvailable } from "@/server/auth/invites";
import { getCurrentUser } from "@/server/auth/session";
import { loginAction } from "../(auth)/actions";

export const metadata = { title: "Connexion" };

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <AuthShell title="Connexion">
      <ActionForm action={loginAction} submitLabel="Se connecter">
        <Field label="E-mail ou pseudo" name="identifier" autoComplete="username" />
        <Field label="Mot de passe" name="password" type="password" autoComplete="current-password" />
      </ActionForm>
      <p className="text-sm text-ink-2">
        Pas encore de compte ?{" "}
        <Link href="/signup" className="text-ink underline underline-offset-2">
          Créer un compte
        </Link>{" "}
        (validé par l&apos;administrateur).
      </p>
      {setupAvailable(getDb()) && (
        <p className="text-sm text-ink-2">
          Aucun administrateur n&apos;existe encore :{" "}
          <Link href="/setup" className="text-ink underline underline-offset-2">
            terminer l&apos;installation
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
