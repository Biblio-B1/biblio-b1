// Copie le worker pdf.js dans public/ (servi localement, aucun CDN).
// Exécuté par postinstall / predev / prebuild.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// La version du worker doit être celle de pdfjs-dist utilisée par react-pdf.
const reactPdfDir = path.dirname(require.resolve("react-pdf/package.json"));
const pdfjsPkg = createRequire(path.join(reactPdfDir, "package.json")).resolve("pdfjs-dist/package.json");
const src = path.join(path.dirname(pdfjsPkg), "build", "pdf.worker.min.mjs");
const dest = path.join(process.cwd(), "public", "pdf.worker.min.mjs");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`pdf.js worker -> ${path.relative(process.cwd(), dest)}`);
