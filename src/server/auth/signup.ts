// Inscription libre avec validation par un administrateur : le compte est créé « en attente »
// (status = pending), ne peut pas se connecter, et l'administrateur l'approuve ou le refuse.
// Les invitations (invites.ts) restent possibles et donnent un compte actif directement.
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { registrationSchema, type RegistrationData, type Result } from "./invites";
import { hashPassword } from "./password";
import type { User } from "./session";

/** Garde-fou contre l'inscription en masse (site exposé sur Internet). */
export const MAX_PENDING = 50;

export type SignupError = "email_taken" | "name_taken" | "too_many_pending";

export const SIGNUP_ERRORS: Record<SignupError, string> = {
  email_taken: "Un compte existe déjà avec cette adresse e-mail.",
  name_taken: "Ce pseudo est déjà pris.",
  too_many_pending: "Trop de demandes sont déjà en attente. Réessayez plus tard.",
};

export type PendingUser = Pick<User, "id" | "name" | "email" | "createdAt">;

/** Lève une ZodError si les données sont invalides (à valider en amont pour un message propre). */
export async function requestAccount(db: Db, input: RegistrationData): Promise<Result<User, SignupError>> {
  const data = registrationSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  return db.transaction((tx): Result<User, SignupError> => {
    if (tx.select({ id: users.id }).from(users).where(eq(users.email, data.email)).get()) {
      return { ok: false, error: "email_taken" };
    }
    if (tx.select({ id: users.id }).from(users).where(sql`lower(${users.name}) = lower(${data.pseudo})`).get()) {
      return { ok: false, error: "name_taken" };
    }
    if (countPendingUsers(tx) >= MAX_PENDING) return { ok: false, error: "too_many_pending" };
    const user = tx
      .insert(users)
      .values({ name: data.pseudo, email: data.email, passwordHash, role: "member", status: "pending" })
      .returning()
      .get();
    return { ok: true, value: user };
  });
}

export function countPendingUsers(db: Pick<Db, "select">): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.status, "pending"))
      .get()?.n ?? 0
  );
}

export function listPendingUsers(db: Db): PendingUser[] {
  return db
    .select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.status, "pending"))
    .orderBy(asc(users.createdAt))
    .all();
}

/** Active un compte en attente. Renvoie false s'il n'existe pas ou n'est plus en attente. */
export function approveUser(db: Db, id: string): boolean {
  return (
    db
      .update(users)
      .set({ status: "active" })
      .where(and(eq(users.id, id), eq(users.status, "pending")))
      .run().changes > 0
  );
}

/** Refuse une demande : le compte en attente est supprimé (jamais un compte actif). */
export function rejectUser(db: Db, id: string): boolean {
  return db.delete(users).where(and(eq(users.id, id), eq(users.status, "pending"))).run().changes > 0;
}
