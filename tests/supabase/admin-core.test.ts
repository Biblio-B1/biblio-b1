import { describe, expect, it } from "vitest";
import { canDeleteSelf, canReject } from "../../supabase/functions/_shared/admin-core";

describe("canReject", () => {
  it("un administrateur actif peut refuser une demande en attente", () => {
    expect(canReject({ role: "admin", status: "active" }, { status: "pending" })).toBe(true);
  });

  it("un membre ne peut pas refuser", () => {
    expect(canReject({ role: "member", status: "active" }, { status: "pending" })).toBe(false);
  });

  it("un administrateur en attente ne peut pas refuser", () => {
    expect(canReject({ role: "admin", status: "pending" }, { status: "pending" })).toBe(false);
  });

  it("on ne supprime jamais un compte actif par ce biais", () => {
    expect(canReject({ role: "admin", status: "active" }, { status: "active" })).toBe(false);
  });

  it("cible introuvable : refusé", () => {
    expect(canReject({ role: "admin", status: "active" }, null)).toBe(false);
  });
});

describe("canDeleteSelf", () => {
  it("un membre ou un compte en attente peut supprimer son compte", () => {
    expect(canDeleteSelf({ role: "member", status: "active" }, 1)).toBe(true);
    expect(canDeleteSelf({ role: "member", status: "pending" }, 1)).toBe(true);
  });
  it("le dernier administrateur actif ne peut pas ; s'il en reste un autre, oui", () => {
    expect(canDeleteSelf({ role: "admin", status: "active" }, 1)).toBe(false);
    expect(canDeleteSelf({ role: "admin", status: "active" }, 2)).toBe(true);
  });
  it("profil introuvable : non", () => {
    expect(canDeleteSelf(null, 2)).toBe(false);
  });
});
