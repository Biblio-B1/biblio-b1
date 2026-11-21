// Préfixe de publication : "/biblio-b1" sur github.io (variable de build), vide en local.
// Next l'ajoute tout seul aux liens et aux fichiers de _next/ ; les adresses absolues écrites à la
// main (worker pdf.js, moteurs WASM de public/) doivent passer par withBase().
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const withBase = (path: string) => `${BASE_PATH}${path}`;

export const PDF_WORKER_SRC = withBase("/pdf.worker.min.mjs");
