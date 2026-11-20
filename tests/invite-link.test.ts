import { describe, expect, it } from "vitest";
import { inviteBaseUrl, inviteLink, isLocalHost } from "@/server/invite-link";

describe("liens d'invitation", () => {
  it("APP_URL défini : prioritaire sur l'en-tête Host, jamais signalé comme local", () => {
    const r = inviteBaseUrl({ appUrl: "http://192.168.1.20:3000", host: "localhost:3000" });
    expect(r).toEqual({ base: "http://192.168.1.20:3000", local: false });
    expect(inviteLink("abc", r.base)).toBe("http://192.168.1.20:3000/invite/abc");
  });

  it("sans APP_URL : en-têtes de la requête (x-forwarded-* d'abord)", () => {
    expect(inviteBaseUrl({ host: "192.168.1.20:3000", proto: "http" })).toEqual({ base: "http://192.168.1.20:3000", local: false });
    expect(inviteBaseUrl({ host: "a.fr", forwardedHost: "biblio.exemple.fr", forwardedProto: "https" })).toEqual({
      base: "https://biblio.exemple.fr",
      local: false,
    });
    expect(inviteBaseUrl({ host: "biblio.exemple.fr" }).base).toBe("https://biblio.exemple.fr");
  });

  it("sans APP_URL : adresse locale signalée (localhost, 127.0.0.1, *.linux.test)", () => {
    expect(inviteBaseUrl({ host: "localhost:3000" })).toEqual({ base: "http://localhost:3000", local: true });
    expect(inviteBaseUrl({ host: "127.0.0.1:3000" })).toEqual({ base: "http://127.0.0.1:3000", local: true });
    expect(inviteBaseUrl({ host: "penguin.linux.test:3000" })).toEqual({ base: "http://penguin.linux.test:3000", local: true });
    expect(inviteBaseUrl({})).toEqual({ base: "http://localhost:3000", local: true });
  });

  it("isLocalHost", () => {
    expect(isLocalHost("LOCALHOST")).toBe(true);
    expect(isLocalHost("[::1]:3000")).toBe(true);
    expect(isLocalHost("penguin.linux.test")).toBe(true);
    expect(isLocalHost("192.168.1.20:3000")).toBe(false);
    expect(isLocalHost("linux.test.exemple.fr")).toBe(false);
  });
});
