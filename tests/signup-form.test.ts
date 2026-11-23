import { describe, expect, it } from "vitest";
import { validateSignup } from "@/lib/auth/signup-form";

const ok = {
  email: "  Lea@Example.com ",
  prenom: "Léa",
  nom: "Martin",
  password: "motdepasse1",
  confirm: "motdepasse1",
};

describe("validateSignup", () => {
  it("cas valide : e-mail en minuscules, nom complet « Prénom Nom »", () => {
    expect(validateSignup(ok)).toEqual({
      ok: true,
      value: {
        email: "lea@example.com",
        prenom: "Léa",
        nom: "Martin",
        name: "Léa Martin",
        password: "motdepasse1",
      },
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

  it("prénom avec @ refusé", () => {
    const r = validateSignup({ ...ok, prenom: "a@b" });
    expect(!r.ok && r.error).toMatch(/prénom.*@/);
  });

  it("nom avec @ refusé", () => {
    const r = validateSignup({ ...ok, nom: "a@b" });
    expect(!r.ok && r.error).toMatch(/nom.*@/);
  });

  it("prénom ou nom manquant", () => {
    expect(validateSignup({ ...ok, prenom: "  " }).ok).toBe(false);
    expect(validateSignup({ ...ok, nom: "" }).ok).toBe(false);
  });

  it("prénom ou nom trop long", () => {
    expect(validateSignup({ ...ok, prenom: "x".repeat(41) }).ok).toBe(false);
    expect(validateSignup({ ...ok, nom: "x".repeat(41) }).ok).toBe(false);
  });

  it("nom complet trop long pour profiles.name (40 caractères)", () => {
    const r = validateSignup({ ...ok, prenom: "Alexandre", nom: "x".repeat(35) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/nom complet est trop long/);
  });

  it("e-mail invalide", () => {
    const r = validateSignup({ ...ok, email: "pas-un-email" });
    expect(!r.ok && r.error).toMatch(/e-mail/i);
  });
});
