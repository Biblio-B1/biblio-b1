import { ActionForm, Field } from "@/components/ActionForm";
import { getDb } from "@/server/db/client";
import { INVITE_ERRORS, getInviteStatus } from "@/server/auth/invites";
import { registerAction } from "../../(auth)/actions";

export const metadata = { title: "Invitation — Biblio B1" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const status = getInviteStatus(getDb(), token);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Créer votre compte</h1>
      {status === "valid" ? (
        <ActionForm action={registerAction.bind(null, token)} submitLabel="S'inscrire">
          <Field label="E-mail" name="email" type="email" autoComplete="email" />
          <Field label="Pseudo" name="pseudo" autoComplete="nickname" />
          <Field label="Mot de passe (8 caractères min.)" name="password" type="password" autoComplete="new-password" />
        </ActionForm>
      ) : (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">
          {INVITE_ERRORS[status]}
        </p>
      )}
    </main>
  );
}
