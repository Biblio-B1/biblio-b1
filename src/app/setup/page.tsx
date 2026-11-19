import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/ActionForm";
import { getDb } from "@/server/db/client";
import { setupAvailable } from "@/server/auth/invites";
import { setupAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Installation — Biblio B1" };

export default function SetupPage() {
  if (!setupAvailable(getDb())) redirect("/login");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Créer le premier administrateur</h1>
      <p className="text-sm text-neutral-500">
        Saisissez le code <code>ADMIN_INVITE_CODE</code> défini dans votre fichier .env.
      </p>
      <ActionForm action={setupAction} submitLabel="Créer l'administrateur">
        <Field label="Code d'administration" name="code" type="password" autoComplete="off" />
        <Field label="E-mail" name="email" type="email" autoComplete="email" />
        <Field label="Pseudo" name="pseudo" autoComplete="nickname" />
        <Field label="Mot de passe (8 caractères min.)" name="password" type="password" autoComplete="new-password" />
      </ActionForm>
    </main>
  );
}
