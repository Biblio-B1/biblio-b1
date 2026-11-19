import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

/** Seul ce sous-dossier du stockage est servi par `/files/...` (jamais data.db ni les brouillons). */
export const SERVED_DIR = "uploads";

const BAD_SEGMENT = /[\\/\0:]/;

/**
 * Résout `/files/<segments>` vers un fichier existant sous `<root>/uploads`.
 * Contrôle lexical (segments) puis contrôle réel via realpath (liens symboliques).
 * Renvoie le chemin absolu réel, ou null si refusé / absent.
 */
export function resolveServedFile(segments: string[], root: string = env.STORAGE_PATH): string | null {
  if (segments.length < 2 || segments[0] !== SERVED_DIR) return null;
  for (const s of segments) {
    if (!s || s === "." || s === ".." || BAD_SEGMENT.test(s)) return null;
  }
  try {
    const base = fs.realpathSync(path.resolve(root, SERVED_DIR));
    const real = fs.realpathSync(path.resolve(root, ...segments));
    if (!real.startsWith(base + path.sep)) return null;
    if (!fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

/** En-tête Content-Disposition sûr (nom ASCII de repli + nom UTF-8 encodé RFC 5987). */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
