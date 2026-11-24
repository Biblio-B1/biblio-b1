import { describe, expect, it } from "vitest";
import { isStaleBuildError, reloadOnce } from "@/lib/stale-build";

describe("version périmée du site", () => {
  it("reconnaît les échecs de chargement de morceaux", () => {
    expect(isStaleBuildError({ name: "ChunkLoadError", message: "x" })).toBe(true);
    expect(isStaleBuildError({ message: "Loading chunk 8174 failed. (error: https://…/8174.js)" })).toBe(true);
    expect(isStaleBuildError({ message: "Loading CSS chunk app-layout failed" })).toBe(true);
    expect(isStaleBuildError({ message: "Failed to fetch dynamically imported module: https://…" })).toBe(true);
    expect(isStaleBuildError({ message: "Cannot read properties of undefined (reading 'map')" })).toBe(false);
    expect(isStaleBuildError(null)).toBe(false);
  });

  it("ne recharge qu'une fois toutes les 30 s (pas de boucle)", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(reloadOnce(100_000, s)).toBe(true);
    expect(reloadOnce(110_000, s)).toBe(false);
    expect(reloadOnce(131_000, s)).toBe(true);
    expect(reloadOnce(0, null)).toBe(true);
  });
});
