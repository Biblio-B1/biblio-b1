import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Pages membres (groupe (app)) : la coquille (layout) exige un compte validé via <RequireAuth> ; la
// vraie barrière est la RLS de Supabase. Les pages encore rendues côté serveur (non converties)
// doivent valider la session elles-mêmes avec requireUser().
const APP_DIR = path.resolve(import.meta.dirname, "../src/app/(app)");

function pages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return pages(p);
    return e.name === "page.tsx" ? [p] : [];
  });
}

const isClient = (src: string) => /^\s*["']use client["']/.test(src);

describe("pages membres", () => {
  it("la coquille du groupe (app) exige un compte validé (RequireAuth)", () => {
    const layout = fs.readFileSync(path.join(APP_DIR, "layout.tsx"), "utf8");
    expect(layout).toMatch(/<RequireAuth>/);
  });

  // Conversions encore à faire (plan github.io + Supabase, tâche 8) : la liste doit finir vide.
  const PENDING_CONVERSION: string[] = [];
  it("aucune page à segment dynamique [param] (export statique github.io)", () => {
    const dynamicPages = pages(APP_DIR)
      .map((f) => path.relative(APP_DIR, f).split(path.sep).join("/"))
      .filter((r) => /\[[^\]]+\]/.test(r));
    expect(dynamicPages).toEqual(PENDING_CONVERSION);
  });

  const serverPages = pages(APP_DIR).filter((f) => !isClient(fs.readFileSync(f, "utf8")));
  it.each(serverPages.map((f) => [path.relative(APP_DIR, f), f]))("%s (serveur) appelle requireUser()", (_rel, file) => {
    const src = fs.readFileSync(file, "utf8");
    const exported = src.match(/export (default )?async function \w+/g) ?? [];
    const calls = src.match(/await requireUser\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(Math.max(1, exported.length));
  });

  it("les pages admin passent par <RequireAuth admin> (signalements : <RequireAuth moderator>)", () => {
    for (const f of pages(path.join(APP_DIR, "admin"))) {
      const src = fs.readFileSync(f, "utf8");
      if (isClient(src)) expect(src, f).toMatch(f.includes("reports") ? /<RequireAuth moderator>/ : /<RequireAuth admin>/);
    }
  });
});
