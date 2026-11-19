import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES } from "../storage";

export type ScannedFile = {
  /** Chemin absolu sur disque (pour un fichier extrait d'un zip : copie temporaire). */
  absPath: string;
  /** Chemin relatif à la racine, séparateur « / » (zip : `<chemin du zip>/<entrée>`). */
  relPath: string;
  /** Extension en minuscules, avec le point. */
  ext: string;
};

const EXCLUDED_DIRS = new Set([
  ".git", "bin", "obj", "node_modules", "000_template", "__macosx", "cmakefiles", ".idea", ".vscode",
]);
const ALLOWED = new Set(ALLOWED_EXTENSIONS);

/** Dossier ignoré : build (bin, obj, cmake-build-*), dépôt git, modèles, pages web enregistrées (`*_files`). */
export function isExcludedDir(name: string): boolean {
  const n = name.toLowerCase();
  return EXCLUDED_DIRS.has(n) || n.endsWith("_files") || n.startsWith("cmake-build-");
}

/** Fichier retenu : extension autorisée (ou .zip, développé ensuite) ; pas de fichier caché. */
function isWantedFile(name: string): boolean {
  if (name.startsWith(".") || name.startsWith("~$")) return false;
  const ext = path.extname(name).toLowerCase();
  return ALLOWED.has(ext) || ext === ".zip";
}

/** Parcourt `root` (lecture seule) et liste les fichiers importables, triés par chemin. */
export function scanDir(root: string): ScannedFile[] {
  const out: ScannedFile[] = [];
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!isExcludedDir(e.name)) walk(abs, r);
      } else if (e.isFile() && isWantedFile(e.name)) {
        out.push({ absPath: abs, relPath: r, ext: path.extname(e.name).toLowerCase() });
      }
    }
  };
  walk(path.resolve(root), "");
  return out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
}

const MAX_ZIP_DEPTH = 3;

/** Entrée de zip sûre et voulue : pas de `..`, pas de chemin absolu, pas de dossier exclu. */
function safeEntryParts(name: string): string[] | null {
  const parts = name.replace(/\\/g, "/").split("/").filter((p) => p !== "" && p !== ".");
  if (!parts.length || parts.includes("..") || /^[a-z]:$/i.test(parts[0]) || name.startsWith("/")) return null;
  if (parts.slice(0, -1).some(isExcludedDir)) return null;
  if (!isWantedFile(parts[parts.length - 1])) return null;
  return parts;
}

/**
 * Remplace chaque .zip par ses entrées importables, extraites sous `tmpDir` (zips imbriqués
 * développés jusqu'à 3 niveaux). Entrées avec `..`, absolues, dans un dossier exclu ou
 * d'extension non autorisée : ignorées. Zip illisible : ignoré (avertissement).
 */
export function expandZips(files: ScannedFile[], tmpDir: string): ScannedFile[] {
  const out: ScannedFile[] = [];
  let counter = 0;
  const expand = (zipFile: ScannedFile, depth: number) => {
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipFile.absPath);
    } catch (e) {
      console.warn(`[import] zip illisible ignoré (${zipFile.relPath}) :`, e instanceof Error ? e.message : e);
      return;
    }
    const dest = path.resolve(tmpDir, String(++counter));
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const parts = safeEntryParts(entry.entryName);
      if (!parts) continue;
      if (entry.header.size > MAX_UPLOAD_BYTES) continue;
      const abs = path.resolve(dest, ...parts);
      if (!abs.startsWith(dest + path.sep)) continue;
      let data: Buffer;
      try {
        data = entry.getData();
      } catch {
        continue;
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, data);
      const f: ScannedFile = {
        absPath: abs,
        relPath: `${zipFile.relPath}/${parts.join("/")}`,
        ext: path.extname(parts[parts.length - 1]).toLowerCase(),
      };
      if (f.ext === ".zip") {
        if (depth < MAX_ZIP_DEPTH) expand(f, depth + 1);
      } else out.push(f);
    }
  };
  for (const f of files) {
    if (f.ext === ".zip") expand(f, 1);
    else out.push(f);
  }
  return out;
}
