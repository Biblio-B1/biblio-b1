import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { MAX_UPLOAD_BYTES, mimeFromExtension } from "./storage";

/**
 * Brouillons d'upload : fichiers déposés mais pas encore confirmés.
 * Stockés sous `<root>/drafts/<uuid><ext>` + `<uuid>.json` (métadonnées),
 * hors de `uploads/` donc jamais servis par `/files`. Rien en base tant que
 * l'utilisateur n'a pas confirmé ; purgés après 24 h.
 */
export const DRAFTS_DIR = "drafts";
export const DRAFT_MAX_AGE_MS = 24 * 3600_000;

export type Draft = {
  tmpId: string;
  fileName: string;
  ext: string;
  ownerId: string;
  mime: string;
  sha256: string;
  size: number;
  suggestedSubjectId: string | null;
  createdAt: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const dir = (root: string) => path.resolve(root, DRAFTS_DIR);

/** Nom d'affichage : dernier segment, sans caractères de contrôle. */
export function displayName(originalName: string): string {
  const base = (originalName.split(/[\\/]/).pop() ?? "").replace(/[\x00-\x1f\x7f]/g, "").trim();
  return base.slice(-200) || "fichier";
}

export function createDraft(
  buf: Buffer,
  originalName: string,
  ownerId: string,
  suggestedSubjectId: string | null,
  root: string = env.STORAGE_PATH,
): Draft {
  const fileName = displayName(originalName);
  const ext = path.extname(fileName).toLowerCase();
  const mime = mimeFromExtension(ext);
  if (!mime) throw new Error(`Extension non autorisée : ${ext || "(aucune)"}`);
  if (buf.length === 0) throw new Error("Fichier vide");
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error("Fichier trop volumineux (50 Mo maximum)");
  const draft: Draft = {
    tmpId: crypto.randomUUID(),
    fileName,
    ext,
    ownerId,
    mime,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    size: buf.length,
    suggestedSubjectId,
    createdAt: Date.now(),
  };
  fs.mkdirSync(dir(root), { recursive: true });
  fs.writeFileSync(path.join(dir(root), `${draft.tmpId}${ext}`), buf);
  fs.writeFileSync(path.join(dir(root), `${draft.tmpId}.json`), JSON.stringify(draft));
  return draft;
}

function readMeta(tmpId: string, root: string): Draft | null {
  if (!UUID.test(tmpId)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dir(root), `${tmpId}.json`), "utf8")) as Draft;
    return d.tmpId === tmpId && mimeFromExtension(d.ext) ? d : null;
  } catch {
    return null;
  }
}

/** Lit un brouillon appartenant à `ownerId` ; null sinon. */
export function readDraft(
  tmpId: string,
  ownerId: string,
  root: string = env.STORAGE_PATH,
): { draft: Draft; buf: Buffer } | null {
  const draft = readMeta(tmpId, root);
  if (!draft || draft.ownerId !== ownerId) return null;
  try {
    return { draft, buf: fs.readFileSync(path.join(dir(root), `${tmpId}${draft.ext}`)) };
  } catch {
    return null;
  }
}

export function deleteDraft(tmpId: string, root: string = env.STORAGE_PATH): void {
  const draft = readMeta(tmpId, root);
  if (!draft) return;
  fs.rmSync(path.join(dir(root), `${tmpId}${draft.ext}`), { force: true });
  fs.rmSync(path.join(dir(root), `${tmpId}.json`), { force: true });
}

/** Supprime les brouillons plus vieux que `maxAgeMs` (et les fichiers orphelins). */
export function cleanupDrafts(
  root: string = env.STORAGE_PATH,
  maxAgeMs: number = DRAFT_MAX_AGE_MS,
  now: number = Date.now(),
): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir(root));
  } catch {
    return;
  }
  const keep = new Set<string>();
  for (const e of entries) {
    if (!e.endsWith(".json")) continue;
    const id = e.slice(0, -5);
    const d = readMeta(id, root);
    if (d && now - d.createdAt <= maxAgeMs) keep.add(id);
    else if (d) deleteDraft(id, root);
    else fs.rmSync(path.join(dir(root), e), { force: true });
  }
  for (const e of entries) {
    const id = e.replace(/\.[^.]*$/, "");
    if (!keep.has(id) && fs.existsSync(path.join(dir(root), e))) {
      const stat = fs.statSync(path.join(dir(root), e));
      if (now - stat.mtimeMs > maxAgeMs) fs.rmSync(path.join(dir(root), e), { force: true });
    }
  }
}
