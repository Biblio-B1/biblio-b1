import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/server/db/client";
import { invites, sessions, users } from "@/server/db/schema";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, getUserBySessionToken } from "@/server/auth/session";
import {
  bootstrapAdmin,
  consumeInvite,
  createInvite,
  registrationSchema,
  revokeInvite,
} from "@/server/auth/invites";

beforeAll(() => {
  process.env.ADMIN_INVITE_CODE = "code-secret";
});

const data = (n = 1) => ({
  email: `user${n}@example.com`,
  pseudo: `user${n}`,
  password: "motdepasse1",
});

async function adminOf(db: ReturnType<typeof createTestDb>) {
  const r = await bootstrapAdmin(db, "code-secret", data(0));
  if (!r.ok) throw new Error("bootstrap");
  return r.value;
}

describe("mots de passe", () => {
  it("hash et vérifie", async () => {
    const h = await hashPassword("motdepasse1");
    expect(h).not.toContain("motdepasse1");
    expect(await verifyPassword(h, "motdepasse1")).toBe(true);
    expect(await verifyPassword(h, "autre")).toBe(false);
  });
});

describe("sessions", () => {
  it("crée une session de 30 jours et retrouve l'utilisateur", async () => {
    const db = createTestDb();
    const admin = await adminOf(db);
    const { token, expiresAt } = createSession(db, admin.id);
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(getUserBySessionToken(db, token)?.id).toBe(admin.id);
    expect(getUserBySessionToken(db, "faux")).toBeNull();
    // le jeton n'est pas stocké en clair
    expect(db.select().from(sessions).all()[0].id).not.toBe(token);
  });
  it("refuse une session expirée", async () => {
    const db = createTestDb();
    const admin = await adminOf(db);
    const { token } = createSession(db, admin.id);
    db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).run();
    expect(getUserBySessionToken(db, token)).toBeNull();
  });
});

describe("invitations", () => {
  it("maxUses=1 : consommée une fois, puis épuisée", async () => {
    const db = createTestDb();
    const admin = await adminOf(db);
    const { token } = createInvite(db, { createdBy: admin.id });
    const r = await consumeInvite(db, token, data(1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.role).toBe("member");
    const r2 = await consumeInvite(db, token, data(2));
    expect(r2).toEqual({ ok: false, error: "exhausted" });
    expect(db.select().from(users).all()).toHaveLength(2); // admin + 1
  });
  it("le jeton est stocké haché", () => {
    const db = createTestDb();
    const { token } = createInvite(db, { createdBy: null });
    expect(db.select().from(invites).all()[0].tokenHash).not.toBe(token);
  });
  it("jeton inconnu → invalid", async () => {
    const db = createTestDb();
    expect(await consumeInvite(db, "nope", data())).toEqual({ ok: false, error: "invalid" });
  });
  it("expirée → expired, aucun compte", async () => {
    const db = createTestDb();
    const { token, id } = createInvite(db, { createdBy: null });
    db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, id)).run();
    expect(await consumeInvite(db, token, data())).toEqual({ ok: false, error: "expired" });
    expect(db.select().from(users).all()).toHaveLength(0);
  });
  it("révoquée → revoked", async () => {
    const db = createTestDb();
    const { token, id } = createInvite(db, { createdBy: null });
    revokeInvite(db, id);
    expect(await consumeInvite(db, token, data())).toEqual({ ok: false, error: "revoked" });
    expect(db.select().from(users).all()).toHaveLength(0);
  });
  it("email déjà pris → email_taken, usage non consommé", async () => {
    const db = createTestDb();
    const { token } = createInvite(db, { createdBy: null, maxUses: 2 });
    await consumeInvite(db, token, data(1));
    const r = await consumeInvite(db, token, { ...data(2), email: "USER1@example.com" });
    expect(r).toEqual({ ok: false, error: "email_taken" });
    expect(db.select().from(invites).all()[0].uses).toBe(1);
  });
  it("maxUses=3 autorise 3 usages", async () => {
    const db = createTestDb();
    const { token } = createInvite(db, { createdBy: null, maxUses: 3 });
    for (let i = 1; i <= 3; i++) expect((await consumeInvite(db, token, data(i))).ok).toBe(true);
    expect(await consumeInvite(db, token, data(4))).toEqual({ ok: false, error: "exhausted" });
  });
  it("mot de passe < 8 caractères → erreur zod", async () => {
    expect(registrationSchema.safeParse({ ...data(), password: "court" }).success).toBe(false);
    const db = createTestDb();
    const { token } = createInvite(db, { createdBy: null });
    await expect(consumeInvite(db, token, { ...data(), password: "court" })).rejects.toThrow();
    expect(db.select().from(users).all()).toHaveLength(0);
  });
});

describe("bootstrapAdmin", () => {
  it("mauvais code → refus", async () => {
    const db = createTestDb();
    expect(await bootstrapAdmin(db, "mauvais", data())).toEqual({ ok: false, error: "bad_code" });
    expect(db.select().from(users).all()).toHaveLength(0);
  });
  it("bon code → admin, second appel → refus", async () => {
    const db = createTestDb();
    const r = await bootstrapAdmin(db, "code-secret", data(1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.role).toBe("admin");
    expect(await bootstrapAdmin(db, "code-secret", data(2))).toEqual({
      ok: false,
      error: "already_setup",
    });
  });
});
