import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Site exporté en pages statiques (github.io) : aucune server action ni route serveur. Toute écriture
// passe par Supabase, protégée par la RLS (tests/supabase/rls.test.ts).
const SRC_APP = path.resolve(import.meta.dirname, "../src/app");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

const rel = (f: string) => path.relative(SRC_APP, f).split(path.sep).join("/");

describe("export statique", () => {
  it("aucun fichier \"use server\" (server action)", () => {
    const withActions = sourceFiles(SRC_APP).filter((f) => /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(fs.readFileSync(f, "utf8")));
    expect(withActions.map(rel)).toEqual([]);
  });

  it("aucune route serveur (route.ts) ni middleware", () => {
    expect(sourceFiles(SRC_APP).map(rel).filter((r) => /(^|\/)route\.tsx?$/.test(r))).toEqual([]);
    expect(fs.existsSync(path.resolve(SRC_APP, "../middleware.ts"))).toBe(false);
  });

  it("aucune page n'importe le serveur Node (base SQLite, session, env)", () => {
    const offenders = sourceFiles(SRC_APP).filter((f) =>
      /from "@\/server\/(db|auth|env|storage|boostcamp|checks|homeworks|documents|progress|search|threads|uploads)/.test(fs.readFileSync(f, "utf8")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});
