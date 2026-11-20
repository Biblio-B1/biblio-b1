import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { documents, homeworks } from "@/server/db/schema";
import { contentDisposition, resolveServedFile } from "@/server/files";
import { mimeFromExtension } from "@/server/storage";

export const dynamic = "force-dynamic";

// Affichés dans le navigateur ; tout le reste part en téléchargement.
const INLINE = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/**
 * GET /files/<filePath> : sert un fichier stocké sous STORAGE_PATH/uploads.
 * Le middleware laisse passer les URL finissant par une extension d'image :
 * la session est donc vérifiée ici, systématiquement.
 */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!(await getCurrentUser())) return new Response("Non authentifié", { status: 401 });

  const segments = (await params).path;
  const abs = resolveServedFile(segments);
  if (!abs) return new Response("Fichier introuvable", { status: 404 });

  const ext = path.extname(abs).toLowerCase();
  const mime = mimeFromExtension(ext) ?? "application/octet-stream";
  const relPath = segments.join("/");
  const db = getDb();
  const doc = db
    .select({ title: documents.title })
    .from(documents)
    .where(eq(documents.filePath, relPath))
    .get();
  const hw = !doc
    ? db
        .select({ title: homeworks.attachmentName })
        .from(homeworks)
        .where(eq(homeworks.attachmentPath, relPath))
        .get()
    : undefined;
  const rawName = doc?.title ?? hw?.title ?? "fichier";
  const baseName = rawName.endsWith(ext) ? rawName.slice(0, -ext.length) : rawName;
  const downloadName = `${(baseName || "fichier").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 150)}${ext}`;
  const wantsDownload = new URL(req.url).searchParams.has("download");
  const inline = INLINE.has(mime) && !wantsDownload;

  const body = await fs.promises.readFile(abs);
  return new Response(new Uint8Array(body), {
    headers: {
      // Textes servis en text/plain : jamais interprétés comme HTML.
      "Content-Type": mime.startsWith("text/") ? "text/plain; charset=utf-8" : mime,
      "Content-Length": String(body.length),
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", downloadName),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
      // Le lecteur PDF intégré du navigateur ne supporte pas une CSP stricte.
      ...(mime === "application/pdf"
        ? {}
        : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
    },
  });
}
