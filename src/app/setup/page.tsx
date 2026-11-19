import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/ActionForm";
import { AuthShell } from "@/components/layout/AuthShell";
import { getDb } from "@/server/db/client";
import { setupAvailable } from "@/server/auth/invites";
import { setupAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Installation" };

export default function SetupPage() {
  if (!setupAvailable(getDb())) redirect("/login");
  return (
    <AuthShell
      title="Créer le premier administrateur"
      intro={
        <>
          Saisissez le code <code className="font-mono text-[13px]">ADMIN_INVITE_CODE</code> défini dans votre fichier .env.
        </>
      }
    >
      <ActionForm action={setupAction} submitLabel="Créer l'administrateur">
        <Field label="Code d'administration" name="code" type="password" autoComplete="off" />
        <Field label="E-mail" name="email" type="email" autoComplete="email" />
        <Field label="Pseudo" name="pseudo" autoComplete="nickname" />
        <Field label="Mot de passe (8 caractères min.)" name="password" type="password" autoComplete="new-password" />
      </ActionForm>
    </AuthShell>
  );
}
