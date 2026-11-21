import { describe, expect, it } from "vitest";
import { validateSignup } from "@/lib/auth/signup-form";

const ok = { email: "  Lea@Example.com ", name: "Léa", password: "motdepasse1", confirm: "motdepasse1" };

describe("validateSignup", () => {
  it("cas valide : e-mail en minuscules, espaces retirés", () => {
    expect(validateSignup(ok)).toEqual({
      ok: true,
      value: { email: "lea@example.com", name: "Léa", password: "motdepasse1" },
    });
  });

  it("mots de passe différents : refusé avec un message clair", () => {
    expect(validateSignup({ ...ok, confirm: "motdepasse2" })).toEqual({
      ok: false,
      error: "Les deux mots de passe ne correspondent pas.",
    });
  });

  it("mot de passe trop court", () => {
    const r = validateSignup({ ...ok, password: "court12", confirm: "court12" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/au moins 8 caractères/);
  });

  it("pseudo avec @ refusé", () => {
    const r = validateSignup({ ...ok, name: "a@b" });
    expect(!r.ok && r.error).toMatch(/@/);
  });

  it("pseudo trop court ou trop long", () => {
    expect(validateSignup({ ...ok, name: "a" }).ok).toBe(false);
    expect(validateSignup({ ...ok, name: "x".repeat(41) }).ok).toBe(false);
  });

  it("e-mail invalide", () => {
    const r = validateSignup({ ...ok, email: "pas-un-email" });
    expect(!r.ok && r.error).toMatch(/e-mail/i);
  });
});
