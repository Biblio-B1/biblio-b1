"use server";

import { eq, or } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { verifyPassword, hashPassword } from "@/server/auth/password";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  deleteSession,
  requireUser,
  setSessionCookie,
} from "@/server/auth/session";
import {
  bootstrapAdmin,
  consumeInvite,
  createInvite,
  registrationSchema,
  revokeInvite,
} from "@/server/auth/invites";

type State = { error?: string; message?: string; link?: string } | null;

const INVITE_ERRORS = {
  invalid: "Ce lien d'invitation n'est pas valide.",
  expired: "Ce lien d'invitation a expiré.",
  exhausted: "Ce lien d'invitation a déjà été utilisé.",
  revoked: "Ce lien d'invitation a été révoqué.",
  email_taken: "Un compte existe déjà avec cette adresse e-mail.",
} as const;

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Données invalides.";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

// Hash factice : égalise le temps de réponse quand l'utilisateur n'existe pas.
let dummyHash: Promise<string> | undefined;

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Saisissez votre e-mail ou pseudo."),
  password: z.string().min(1, "Saisissez votre mot de passe."),
});

export async function loginAction(_prev: State, fd: FormData): Promise<State> {
  const parsed = loginSchema.safeParse({
    identifier: str(fd, "identifier"),
    password: str(fd, "password"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { identifier, password } = parsed.data;
  const db = getDb();
  const user = db
    .select()
    .from(users)
    .where(or(eq(users.email, identifier.toLowerCase()), eq(users.name, identifier)))
    .limit(1)
    .get();
  const hash = user?.passwordHash ?? (await (dummyHash ??= hashPassword("dummy-password")));
  const ok = await verifyPassword(hash, password);
  if (!user || !ok) return { error: "Identifiants incorrects." };
  const { token, expiresAt } = createSession(db, user.id);
  await setSessionCookie(token, expiresAt);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) deleteSession(getDb(), token);
  await clearSessionCookie();
  redirect("/login");
}

function registrationInput(fd: FormData) {
  return registrationSchema.safeParse({
    email: str(fd, "email"),
    pseudo: str(fd, "pseudo"),
    password: str(fd, "password"),
  });
}

export async function registerAction(token: string, _prev: State, fd: FormData): Promise<State> {
  const parsed = registrationInput(fd);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const db = getDb();
  const res = await consumeInvite(db, token, parsed.data);
  if (!res.ok) return { error: INVITE_ERRORS[res.error] };
  const session = createSession(db, res.value.id);
  await setSessionCookie(session.token, session.expiresAt);
  redirect("/");
}

export async function setupAction(_prev: State, fd: FormData): Promise<State> {
  const parsed = registrationInput(fd);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const db = getDb();
  const res = await bootstrapAdmin(db, str(fd, "code"), parsed.data);
  if (!res.ok) {
    return {
      error: {
        bad_code: "Code d'administration incorrect.",
        already_setup: "L'installation est déjà terminée.",
        email_taken: INVITE_ERRORS.email_taken,
      }[res.error],
    };
  }
  const session = createSession(db, res.value.id);
  await setSessionCookie(session.token, session.expiresAt);
  redirect("/");
}

const createInviteSchema = z.object({
  maxUses: z.coerce.number().int().min(1, "Au moins 1 utilisation.").max(1000, "1000 utilisations max."),
  expiresInDays: z.coerce.number().int().min(1, "Au moins 1 jour.").max(365, "365 jours max."),
});

export async function createInviteAction(_prev: State, fd: FormData): Promise<State> {
  const admin = await requireUser("admin");
  const parsed = createInviteSchema.safeParse({
    maxUses: str(fd, "maxUses"),
    expiresInDays: str(fd, "expiresInDays"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { token } = createInvite(getDb(), { createdBy: admin.id, ...parsed.data });
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  revalidatePath("/admin/invites");
  return {
    message: "Invitation créée. Copiez le lien maintenant, il ne sera plus affiché.",
    link: `${proto}://${host}/invite/${token}`,
  };
}

export async function revokeInviteAction(fd: FormData): Promise<void> {
  await requireUser("admin");
  const id = z.string().min(1).safeParse(fd.get("id"));
  if (!id.success) return;
  revokeInvite(getDb(), id.data);
  revalidatePath("/admin/invites");
}
