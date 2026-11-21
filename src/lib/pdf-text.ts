// Reconstruction des lignes d'une page PDF à partir des morceaux de texte de pdf.js. Partagé par
// l'import (Node) et le dépôt de fichiers (navigateur).

export const MAX_PDF_PAGES = 200;
export const MAX_TEXT_CHARS = 2_000_000;

export type PdfTextItem = { str?: unknown; transform?: number[]; hasEOL?: boolean };

/** Texte d'une page : nouvelle ligne au changement de hauteur (> 2 pt) ou en fin de ligne signalée. */
export function pageItemsToText(items: PdfTextItem[]): string {
  let out = "";
  let line = "";
  let lastY: number | null = null;
  for (const raw of items) {
    if (typeof raw.str !== "string") continue;
    const y = raw.transform?.[5] ?? null;
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
  return out;
}

type PdfDoc = { numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void }> };

/** Texte des premières pages d'un document pdf.js déjà ouvert (plafonné). */
export async function documentText(doc: PdfDoc): Promise<string> {
  let out = "";
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  for (let n = 1; n <= pages && out.length < MAX_TEXT_CHARS; n++) {
    const page = await doc.getPage(n);
    out += pageItemsToText((await page.getTextContent()).items as PdfTextItem[]);
    page.cleanup();
  }
  return out.trim();
}
