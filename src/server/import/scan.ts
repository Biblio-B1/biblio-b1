import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES } from "../storage";
import { isExcludedDirName, isExcludedPath } from "./exclusions";

export type ScannedFile = {
  /** Chemin absolu sur disque (pour un fichier extrait d'un zip : copie temporaire). */
  absPath: string;
  /** Chemin relatif à la racine, séparateur « / » (zip : `<chemin du zip>/<entrée>`). */
  relPath: string;
  /** Extension en minuscules, avec le point. */
  ext: string;
};

const ALLOWED = new Set(ALLOWED_EXTENSIONS);

/** Dossier ignoré : règles de `exclusions.ts` (build, dépôt git, modèles, archives de versions...). */
export const isExcludedDir = isExcludedDirName;

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
      } else if (e.isFile() && isWantedFile(e.name) && !isExcludedPath(r)) {
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
  if (isExcludedPath(parts.join("/"))) return null;
  return parts;
}

/** Garde-fous contre les bombes zip. */
export type ZipLimits = {
  /** Entrées max par zip (au-delà : zip ignoré entièrement). */
  maxEntries: number;
  /** Octets extraits max par zip de premier niveau (zips imbriqués compris). */
  maxBytesPerZip: number;
  /** Octets extraits max pour tout l'appel. */
  maxBytesTotal: number;
};

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 5000,
  maxBytesPerZip: 500 * 1024 * 1024,
  maxBytesTotal: 2 * 1024 * 1024 * 1024,
};

/**
 * Remplace chaque .zip par ses entrées importables, extraites sous `tmpDir` (zips imbriqués
 * développés jusqu'à 3 niveaux). Entrées avec `..`, absolues, dans un dossier exclu ou
 * d'extension non autorisée : ignorées. Zip illisible ou trop d'entrées : ignoré. Entrée
 * > 50 Mo (taille déclarée ou réelle) : ignorée. Au-delà des plafonds d'octets : reste ignoré.
 */
export function expandZips(
  files: ScannedFile[],
  tmpDir: string,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): ScannedFile[] {
  const out: ScannedFile[] = [];
  let counter = 0;
  let totalBytes = 0;
  let zipBytes = 0;
  const expand = (zipFile: ScannedFile, depth: number) => {
    let zip: AdmZip;
    let entries: AdmZip.IZipEntry[];
    try {
      zip = new AdmZip(zipFile.absPath);
      entries = zip.getEntries();
    } catch (e) {
      console.warn(`[import] zip illisible ignoré (${zipFile.relPath}) :`, e instanceof Error ? e.message : e);
      return;
    }
    if (entries.length > limits.maxEntries) {
      console.warn(`[import] zip ignoré (${zipFile.relPath}) : ${entries.length} entrées (max ${limits.maxEntries})`);
      return;
    }
    const dest = path.resolve(tmpDir, String(++counter));
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const parts = safeEntryParts(entry.entryName);
      if (!parts) continue;
      if (entry.header.size > MAX_UPLOAD_BYTES) continue;
      const abs = path.resolve(dest, ...parts);
      if (!abs.startsWith(dest + path.sep)) continue;
      if (zipBytes + entry.header.size > limits.maxBytesPerZip || totalBytes + entry.header.size > limits.maxBytesTotal) {
        console.warn(`[import] plafond d'extraction atteint, reste du zip ignoré (${zipFile.relPath})`);
        return;
      }
      let data: Buffer;
      try {
        data = entry.getData();
      } catch {
        continue;
      }
      // Taille réelle : la taille déclarée dans l'en-tête peut mentir.
      if (data.length > MAX_UPLOAD_BYTES) continue;
      if (zipBytes + data.length > limits.maxBytesPerZip || totalBytes + data.length > limits.maxBytesTotal) {
        console.warn(`[import] plafond d'extraction atteint, reste du zip ignoré (${zipFile.relPath})`);
        return;
      }
      zipBytes += data.length;
      totalBytes += data.length;
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
    if (f.ext === ".zip") {
      zipBytes = 0;
      expand(f, 1);
    } else out.push(f);
  }
  return out;
}
