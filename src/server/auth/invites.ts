import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../env";
import type { Db } from "../db/client";
import { invites, users } from "../db/schema";
import { hashPassword } from "./password";
import type { User } from "./session";

export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };

export const registrationSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide.")),
  pseudo: z
    .string()
    .trim()
    .min(2, "Le pseudo doit contenir au moins 2 caractères.")
    .max(40, "Le pseudo est trop long (40 caractères max)."),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
    .max(200, "Le mot de passe est trop long."),
});
export type RegistrationData = z.input<typeof registrationSchema>;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function createInvite(
  db: Db,
  opts: { createdBy: string | null; maxUses?: number; expiresInDays?: number },
): { token: string; id: string } {
  const { createdBy, maxUses = 1, expiresInDays = 7 } = opts;
  const token = randomBytes(32).toString("base64url");
  const row = db
    .insert(invites)
    .values({
      tokenHash: sha256(token),
      maxUses,
      createdBy,
      expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
    })
    .returning({ id: invites.id })
    .get();
  return { token, id: row.id };
}

export function revokeInvite(db: Db, id: string): void {
  db.update(invites).set({ revoked: true }).where(eq(invites.id, id)).run();
}

export type InviteStatus = "valid" | "invalid" | "expired" | "exhausted" | "revoked";

function statusOf(inv: typeof invites.$inferSelect | undefined): InviteStatus {
  if (!inv) return "invalid";
  if (inv.revoked) return "revoked";
  if (inv.expiresAt && inv.expiresAt.getTime() <= Date.now()) return "expired";
  if (inv.uses >= inv.maxUses) return "exhausted";
  return "valid";
}

export function getInviteStatus(db: Db, token: string): InviteStatus {
  return statusOf(db.select().from(invites).where(eq(invites.tokenHash, sha256(token))).get());
}

export function listInvites(db: Db) {
  return db.select().from(invites).orderBy(sql`${invites.createdAt} desc`).all();
}

export type InviteError = "invalid" | "expired" | "exhausted" | "revoked" | "email_taken";

/** Lève une ZodError si les données sont invalides (à valider en amont pour un message propre). */
export async function consumeInvite(
  db: Db,
  token: string,
  input: RegistrationData,
): Promise<Result<User, InviteError>> {
  const data = registrationSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  const tokenHash = sha256(token);

  return db.transaction((tx): Result<User, InviteError> => {
    const inv = tx.select().from(invites).where(eq(invites.tokenHash, tokenHash)).get();
    const status = statusOf(inv);
    if (status !== "valid" || !inv) return { ok: false, error: status as InviteError };
    if (tx.select({ id: users.id }).from(users).where(eq(users.email, data.email)).get()) {
      return { ok: false, error: "email_taken" };
    }
    // Incrément conditionnel : garde-fou contre une double consommation concurrente.
    const upd = tx
      .update(invites)
      .set({ uses: sql`${invites.uses} + 1` })
      .where(sql`${invites.id} = ${inv.id} AND ${invites.uses} < ${invites.maxUses}`)
      .run();
    if (upd.changes === 0) return { ok: false, error: "exhausted" };
    const user = tx
      .insert(users)
      .values({ name: data.pseudo, email: data.email, passwordHash, role: "member" })
      .returning()
      .get();
    return { ok: true, value: user };
  });
}

export type BootstrapError = "bad_code" | "already_setup" | "email_taken";

export function setupAvailable(db: Db): boolean {
  return !db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).get();
}

function codeMatches(code: string): boolean {
  const expected = env.ADMIN_INVITE_CODE;
  if (!expected) return false; // aucun code configuré : bootstrap désactivé
  const a = createHash("sha256").update(code).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function bootstrapAdmin(
  db: Db,
  code: string,
  input: RegistrationData,
): Promise<Result<User, BootstrapError>> {
  if (!codeMatches(code)) return { ok: false, error: "bad_code" };
  const data = registrationSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  return db.transaction((tx): Result<User, BootstrapError> => {
    if (tx.select({ id: users.id }).from(users).where(eq(users.role, "admin")).get()) {
      return { ok: false, error: "already_setup" };
    }
    if (tx.select({ id: users.id }).from(users).where(eq(users.email, data.email)).get()) {
      return { ok: false, error: "email_taken" };
    }
    const user = tx
      .insert(users)
      .values({ name: data.pseudo, email: data.email, passwordHash, role: "admin" })
      .returning()
      .get();
    return { ok: true, value: user };
  });
}
