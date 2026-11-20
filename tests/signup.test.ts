import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/server/db/client";
import { createSession, getUserBySessionToken } from "@/server/auth/session";
import { bootstrapAdmin } from "@/server/auth/invites";
import {
  MAX_PENDING,
  approveUser,
  countPendingUsers,
  listPendingUsers,
  rejectUser,
  requestAccount,
} from "@/server/auth/signup";
import { notifyAdmin } from "@/server/notify";

const TOPIC = "biblio-b1-test-topic-123456";

beforeAll(() => {
  process.env.ADMIN_INVITE_CODE = "code-secret";
  // Lu au premier accès à `env` (mis en cache ensuite) : à définir avant tout appel.
  process.env.NTFY_TOPIC = TOPIC;
  process.env.NTFY_URL = "https://ntfy.example.test";
});

const data = (n: number) => ({ email: `user${n}@example.com`, pseudo: `user${n}`, password: "motdepasse1" });

describe("inscription avec validation", () => {
  it("crée un compte en attente, sans accès même avec une session", async () => {
    const db = createTestDb();
    const r = await requestAccount(db, data(1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ status: "pending", role: "member" });
    expect(countPendingUsers(db)).toBe(1);
    expect(listPendingUsers(db).map((u) => u.email)).toEqual(["user1@example.com"]);

    const { token } = createSession(db, r.value.id);
    expect(getUserBySessionToken(db, token)).toBeNull();

    expect(approveUser(db, r.value.id)).toBe(true);
    expect(getUserBySessionToken(db, token)?.status).toBe("active");
    expect(countPendingUsers(db)).toBe(0);
    expect(approveUser(db, r.value.id)).toBe(false); // déjà actif
  });

  it("refuser supprime la demande, jamais un compte actif", async () => {
    const db = createTestDb();
    const admin = await bootstrapAdmin(db, "code-secret", data(0));
    if (!admin.ok) throw new Error("bootstrap");
    const r = await requestAccount(db, data(2));
    if (!r.ok) throw new Error("demande");
    expect(rejectUser(db, admin.value.id)).toBe(false);
    expect(rejectUser(db, r.value.id)).toBe(true);
    expect(listPendingUsers(db)).toEqual([]);
    // Une fois refusé, l'e-mail est de nouveau disponible.
    expect((await requestAccount(db, data(2))).ok).toBe(true);
  });

  it("e-mail ou pseudo déjà pris (y compris par une demande en attente)", async () => {
    const db = createTestDb();
    await requestAccount(db, data(3));
    expect(await requestAccount(db, data(3))).toEqual({ ok: false, error: "email_taken" });
    expect(await requestAccount(db, { ...data(4), pseudo: "USER3" })).toEqual({ ok: false, error: "name_taken" });
  });

  it(`au plus ${MAX_PENDING} demandes en attente`, async () => {
    const db = createTestDb();
    for (let i = 0; i < MAX_PENDING; i++) {
      db.$client
        .prepare("insert into users (id, name, email, password_hash, role, status) values (?, ?, ?, 'x', 'member', 'pending')")
        .run(crypto.randomUUID(), `p${i}`, `p${i}@example.com`);
    }
    expect(await requestAccount(db, data(5))).toEqual({ ok: false, error: "too_many_pending" });
  });
});

describe("notification ntfy", () => {
  it("publie en JSON sur le topic configuré", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const ok = await notifyAdmin(
      { title: "Biblio B1 : nouvelle demande", message: "élève demande un accès", click: "https://x.test/admin/users" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ntfy.example.test");
    expect(JSON.parse(String(init.body))).toMatchObject({
      topic: TOPIC,
      title: "Biblio B1 : nouvelle demande",
      message: "élève demande un accès",
      click: "https://x.test/admin/users",
    });
  });

  it("un échec réseau ne lève pas d'erreur", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new Error("réseau indisponible");
    });
    expect(await notifyAdmin({ title: "t", message: "m" }, fetchImpl as unknown as typeof fetch)).toBe(false);
    warn.mockRestore();
  });
});
