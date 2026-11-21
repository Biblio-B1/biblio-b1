// Extraction du texte d'un fichier dans le navigateur (classement et découpage des exercices).
// PDF : pdf.js (même worker que le visualiseur) ; texte et code : lecture directe ; le reste : "".
import { documentText, MAX_TEXT_CHARS } from "@/lib/pdf-text";
import { PDF_WORKER_SRC } from "@/lib/site";

export async function extractTextFromFile(file: File, mime: string): Promise<string> {
  try {
    if (mime === "application/pdf") {
      const { pdfjs } = await import("react-pdf");
      pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
      const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0 });
      try {
        return (await documentText(await task.promise)).slice(0, MAX_TEXT_CHARS);
      } finally {
        await task.destroy();
      }
    }
    if (mime.startsWith("text/")) return (await file.text()).slice(0, MAX_TEXT_CHARS);
  } catch (e) {
    console.warn("[extraction] échec :", e instanceof Error ? e.message : e);
  }
  return "";
}
