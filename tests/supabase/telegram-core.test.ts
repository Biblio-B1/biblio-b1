import { describe, expect, it, vi } from "vitest";
import { buildTelegramMessage, isAdminChat, parseDecision, sendTelegram } from "../../supabase/functions/_shared/telegram-core";

const APP = "https://biblio-b1.github.io/biblio-b1";

describe("buildTelegramMessage", () => {
  it("demande de compte : nom, e-mail et boutons Accepter / Refuser liés à l'utilisateur", () => {
    const m = buildTelegramMessage({ event: "signup", name: "Léa Martin", email: "lea@example.com", userId: "u-1", appUrl: APP });
    expect(m.text).toContain("Léa Martin");
    expect(m.text).toContain("lea@example.com");
    expect(m.reply_markup?.inline_keyboard).toEqual([
      [
        { text: "✅ Accepter", callback_data: "approve:u-1" },
        { text: "❌ Refuser", callback_data: "reject:u-1" },
      ],
      [{ text: "Ouvrir les demandes", url: `${APP}/admin/users/` }],
    ]);
  });

  it("connexion : simple message avec le nom, sans boutons", () => {
    const m = buildTelegramMessage({ event: "login", name: "Léa Martin", email: "lea@example.com", userId: "u-1", appUrl: APP });
    expect(m.text).toContain("Léa Martin s'est connecté");
    expect(m.reply_markup).toBeUndefined();
  });

  it("échappe le HTML (nom choisi par l'utilisateur)", () => {
    const m = buildTelegramMessage({ event: "login", name: "<b>x</b>", email: "a@b.c", userId: "u", appUrl: APP });
    expect(m.text).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("parseDecision", () => {
  it("lit approve / reject et l'identifiant", () => {
    expect(parseDecision("approve:0bb7cb7b-0699-4d04-b365-76d6e29b1bd7")).toEqual({ action: "approve", userId: "0bb7cb7b-0699-4d04-b365-76d6e29b1bd7" });
    expect(parseDecision("reject:0bb7cb7b-0699-4d04-b365-76d6e29b1bd7")).toEqual({ action: "reject", userId: "0bb7cb7b-0699-4d04-b365-76d6e29b1bd7" });
  });

  it("refuse tout le reste", () => {
    expect(parseDecision("delete:x")).toBeNull();
    expect(parseDecision("approve:pas-un-uuid")).toBeNull();
    expect(parseDecision(undefined)).toBeNull();
  });
});

describe("isAdminChat", () => {
  it("seule la conversation de l'administrateur peut décider", () => {
    expect(isAdminChat({ message: { chat: { id: 42 } } }, "42")).toBe(true);
    expect(isAdminChat({ message: { chat: { id: 43 } } }, "42")).toBe(false);
    expect(isAdminChat({}, "42")).toBe(false);
    expect(isAdminChat({ message: { chat: { id: 42 } } }, "")).toBe(false);
  });
});

describe("sendTelegram", () => {
  it("appelle sendMessage du bot avec le chat de l'admin, en HTML", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const ok = await sendTelegram({ text: "Bonjour" }, { token: "123:ABC", chatId: "42", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(ok).toEqual({ ok: true, status: 200 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:ABC/sendMessage");
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: "42", text: "Bonjour", parse_mode: "HTML" });
  });

  it("sans configuration ou en cas d'erreur réseau : ne lève pas d'erreur", async () => {
    expect(await sendTelegram({ text: "x" }, { token: "", chatId: "42", fetchImpl: vi.fn() as unknown as typeof fetch })).toEqual({ ok: false, error: "TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID absent" });
    const boom = vi.fn(async () => {
      throw new Error("réseau");
    });
    expect(await sendTelegram({ text: "x" }, { token: "1:A", chatId: "42", fetchImpl: boom as unknown as typeof fetch })).toEqual({ ok: false, error: "réseau" });
  });
});
