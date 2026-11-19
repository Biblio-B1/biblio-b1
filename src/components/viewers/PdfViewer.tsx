"use client";

import dynamic from "next/dynamic";

/** Chargé uniquement dans le navigateur : pdf.js a besoin du DOM (canvas, worker). */
export const PdfViewer = dynamic(() => import("./PdfViewerInner"), {
  ssr: false,
  loading: () => <div className="h-[60vh] animate-pulse rounded-lg border border-line bg-sunken" aria-label="Chargement du PDF" />,
});
