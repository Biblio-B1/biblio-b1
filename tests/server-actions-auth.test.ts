import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Une server action est un point d'entrée HTTP public (POST) : chaque fonction exportée d'un
// fichier "use server" doit valider la session elle-même via requireUser().
const SRC_APP = path.resolve(import.meta.dirname, "../src/app");

// Actions publiques documentées (aucune session requise par nature) :
// - loginAction : connexion ;
// - registerAction : inscription via un jeton d'invitation (le jeton est vérifié) ;
// - signupAction : demande de compte libre (compte créé en attente, sans session ni accès) ;
// - setupAction : création du premier admin (code ADMIN_INVITE_CODE, fermée ensuite) ;
// - logoutAction : déconnexion (supprime la session courante, s'il y en a une).
const PUBLIC_ACTIONS = new Set([
  "(auth)/actions.ts#loginAction",
  "(auth)/actions.ts#registerAction",
  "(auth)/actions.ts#signupAction",
  "(auth)/actions.ts#setupAction",
  "(auth)/actions.ts#logoutAction",
]);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

const isUseServerFile = (src: string) => /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(src);

/** Fonctions exportées et leur corps (jusqu'à la déclaration exportée suivante). */
function exportedFunctions(src: string): { name: string; body: string }[] {
  const re = /export\s+(?:default\s+)?async\s+function\s+(\w+)/g;
  const found = [...src.matchAll(re)];
  return found.map((m, i) => ({
    name: m[1],
    body: src.slice(m.index!, i + 1 < found.length ? found[i + 1].index : src.length),
  }));
}

const files = sourceFiles(SRC_APP).filter((f) => isUseServerFile(fs.readFileSync(f, "utf8")));
const cases = files.flatMap((f) => {
  const rel = path.relative(SRC_APP, f).split(path.sep).join("/");
  return exportedFunctions(fs.readFileSync(f, "utf8")).map((fn) => ({ id: `${rel}#${fn.name}`, body: fn.body }));
});

describe("server actions authentifiées", () => {
  // Passage à github.io : les server actions disparaissent au fil de la conversion (plus aucune à
  // la fin). Les fichiers restants sont tous contrôlés ci-dessous.
  it("chaque fichier \"use server\" restant exporte des actions détectées", () => {
    for (const f of files) {
      const rel = path.relative(SRC_APP, f).split(path.sep).join("/");
      expect(cases.some((c) => c.id.startsWith(`${rel}#`)), rel).toBe(true);
    }
  });

  it("la liste blanche ne contient que des actions existantes", () => {
    for (const id of PUBLIC_ACTIONS) expect(cases.map((c) => c.id)).toContain(id);
  });

  it("aucun export \"use server\" non-fonction async (const/flèche) qui échapperait au contrôle", () => {
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      expect(src.match(/export\s+(const|let|var)\s+\w+/g) ?? [], path.relative(SRC_APP, f)).toEqual([]);
    }
  });

  it.each(cases.filter((c) => !PUBLIC_ACTIONS.has(c.id)).map((c) => [c.id, c.body]))("%s appelle requireUser()", (_id, body) => {
    expect(body).toMatch(/await requireUser\(/);
  });
});
