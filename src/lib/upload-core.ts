// Règles du dépôt de fichiers depuis le navigateur (sans accès aux données).

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  md: "text/markdown",
  txt: "text/plain",
  c: "text/x-c",
  h: "text/x-c",
  py: "text/x-python",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const extOf = (fileName: string) => /\.([^./\\]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? "";

export function mimeOf(fileName: string): string {
  return MIME[extOf(fileName)] ?? "application/octet-stream";
}

/** Chemin dans le bucket : seul uploads/<id utilisateur>/ est autorisé en écriture (RLS du stockage). */
export function uploadStoragePath(userId: string, sha256: string, fileName: string): string {
  const ext = extOf(fileName);
  return `uploads/${userId}/${sha256}${ext ? `.${ext}` : ""}`;
}

/** null si le fichier est acceptable, sinon le message d'erreur. */
export function validateUploadFile(file: { name: string; size: number }): string | null {
  if (!file.name || file.name.length > 255) return "Nom de fichier invalide.";
  if (file.size > MAX_UPLOAD_BYTES) return "Fichier trop volumineux (50 Mo maximum)";
  return null;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type DocType = "course" | "photo" | "exercise" | "exam" | "note";

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
const CODE_EXT = new Set(["c", "h", "py"]);

/** Type de contenu proposé d'après le nom de fichier (modifiable à la confirmation). */
export function guessType(fileName: string): DocType {
  const ext = extOf(fileName);
  const name = fileName.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (IMAGE_EXT.has(ext)) return "photo";
  if (CODE_EXT.has(ext)) return "exercise";
  if (/\b(annales?|partiel|exam(en)?|ds\d*|controle)\b/.test(name)) return "exam";
  if (/\b(td|tp|lab|exo|exercices?|exercises?)\s*\d*\b/.test(name)) return "exercise";
  if (ext === "md" || ext === "txt") return "note";
  return "course";
}

export function titleFromFileName(fileName: string): string {
  const t = fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  return (t || fileName).slice(0, 300);
}
