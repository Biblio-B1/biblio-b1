import { describe, expect, it } from "vitest";
import { parseEnv, validateEnv } from "@/server/env";

const good = { ADMIN_INVITE_CODE: "secret-code" };

describe("parseEnv", () => {
  it("accepte les défauts hors production", () => {
    expect(parseEnv({}).PORT).toBe(3000);
    expect(parseEnv({ NODE_ENV: "development" }).ADMIN_INVITE_CODE).toBe("");
    expect(parseEnv({}).APP_URL).toBeUndefined();
  });

  it("SESSION_SECRET est réservé : la valeur par défaut est acceptée, même en production", () => {
    expect(parseEnv({ NODE_ENV: "production", ...good, SESSION_SECRET: "dev-insecure-secret-change-me" }).ADMIN_INVITE_CODE).toBe("secret-code");
  });

  it("production : refuse un ADMIN_INVITE_CODE vide ou « change-me »", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/ADMIN_INVITE_CODE/);
    expect(() => parseEnv({ NODE_ENV: "production", ADMIN_INVITE_CODE: "change-me" })).toThrow(/Configuration de production refusée/);
  });

  it("production : accepte une configuration correcte", () => {
    expect(parseEnv({ NODE_ENV: "production", ...good }).ADMIN_INVITE_CODE).toBe("secret-code");
  });

  it("APP_URL : URL http(s) sans « / » final", () => {
    expect(parseEnv({ APP_URL: "http://192.168.1.20:3000" }).APP_URL).toBe("http://192.168.1.20:3000");
    expect(parseEnv({ APP_URL: "" }).APP_URL).toBeUndefined();
    expect(() => parseEnv({ APP_URL: "http://192.168.1.20:3000/" })).toThrow(/APP_URL/);
    expect(() => parseEnv({ APP_URL: "pas une url" })).toThrow(/APP_URL/);
    expect(() => parseEnv({ APP_URL: "ftp://x.fr" })).toThrow(/APP_URL/);
  });

  it("valeur invalide : message en français", () => {
    expect(() => parseEnv({ PORT: "abc" })).toThrow(/Configuration invalide : PORT/);
  });
});

describe("validateEnv (démarrage)", () => {
  it("lève l'erreur française de parseEnv pour l'environnement donné", () => {
    expect(() => validateEnv({ NODE_ENV: "production", ADMIN_INVITE_CODE: "change-me" })).toThrow(/ADMIN_INVITE_CODE/);
    expect(validateEnv({ NODE_ENV: "production", ...good }).PORT).toBe(3000);
  });
});
