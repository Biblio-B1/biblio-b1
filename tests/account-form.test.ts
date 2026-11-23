import { describe, expect, it } from "vitest";
import { renameErrorMessage, splitName, validatePasswordChange, validateRename } from "@/lib/auth/account-form";

describe("validateRename", () => {
  it("réunit prénom et nom", () => {
    expect(validateRename({ prenom: " Léa ", nom: "Martin" })).toEqual({ ok: true, name: "Léa Martin" });
  });
  it("refuse un champ vide, un « @ » ou un nom complet trop long", () => {
    expect(validateRename({ prenom: "", nom: "Martin" })).toMatchObject({ ok: false });
    expect(validateRename({ prenom: "a@b", nom: "Martin" })).toMatchObject({ ok: false });
    expect(validateRename({ prenom: "A".repeat(25), nom: "B".repeat(20) })).toMatchObject({ ok: false });
  });
});

describe("splitName", () => {
  it("premier mot = prénom, le reste = nom", () => {
    expect(splitName("Léa Martin Dupont")).toEqual({ prenom: "Léa", nom: "Martin Dupont" });
    expect(splitName("Manech")).toEqual({ prenom: "Manech", nom: "" });
  });
});

describe("validatePasswordChange", () => {
  it("accepte un nouveau mot de passe confirmé, différent de l'actuel", () => {
    expect(validatePasswordChange({ current: "ancien123", password: "nouveau123", confirm: "nouveau123" })).toEqual({ ok: true });
  });
  it("refuse : actuel manquant, trop court, confirmation différente, identique à l'actuel", () => {
    expect(validatePasswordChange({ current: "", password: "nouveau123", confirm: "nouveau123" })).toMatchObject({ ok: false });
    expect(validatePasswordChange({ current: "ancien123", password: "court", confirm: "court" })).toMatchObject({ ok: false });
    expect(validatePasswordChange({ current: "ancien123", password: "nouveau123", confirm: "nouveau124" })).toMatchObject({
      ok: false,
      error: "Les deux mots de passe ne correspondent pas.",
    });
    expect(validatePasswordChange({ current: "pareil123", password: "pareil123", confirm: "pareil123" })).toMatchObject({ ok: false });
  });
});

describe("renameErrorMessage", () => {
  it("nom déjà pris", () => {
    expect(renameErrorMessage('duplicate key value violates unique constraint "profiles_name_lower_idx"')).toBe(
      "Ce nom est déjà pris par un autre compte.",
    );
    expect(renameErrorMessage("autre")).toBe("Le nom n'a pas pu être changé. Réessayez plus tard.");
  });
});
