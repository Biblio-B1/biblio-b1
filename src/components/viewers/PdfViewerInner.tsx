"use client";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { IconChevron } from "@/components/layout/Icons";

// Worker servi localement (copié dans public/ par scripts/copy-pdf-worker.mjs).
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export default function PdfViewerInner({ url, initialPage = 1 }: { url: string; initialPage?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [pageInput, setPageInput] = useState(String(initialPage));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const go = useCallback(
    (p: number) => {
      const next = Math.min(Math.max(1, p), pages || 1);
      setPage(next);
      setPageInput(String(next));
    },
    [pages],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(page + 1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, page]);

  const zi = ZOOMS.indexOf(zoom);

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-14 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface/95 px-2 py-1.5 backdrop-blur">
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost btn-icon h-8" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Page précédente">
            <IconChevron dir="left" />
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go(Number(pageInput) || 1);
            }}
            className="flex items-center gap-1 text-[14px] text-ink-2"
          >
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
              onBlur={() => go(Number(pageInput) || page)}
              inputMode="numeric"
              aria-label="Numéro de page"
              className="h-8 w-11 rounded border border-line bg-bg text-center tabular-nums"
            />
            <span className="tabular-nums">/ {pages || "…"}</span>
          </form>
          <button className="btn btn-ghost btn-icon h-8" onClick={() => go(page + 1)} disabled={page >= pages} aria-label="Page suivante">
            <IconChevron />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost btn-icon h-8 text-lg" onClick={() => setZoom(ZOOMS[Math.max(0, zi - 1)])} disabled={zi <= 0} aria-label="Dézoomer">
            −
          </button>
          <button className="btn btn-ghost h-8 w-16 px-0 text-[13px] tabular-nums" onClick={() => setZoom(1)} title="Ajuster à la largeur">
            {Math.round(zoom * 100)} %
          </button>
          <button
            className="btn btn-ghost btn-icon h-8 text-lg"
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)])}
            disabled={zi >= ZOOMS.length - 1}
            aria-label="Zoomer"
          >
            +
          </button>
        </div>
      </div>

      <div ref={box} className="w-full overflow-auto rounded-lg border border-line bg-sunken">
        {width > 0 && (
          <Document
            file={url}
            onLoadSuccess={({ numPages }) => {
              setPages(numPages);
              if (page > numPages) go(numPages);
            }}
            loading={<p className="p-6 text-ink-2">Chargement du PDF…</p>}
            error={<p className="p-6 text-danger">Impossible d&apos;afficher ce PDF. Téléchargez-le pour l&apos;ouvrir.</p>}
          >
            <div className="pdf-page mx-auto w-fit">
              <Page pageNumber={page} width={Math.max(200, width * zoom)} loading={<div style={{ height: width * 1.3 }} />} />
            </div>
          </Document>
        )}
      </div>
    </div>
  );
}
