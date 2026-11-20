// Copie les moteurs WebAssembly (clang de @yowasp/clang, Pyodide) dans public/runtimes/
// pour qu'ils soient servis localement (aucun CDN). Exécuté par postinstall / predev / prebuild.
// La copie (~115 Mo) est sautée si la version installée est déjà en place.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const outRoot = path.join(process.cwd(), "public", "runtimes");

const runtimes = [
  {
    name: "clang",
    pkg: "@yowasp/clang",
    // bundle.js charge llvm*.wasm et llvm-resources.tar relativement à sa propre URL.
    dir: "gen",
    files: (dir) => fs.readdirSync(dir).filter((f) => f === "bundle.js" || f.endsWith(".wasm") || f.endsWith(".tar")),
  },
  {
    name: "pyodide",
    pkg: "pyodide",
    dir: ".",
    files: () => ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"],
  },
];

function pkgDir(pkg) {
  // Les « exports » de ces paquets n'exposent pas tous package.json : on remonte depuis node_modules.
  const p = path.join(process.cwd(), "node_modules", ...pkg.split("/"));
  if (fs.existsSync(path.join(p, "package.json"))) return p;
  return path.dirname(require.resolve(`${pkg}/package.json`));
}

for (const rt of runtimes) {
  const root = pkgDir(rt.pkg);
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const srcDir = path.join(root, rt.dir);
  const dest = path.join(outRoot, rt.name);
  const stamp = path.join(dest, ".version");
  const files = rt.files(srcDir);
  const upToDate =
    fs.existsSync(stamp) &&
    fs.readFileSync(stamp, "utf8") === version &&
    files.every((f) => fs.existsSync(path.join(dest, f)) && fs.statSync(path.join(dest, f)).size === fs.statSync(path.join(srcDir, f)).size);
  if (upToDate) {
    console.log(`runtime ${rt.name} ${version} déjà dans ${path.relative(process.cwd(), dest)}`);
    continue;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(srcDir, f), path.join(dest, f));
  fs.writeFileSync(stamp, version);
  console.log(`runtime ${rt.name} ${version} -> ${path.relative(process.cwd(), dest)} (${files.length} fichiers)`);
}
