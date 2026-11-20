import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env";

const good = { SESSION_SECRET: "a".repeat(64), ADMIN_INVITE_CODE: "secret-code" };

describe("parseEnv", () => {
  it("accepte les défauts hors production", () => {
    expect(parseEnv({}).PORT).toBe(3000);
    expect(parseEnv({ NODE_ENV: "development" }).ADMIN_INVITE_CODE).toBe("");
  });

  it("production : refuse un SESSION_SECRET par défaut ou vide", () => {
    expect(() => parseEnv({ NODE_ENV: "production", ADMIN_INVITE_CODE: "x1" })).toThrow(/SESSION_SECRET/);
    expect(() => parseEnv({ NODE_ENV: "production", ADMIN_INVITE_CODE: "x1", SESSION_SECRET: "" })).toThrow(/SESSION_SECRET/);
    expect(() => parseEnv({ NODE_ENV: "production", ADMIN_INVITE_CODE: "x1", SESSION_SECRET: "dev-insecure-secret-change-me" })).toThrow(/SESSION_SECRET/);
  });

  it("production : refuse un ADMIN_INVITE_CODE vide ou « change-me »", () => {
    expect(() => parseEnv({ NODE_ENV: "production", SESSION_SECRET: good.SESSION_SECRET })).toThrow(/ADMIN_INVITE_CODE/);
    expect(() => parseEnv({ NODE_ENV: "production", ...good, ADMIN_INVITE_CODE: "change-me" })).toThrow(/ADMIN_INVITE_CODE/);
  });

  it("production : accepte une configuration correcte", () => {
    expect(parseEnv({ NODE_ENV: "production", ...good }).ADMIN_INVITE_CODE).toBe("secret-code");
  });
});
