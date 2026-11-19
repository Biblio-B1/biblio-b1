import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Le middleware ne vérifie que la présence du cookie et un layout peut être
// sauté lors d'une navigation RSC : chaque page (et generateMetadata qui lit
// la base) du groupe (app) doit valider la session elle-même.
const APP_DIR = path.resolve(import.meta.dirname, "../src/app/(app)");

function pages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return pages(p);
    return e.name === "page.tsx" ? [p] : [];
  });
}

describe("pages authentifiées", () => {
  const files = pages(APP_DIR);

  it("trouve les pages du groupe (app)", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files.map((f) => [path.relative(APP_DIR, f), f]))("%s appelle requireUser()", (_rel, file) => {
    const src = fs.readFileSync(file, "utf8");
    const exported = src.match(/export (default )?async function \w+/g) ?? [];
    const calls = src.match(/await requireUser\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // une vérification par fonction exportée (page + generateMetadata)
    expect(calls.length).toBeGreaterThanOrEqual(exported.length);
  });
});
