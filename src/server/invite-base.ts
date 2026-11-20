import { headers } from "next/headers";
import { env } from "./env";
import { inviteBaseUrl } from "./invite-link";

/** Base des liens d'invitation pour la requête courante (APP_URL, sinon en-têtes Host). */
export async function currentInviteBase(): Promise<{ base: string; local: boolean }> {
  const h = await headers();
  return inviteBaseUrl({
    appUrl: env.APP_URL,
    host: h.get("host"),
    forwardedHost: h.get("x-forwarded-host"),
    forwardedProto: h.get("x-forwarded-proto"),
  });
}
