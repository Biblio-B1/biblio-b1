// Bac à sable du solveur : les solutions de référence (écrites par le modèle, donc
// potentiellement issues d'une injection d'invite) ne doivent pouvoir ni lire les fichiers
// du serveur, ni écrire, ni lancer de processus, ni hériter des secrets de l'environnement.
// Chaque test TENTE réellement l'évasion et vérifie qu'elle échoue.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disposeRunners, runCode, sandboxArgs, sandboxReadPaths } from "@/lib/runners";

const LONG = 60_000;
const DENIED = /ERR_ACCESS_DENIED|Access to this API has been restricted/;
const SECRET = "SECRET-NE-DOIT-PAS-FUIR-42";
const ENV_SECRET = "BIBLIO_SANDBOX_TEST_SECRET";

let dir: string;
let secretFile: string;
const repo = path.resolve(".");
const envFile = path.join(repo, ".env");
const tsconfig = path.join(repo, "tsconfig.json");

const js = (s: string) => JSON.stringify(s);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "biblio-sandbox-"));
  secretFile = path.join(dir, "secret.txt");
  fs.writeFileSync(secretFile, SECRET);
  // Le solveur charge .env dans process.env : l'enfant ne doit rien en hériter.
  process.env[ENV_SECRET] = SECRET;
});

afterAll(async () => {
  await disposeRunners();
  delete process.env[ENV_SECRET];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("options du bac à sable", () => {
  it("modèle de permissions, lecture limitée aux moteurs, aucune autre permission", () => {
    const args = sandboxArgs();
    expect(args[0]).toBe("--permission");
    for (const a of args.slice(1)) expect(a).toMatch(/^(--allow-fs-read=|--disable-sigusr1$)/);
    expect(args.join(" ")).not.toMatch(/allow-(fs-write|child-process|worker|addons|wasi|inspector)/);
    const reads = sandboxReadPaths().map((p) => path.resolve(p).toLowerCase());
    const forbidden = [repo, path.join(repo, "storage"), envFile, path.join(repo, "node_modules")].map((p) => p.toLowerCase());
    for (const p of reads) {
      expect(forbidden).not.toContain(p);
      expect(p.startsWith(path.join(repo, "storage").toLowerCase())).toBe(false);
    }
  });
});

describe("bac à sable — JavaScript", () => {
  it("témoin : un programme normal fonctionne", async () => {
    const r = await runCode("javascript", "console.log(Number(input()) * 2)", "21");
    expect(r).toMatchObject({ ok: true, stdout: "42\n" });
  });

  it("process, require et module sont masqués dans le code exécuté", async () => {
    const r = await runCode("javascript", "console.log(typeof process, typeof require, typeof module)", "");
    expect(r).toMatchObject({ ok: true, stdout: "undefined undefined undefined\n" });
  });

  it("globalThis.process.getBuiltinModule('child_process') : lancement de commande refusé", async () => {
    const r = await runCode("javascript", "const cp = globalThis.process.getBuiltinModule('child_process');\nconsole.log(String(cp.execSync('echo pwned')));", "");
    expect(r.ok).toBe(false);
    expect(r.stdout).not.toMatch(/pwned/);
    expect(r.stderr).toMatch(DENIED);
  });

  it("import('node:fs') : lecture d'un fichier hors des moteurs refusée", async () => {
    const r = await runCode("javascript", `const fs = await import('node:fs');\nconsole.log(fs.readFileSync(${js(secretFile)}, 'utf8'));`, "");
    expect(r.ok).toBe(false);
    expect(r.stdout).not.toContain(SECRET);
    expect(r.stderr).toMatch(DENIED);
  });

  it("lecture de <dépôt>/.env et <dépôt>/tsconfig.json refusée", async () => {
    for (const f of [envFile, tsconfig]) {
      const r = await runCode("javascript", `const fs = globalThis.process.getBuiltinModule('fs');\nconsole.log(fs.readFileSync(${js(f)}, 'utf8'));`, "");
      expect(r.ok, f).toBe(false);
      expect(r.stderr, f).toMatch(DENIED);
    }
  });

  it("écriture de fichier refusée", async () => {
    const target = path.join(dir, "ecrit.txt");
    const r = await runCode("javascript", `globalThis.process.getBuiltinModule('fs').writeFileSync(${js(target)}, 'x');`, "");
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(DENIED);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("worker_threads et process.binding refusés", async () => {
    const w = await runCode("javascript", "const { Worker } = globalThis.process.getBuiltinModule('worker_threads');\nnew Worker('console.log(1)', { eval: true });", "");
    expect(w.ok).toBe(false);
    expect(w.stderr).toMatch(DENIED);
    const b = await runCode("javascript", "try { globalThis.process.binding('fs'); console.log('autorisé'); } catch (e) { console.log(e.code); }", "");
    expect(b).toMatchObject({ ok: true, stdout: "ERR_ACCESS_DENIED\n" });
  });

  it("aucune variable d'environnement héritée du solveur", async () => {
    const r = await runCode("javascript", `console.log(JSON.stringify(globalThis.process.env[${js(ENV_SECRET)}] ?? null))`, "");
    expect(r).toMatchObject({ ok: true, stdout: "null\n" });
  });
});

describe("bac à sable — Python", () => {
  it("témoin : un programme normal fonctionne", async () => {
    const r = await runCode("python", "print(int(input()) * 2)", "21");
    expect(r).toMatchObject({ ok: true, stdout: "42\n" });
  }, LONG);

  it("from js import process : lecture de fichier refusée", async () => {
    const r = await runCode("python", `from js import process\nprint(process.getBuiltinModule('fs').readFileSync(${js(secretFile)}, 'utf8'))`, "");
    expect(r.ok).toBe(false);
    expect(r.stdout).not.toContain(SECRET);
    expect(r.stderr).toMatch(DENIED);
  }, LONG);

  it("from js import process : lecture de <dépôt>/.env refusée", async () => {
    const r = await runCode("python", `from js import process\nprint(process.getBuiltinModule('fs').readFileSync(${js(envFile)}, 'utf8'))`, "");
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(DENIED);
  }, LONG);

  it("from js import process : child_process refusé", async () => {
    const r = await runCode("python", "from js import process\nprint(process.getBuiltinModule('child_process').execSync('echo pwned'))", "");
    expect(r.ok).toBe(false);
    expect(r.stdout).not.toMatch(/pwned/);
    expect(r.stderr).toMatch(DENIED);
  }, LONG);

  it("montage NODEFS du disque hôte : lecture refusée", async () => {
    const code = `import pyodide_js
from pyodide.ffi import to_js
from js import Object
pyodide_js.FS.mkdir('/hote')
pyodide_js.FS.mount(pyodide_js.FS.filesystems.NODEFS, to_js({'root': ${js(dir)}}, dict_converter=Object.fromEntries), '/hote')
print(open('/hote/secret.txt').read())`;
    const r = await runCode("python", code, "");
    expect(r.ok).toBe(false);
    expect(r.stdout).not.toContain(SECRET);
  }, LONG);
});

describe("bac à sable — C", () => {
  it("le binaire WASI n'a aucun accès au disque hôte", async () => {
    const code = `#include <stdio.h>
int main(void){ FILE *f = fopen(${js(secretFile.replace(/\\/g, "/"))}, "r"); printf("%s\\n", f ? "ouvert" : "refuse"); return 0; }`;
    const r = await runCode("c", code, "");
    expect(r).toMatchObject({ ok: true, stdout: "refuse\n" });
  }, LONG);
});

describe("arrêt du solveur", () => {
  it("disposeRunners attend la fin des processus enfants : le processus parent sort avec le code 0", async () => {
    const { spawnSync } = await import("node:child_process");
    const { pathToFileURL } = await import("node:url");
    const script = path.join(dir, "dispose.mts");
    const index = pathToFileURL(path.resolve("src/lib/runners/index.ts")).href;
    fs.writeFileSync(
      script,
      `import { runCode, disposeRunners } from ${JSON.stringify(index)};\n` +
        `const r = await runCode("javascript", "console.log(1)", "");\n` +
        `await disposeRunners();\n` +
        `console.log(r.ok ? "fini" : "échec");\n`,
    );
    const p = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 30_000 });
    expect(p.stderr).not.toMatch(/unsettled top-level await/);
    expect(p.status).toBe(0);
    expect(p.stdout.trim()).toBe("fini");
  }, LONG);
});

// Le modèle de permissions ne couvre pas tout `process` : `_debugProcess(pid)` active
// l'inspecteur V8 d'un autre processus (le solveur, non isolé) et `kill` peut envoyer SIGUSR1
// (même effet sous Linux) ou tuer le parent. Ces fonctions doivent être retirées et figées.
describe("bac à sable — inspecteur et signaux", () => {
  const PROBE_JS = `
    const p = globalThis.process;
    const out = [];
    for (const n of ["_debugProcess", "_debugEnd", "kill", "_kill"]) {
      let r;
      try { p[n](p.ppid, 0); r = "APPEL-OK"; } catch (e) { r = "refusé"; }
      out.push(n + ":" + r);
    }
    try { p.kill = () => 0; delete p._debugProcess; } catch {}
    out.push("restauré:" + (typeof p._debugProcess === "function" && p._debugProcess.name !== "locked" ? "oui" : "non"));
    console.log(out.join(" "));
  `;

  it("JavaScript : _debugProcess, _debugEnd, kill, _kill refusés et non restaurables", async () => {
    const r = await runCode("javascript", PROBE_JS, "");
    expect(r.stdout).not.toMatch(/APPEL-OK/);
    expect(r.stdout).toMatch(/_debugProcess:refusé _debugEnd:refusé kill:refusé _kill:refusé/);
    expect(r.stdout).toMatch(/restauré:non/);
  }, LONG);

  it("Python (from js import process) : mêmes fonctions refusées", async () => {
    const code = [
      "from js import process",
      "res = []",
      "for n in ['_debugProcess', 'kill']:",
      "    try:",
      "        getattr(process, n)(process.ppid, 0)",
      "        res.append(n + ':APPEL-OK')",
      "    except Exception:",
      "        res.append(n + ':refusé')",
      "print(' '.join(res))",
    ].join("\n");
    const r = await runCode("python", code, "");
    expect(r.stdout).not.toMatch(/APPEL-OK/);
    expect(r.stdout).toMatch(/_debugProcess:refusé kill:refusé/);
  }, LONG);

  it("l'enfant est lancé avec --disable-sigusr1 quand Node le permet", () => {
    if (process.allowedNodeEnvironmentFlags.has("--disable-sigusr1")) expect(sandboxArgs()).toContain("--disable-sigusr1");
  });
});
