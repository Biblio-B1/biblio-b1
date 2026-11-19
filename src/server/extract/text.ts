import fs from "node:fs/promises";

/** Plafonds d'extraction : gardent les imports rapides sur de gros PDF. */
export const MAX_PDF_PAGES = 200;
export const MAX_TEXT_CHARS = 2_000_000;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type PdfItem = { str?: string; hasEOL?: boolean; transform?: number[] };

async function pdfText(absPath: string): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await fs.readFile(absPath));
  // Sans worker configuré, pdf.js charge lui-même son worker "fake" dans le thread courant (Node).
  const task = pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    let out = "";
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let n = 1; n <= pages && out.length < MAX_TEXT_CHARS; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let line = "";
      let lastY: number | null = null;
      for (const raw of content.items as PdfItem[]) {
        if (typeof raw.str !== "string") continue;
        const y = raw.transform?.[5] ?? null;
        // Changement de ligne : saut de y notable (> 2 pt) ou fin de ligne signalée.
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && line) {
          out += line.trimEnd() + "\n";
          line = "";
        }
        line += raw.str;
        if (y !== null) lastY = y;
        if (raw.hasEOL) {
          out += line.trimEnd() + "\n";
          line = "";
        }
      }
      if (line) out += line.trimEnd() + "\n";
      page.cleanup();
    }
    return out.trim();
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
