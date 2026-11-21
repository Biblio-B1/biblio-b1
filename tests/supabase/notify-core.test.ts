import { describe, expect, it, vi } from "vitest";
import { buildNotification, publishNtfy } from "../../supabase/functions/_shared/notify-core";

describe("buildNotification", () => {
  it("connexion : nom de la personne dans le titre", () => {
    expect(buildNotification("login", "Léa")).toMatchObject({ title: "Biblio B1 : Léa s'est connecté" });
  });

  it("inscription : demande de compte avec le pseudo", () => {
    const n = buildNotification("signup", "Léa");
    expect(n.title).toBe("Biblio B1 : nouvelle demande de compte");
    expect(n.message).toContain("Léa");
  });
});

describe("publishNtfy", () => {
  const n = buildNotification("login", "Léa");

  it("sans topic : rien n'est envoyé", async () => {
    const fetchImpl = vi.fn();
    expect(await publishNtfy(n, { url: "https://ntfy.sh", fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("publie en JSON sur le topic, avec le lien de la page", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const ok = await publishNtfy(
      { ...n, click: "https://biblio-b1.github.io/biblio-b1/admin/users/" },
      { topic: "biblio-b1-abcdef0123456789", url: "https://ntfy.sh", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ntfy.sh");
    expect(JSON.parse(String(init.body))).toMatchObject({
      topic: "biblio-b1-abcdef0123456789",
      title: "Biblio B1 : Léa s'est connecté",
      click: "https://biblio-b1.github.io/biblio-b1/admin/users/",
    });
  });

  it("ntfy injoignable : renvoie false sans lever d'erreur", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("réseau indisponible");
    });
    await expect(
      publishNtfy(n, { topic: "biblio-b1-abcdef0123456789", url: "https://ntfy.sh", fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBe(false);
  });
});
