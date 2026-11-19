import { ActionForm, Field } from "@/components/ActionForm";
import { AuthShell } from "@/components/layout/AuthShell";
import { getDb } from "@/server/db/client";
import { INVITE_ERRORS, getInviteStatus } from "@/server/auth/invites";
import { registerAction } from "../../(auth)/actions";

export const metadata = { title: "Invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const status = getInviteStatus(getDb(), token);
  return (
    <AuthShell title="Créer votre compte">
      {status === "valid" ? (
        <ActionForm action={registerAction.bind(null, token)} submitLabel="S'inscrire">
          <Field label="E-mail" name="email" type="email" autoComplete="email" />
          <Field label="Pseudo" name="pseudo" autoComplete="nickname" />
          <Field label="Mot de passe (8 caractères min.)" name="password" type="password" autoComplete="new-password" />
        </ActionForm>
      ) : (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg p-3 text-danger">
          {INVITE_ERRORS[status]}
        </p>
      )}
    </AuthShell>
  );
}
