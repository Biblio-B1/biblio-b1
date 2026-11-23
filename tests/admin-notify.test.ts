import { describe, expect, it } from "vitest";
import { newRequests } from "@/lib/admin-notify";

describe("newRequests", () => {
  const list = [{ id: "a" }, { id: "b" }];
  it("signale seulement les demandes jamais vues", () => {
    expect(newRequests(list, ["a"])).toEqual([{ id: "b" }]);
    expect(newRequests(list, ["a", "b"])).toEqual([]);
  });
  it("premier passage sur ce navigateur : aucune notification (la bannière montre l'existant)", () => {
    expect(newRequests(list, null)).toEqual([]);
  });
});
