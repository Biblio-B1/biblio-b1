import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".c": "text/x-csrc",
  ".h": "text/x-chdr",
  ".py": "text/x-python",
  ".txt": "text/plain",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const ALLOWED_EXTENSIONS = Object.keys(MIME_BY_EXT);

export function mimeFromExtension(ext: string): string | undefined {
  return MIME_BY_EXT[ext.toLowerCase()];
}

/**
 * Enregistre un upload sous `<root>/uploads/YYYY/MM/<uuid><ext>`.
 * Le nom d'origine n'est utilisé que pour son extension (vérifiée) :
 * aucune autre partie du nom fourni n'entre dans le chemin.
 * `root` vaut STORAGE_PATH par défaut ; les tests passent un dossier temporaire.
 */
export function saveUpload(
  buf: Buffer,
  originalName: string,
  root: string = env.STORAGE_PATH,
): { filePath: string; sha256: string; mime: string } {
  const base = originalName.split(/[\\/]/).pop() ?? "";
  const ext = path.extname(base).toLowerCase();
  const mime = mimeFromExtension(ext);
  if (!mime) {
    throw new Error(`Extension non autorisée : ${ext || "(aucune)"}`);
  }
  if (buf.length === 0) {
    throw new Error("Fichier vide");
  }
  if (buf.length > MAX_UPLOAD_BYTES) {
    throw new Error("Fichier trop volumineux (50 Mo maximum)");
  }
  const now = new Date();
  const rel = [
    "uploads",
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${crypto.randomUUID()}${ext}`,
  ].join("/");
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root, "uploads") + path.sep)) {
    throw new Error("Chemin de stockage invalide");
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  return { filePath: rel, sha256, mime };
}

/** Chemin absolu d'un fichier stocké ; refuse toute sortie de `root`. */
export function resolveStoragePath(filePath: string, root: string = env.STORAGE_PATH): string {
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, filePath);
  if (!abs.startsWith(rootAbs + path.sep)) throw new Error("Chemin hors du stockage");
  return abs;
}
