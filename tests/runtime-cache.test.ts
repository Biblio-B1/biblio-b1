import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBrowserEngine } from "@/lib/runners/browser";
import { RUNTIME_VERSIONS, runtimePath } from "@/lib/runners/runtime-versions";

const installed = (pkg: string) =>
  JSON.parse(fs.readFileSync(path.resolve("node_modules", ...pkg.split("/"), "package.json"), "utf8")).version as string;

describe("moteurs WASM : chemins versionnés et cache", () => {
  it("les versions de runtime-versions.ts sont celles installées", () => {
    expect(RUNTIME_VERSIONS.clang).toBe(installed("@yowasp/clang"));
    expect(RUNTIME_VERSIONS.pyodide).toBe(installed("pyodide"));
  });

  it("runtimePath met la version dans le chemin", () => {
    expect(runtimePath("clang")).toBe(`/runtimes/clang/${RUNTIME_VERSIONS.clang}`);
    expect(runtimePath("pyodide", "/x/")).toBe(`/x/pyodide/${RUNTIME_VERSIONS.pyodide}`);
    expect(createBrowserEngine).toBeTypeOf("function");
  });

  it("copy-runtimes copie dans public/runtimes/<moteur>/<version>/", () => {
    const src = fs.readFileSync(path.resolve("scripts/copy-runtimes.mjs"), "utf8");
    expect(src).toMatch(/RUNTIME_VERSIONS/);
    expect(src).toMatch(/path\.join\(base, version\)/);
  });

  // GitHub Pages n'accepte pas d'en-têtes personnalisés : le cache repose sur les chemins versionnés.
});
