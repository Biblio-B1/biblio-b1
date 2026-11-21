import fs from "node:fs/promises";
import { documentText, MAX_TEXT_CHARS } from "@/lib/pdf-text";

/** Plafonds d'extraction (partagés avec le navigateur) : gardent les imports rapides sur de gros PDF. */
export { MAX_PDF_PAGES, MAX_TEXT_CHARS } from "@/lib/pdf-text";

/** Taille max d'upload : au-delà, pas d'extraction. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";


async function pdfText(absPath: string): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await fs.readFile(absPath));
  // Sans worker configuré, pdf.js charge lui-même son worker "fake" dans le thread courant (Node).
  const task = pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 });
  try {
    return await documentText(await task.promise);
  } finally {
    await task.destroy();
  }
}

/**
 * Texte brut d'un fichier. PDF : pdf.js ; .docx : mammoth ; texte/code : utf-8 ;
 * images, pptx et le reste : ''. Ne lève jamais (fichier corrompu -> '' + warn).
 */
export async function extractText(absPath: string, mime: string): Promise<string> {
  try {
    if ((await fs.stat(absPath)).size > MAX_FILE_BYTES) return "";
    let text = "";
    if (mime === "application/pdf") text = await pdfText(absPath);
    else if (mime === DOCX) {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ path: absPath })).value;
    } else if (mime.startsWith("text/")) text = await fs.readFile(absPath, "utf8");
    return text.slice(0, MAX_TEXT_CHARS);
  } catch (e) {
    console.warn(`[extract] échec d'extraction (${absPath}) :`, e instanceof Error ? e.message : e);
    return "";
  }
}
