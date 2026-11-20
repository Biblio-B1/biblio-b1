import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { disposeRunners, outputsMatch, runCode } from "@/lib/runners";

// Les moteurs (clang WASM, Pyodide) sont chargés une fois par langage et partagés entre les tests.
afterAll(async () => {
  await disposeRunners();
});

const LONG = 60_000; // premier chargement d'un moteur (clang ~100 Mo, Pyodide)

const C_SUM = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

int main(void) {
    int a, b;
    if (scanf("%d %d", &a, &b) != 2) return 1;
    printf("%d\\n", a + b);
    return 0;
}
`;

describe("runCode — C", () => {
  it("somme de deux entiers lus sur stdin", async () => {
    const r = await runCode("c", C_SUM, "2 3");
    expect(r).toMatchObject({ ok: true, stdout: "5\n", phase: "run", timedOut: false, exitCode: 0 });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  }, LONG);

  it("utilise stdlib, string et math (C99)", async () => {
    const code = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
int main(void) {
    char *s = malloc(16);
    strcpy(s, "ok");
    for (int i = 0; i < 2; i++) printf("%s %.2f\\n", s, sqrt(2.0) * (i + 1));
    free(s);
    return 0;
}
`;
    const r = await runCode("c", code, "");
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe("ok 1.41\nok 2.83\n");
  }, LONG);

  it("erreur de syntaxe → échec de compilation", async () => {
    const r = await runCode("c", "int main( { return 0 }", "");
    expect(r.ok).toBe(false);
    expect(r.phase).toBe("compile");
    expect(r.stderr).not.toBe("");
    expect(r.timedOut).toBe(false);
  }, LONG);

  it("code de sortie non nul → ok=false", async () => {
    const r = await runCode("c", "#include <stdio.h>\nint main(void){ printf(\"x\"); return 3; }", "");
    expect(r).toMatchObject({ ok: false, phase: "run", exitCode: 3, stdout: "x" });
  }, LONG);

  it("lecture au-delà de l'entrée fournie → EOF, pas de blocage", async () => {
    const code = `#include <stdio.h>
int main(void){ int x, n = 0; while (scanf("%d", &x) == 1) n++; printf("%d\\n", n); return 0; }`;
    const r = await runCode("c", code, "1 2 3", { timeoutMs: 3000 });
    expect(r).toMatchObject({ ok: true, stdout: "3\n", timedOut: false });
  }, LONG);

  it("boucle infinie → arrêtée au délai", async () => {
    const timeoutMs = 1500;
    const t0 = Date.now();
    const r = await runCode("c", "int main(void){ while(1); return 0; }", "", { timeoutMs });
    const elapsed = Date.now() - t0;
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.phase).toBe("run");
    expect(r.exitCode).toBeNull();
    expect(r.stderr).toMatch(/délai/i);
    expect(elapsed).toBeLessThanOrEqual(timeoutMs + 2000);
  }, LONG);

  it("le moteur est rechargé après un arrêt au délai", async () => {
    const r = await runCode("c", C_SUM, "40 2");
    expect(r).toMatchObject({ ok: true, stdout: "42\n" });
  }, LONG);
});

describe("runCode — Python", () => {
  it("print(int(input())*2)", async () => {
    const r = await runCode("python", "print(int(input())*2)", "21");
    expect(r).toMatchObject({ ok: true, stdout: "42\n", phase: "run", timedOut: false, exitCode: 0 });
  }, LONG);

  it("exception → ok=false, phase run, traceback sur stderr", async () => {
    const r = await runCode("python", "x = 1\nraise ValueError('boum')", "");
    expect(r.ok).toBe(false);
    expect(r.phase).toBe("run");
    expect(r.stderr).toMatch(/ValueError: boum/);
  }, LONG);

  it("erreur de syntaxe → phase compile", async () => {
    const r = await runCode("python", "def f(:\n  pass", "");
    expect(r).toMatchObject({ ok: false, phase: "compile" });
    expect(r.stderr).toMatch(/SyntaxError/);
  }, LONG);

  it("chaque exécution est isolée (stdin et variables)", async () => {
    const a = await runCode("python", "a = input()\nprint(a)", "un\ndeux");
    const b = await runCode("python", "import sys\nprint(sys.stdin.read().split())\nprint('a' in globals())", "trois");
    expect(a.stdout).toBe("un\n");
    expect(b.stdout).toBe("['trois']\nFalse\n");
  }, LONG);

  it("sys.exit(2) → code de sortie 2", async () => {
    const r = await runCode("python", "import sys\nprint('avant')\nsys.exit(2)", "");
    expect(r).toMatchObject({ ok: false, exitCode: 2, stdout: "avant\n" });
  }, LONG);

  it("builtins modifiés par une exécution n'affectent pas la suivante", async () => {
    await runCode("python", "import builtins\nbuiltins.input = lambda *a: '21'\nbuiltins.print = None", "");
    const r = await runCode("python", "print(int(input())*2)", "");
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/EOFError/);
  }, LONG);

  it("module standard modifié (math, io) restauré pour l'exécution suivante", async () => {
    await runCode("python", "import math, io, sys\nmath.sqrt = lambda x: 0\nio.StringIO = None\nsys.setrecursionlimit(50)\nsys.path.append('/x')", "");
    const r = await runCode("python", "import math, io, sys\nprint(math.sqrt(4))\nprint(io.StringIO is not None)\nprint(sys.getrecursionlimit() > 50, '/x' in sys.path)", "");
    expect(r.stdout).toBe("2.0\nTrue\nTrue False\n");
  }, LONG);

  it("boucle infinie → arrêtée au délai", async () => {
    const t0 = Date.now();
    const r = await runCode("python", "while True:\n  pass", "", { timeoutMs: 1500 });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
    expect(Date.now() - t0).toBeLessThanOrEqual(1500 + 2000);
  }, LONG);
});

describe("runCode — JavaScript", () => {
  it("lit stdin avec input() et écrit avec console.log", async () => {
    const code = "const n = Number(input());\nconst m = Number(input());\nconsole.log(n + m);\nconsole.log(input());";
    const r = await runCode("javascript", code, "2\n3");
    expect(r).toMatchObject({ ok: true, stdout: "5\nnull\n", phase: "run", timedOut: false, exitCode: 0 });
  });

  it("readline() est un alias de input(), console.error va sur stderr", async () => {
    const r = await runCode("javascript", "console.error('attention'); console.log(readline().toUpperCase(), [1, 2]);", "abc\n");
    expect(r.stdout).toBe("ABC [1,2]\n");
    expect(r.stderr).toBe("attention\n");
  });

  it("exception → ok=false, phase run", async () => {
    const r = await runCode("javascript", "throw new Error('boum')", "");
    expect(r).toMatchObject({ ok: false, phase: "run" });
    expect(r.stderr).toMatch(/Error: boum/);
  });

  it("erreur de syntaxe → phase compile", async () => {
    const r = await runCode("javascript", "const = 3", "");
    expect(r).toMatchObject({ ok: false, phase: "compile" });
    expect(r.stderr).toMatch(/SyntaxError/);
  });

  it("minuteries : attendues jusqu'à la fin, sortie capturée", async () => {
    const r = await runCode("javascript", "setTimeout(() => console.log('tard'), 20);\nconst id = setTimeout(() => console.log('jamais'), 30);\nclearTimeout(id);\nlet n = 0; const t = setInterval(() => { n++; if (n === 3) { clearInterval(t); console.log(n); } }, 5);\nconsole.log('tôt');", "", { timeoutMs: 3000 });
    expect(r).toMatchObject({ ok: true, stdout: "tôt\ntard\n3\n" });
  });

  it("exception dans une minuterie → ok=false", async () => {
    const r = await runCode("javascript", "setTimeout(() => { throw new Error('plus tard') }, 5)", "", { timeoutMs: 3000 });
    expect(r).toMatchObject({ ok: false, phase: "run" });
    expect(r.stderr).toMatch(/Error: plus tard/);
  });

  it("minuterie qui boucle ou setInterval sans fin → délai, puis exécution suivante normale", async () => {
    const a = await runCode("javascript", "setTimeout(() => { while (true) {} }, 10); console.log('hi')", "", { timeoutMs: 1000 });
    expect(a.timedOut).toBe(true);
    const b = await runCode("javascript", "setInterval(() => {}, 1); console.log('x')", "", { timeoutMs: 1000 });
    expect(b.timedOut).toBe(true);
    const t0 = Date.now();
    const c = await runCode("javascript", "console.log(1)", "", { timeoutMs: 1000 });
    expect(c).toMatchObject({ ok: true, stdout: "1\n" });
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it("minuterie globale contournée (globalThis.setTimeout) : l'exécution suivante n'est pas bloquée", async () => {
    await runCode("javascript", "globalThis.setTimeout(() => { while (true) {} }, 10); console.log('hi')", "", { timeoutMs: 1000 });
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    const c = await runCode("javascript", "console.log(2)", "", { timeoutMs: 1000 });
    expect(c).toMatchObject({ ok: true, stdout: "2\n" });
    expect(Date.now() - t0).toBeLessThan(2500);
  }, 10_000);

  it("boucle infinie → arrêtée au délai", async () => {
    const r = await runCode("javascript", "while (true) {}", "", { timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: false, timedOut: true });
  });
});

describe("outputsMatch", () => {
  it("ignore espaces de fin de ligne, lignes vides finales et \\r\\n", () => {
    expect(outputsMatch("a  \nb\n\n", "a\r\nb")).toBe(true);
    expect(outputsMatch("5\n", "5")).toBe(true);
  });

  it("distingue les sorties différentes", () => {
    expect(outputsMatch("1", "2")).toBe(false);
    expect(outputsMatch("a b", "a  b")).toBe(false);
    expect(outputsMatch("\na", "a")).toBe(false);
  });
});

describe("point d'entrée navigateur", () => {
  it("browser.ts et ses imports n'utilisent aucun module Node", () => {
    const dir = path.resolve("src/lib/runners");
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = fs.readFileSync(path.join(dir, file), "utf8");
      expect(src, file).not.toMatch(/from\s+["']node:|import\(\s*["']node:/);
      for (const m of src.matchAll(/from\s+["']\.\/([\w-]+\.ts)["']/g)) visit(m[1]);
    };
    visit("browser.ts");
    expect([...seen]).toEqual(expect.arrayContaining(["engine.ts", "c.ts", "python.ts", "javascript.ts"]));
    expect(seen.has("index.ts")).toBe(false);
    expect(seen.has("node-worker.ts")).toBe(false);
  });
});
