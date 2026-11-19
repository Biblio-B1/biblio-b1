import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, type Db } from "../db/client";
import { sessions, users } from "../db/schema";

export type User = typeof users.$inferSelect;

export const SESSION_COOKIE = "bb1_session";
const SESSION_DAYS = 30;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function createSession(db: Db, userId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.insert(sessions).values({ id: sha256(token), userId, expiresAt }).run();
  return { token, expiresAt };
}

export function getUserBySessionToken(db: Db, token: string): User | null {
  if (!token) return null;
  const id = sha256(token);
  const row = db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  return row.user;
}

export function deleteSession(db: Db, token: string): void {
  db.delete(sessions).where(eq(sessions.id, sha256(token))).run();
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserBySessionToken(getDb(), token);
}

export async function requireUser(role?: "admin"): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (role && user.role !== role) redirect("/");
  return user;
}
