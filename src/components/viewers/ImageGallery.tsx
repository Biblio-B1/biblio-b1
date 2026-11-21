"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IconChevron, IconExpand } from "@/components/layout/Icons";
import { docHref } from "@/lib/routes";

export type GalleryImage = { id: string; src: string; title: string };

const MIN = 1;
const MAX = 6;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Galerie : zoom molette / pincement / double-clic, déplacement par glisser
 * quand zoomé, plein écran, flèches pour les autres photos de la matière.
 */
export function ImageGallery({ images, initialId }: { images: GalleryImage[]; initialId: string }) {
  const [index, setIndex] = useState(Math.max(0, images.findIndex((i) => i.id === initialId)));
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const img = images[index];

  const reset = () => setView({ scale: 1, x: 0, y: 0 });
  const go = (d: number) => {
    setIndex((i) => (i + d + images.length) % images.length);
    reset();
  };

  // Molette : listener non passif pour pouvoir empêcher le défilement de la page.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const scale = clamp(v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), MIN, MAX);
        return scale === 1 ? { scale, x: 0, y: 0 } : { ...v, scale };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (images.length < 2) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinch.current = { dist: dist(), scale: view.scale };
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const scale = clamp((pinch.current.scale * dist()) / pinch.current.dist, MIN, MAX);
      setView((v) => (scale === 1 ? { scale, x: 0, y: 0 } : { ...v, scale }));
    } else if (pointers.current.size === 1 && view.scale > 1) {
      setView((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function fullscreen() {
    const el = stage.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }

  if (!img) return null;

  return (
    <div className="flex flex-col gap-2 bg-bg [&:fullscreen]:justify-center [&:fullscreen]:p-4">
      <div
        ref={stage}
        className="relative flex h-[min(75vh,48rem)] touch-none items-center justify-center overflow-hidden rounded-lg border border-line bg-sunken select-none [:fullscreen_&]:h-[calc(100dvh-5rem)]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => (view.scale > 1 ? reset() : setView({ scale: 2.5, x: 0, y: 0 }))}
        style={{ cursor: view.scale > 1 ? "grab" : "zoom-in" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.src}
          alt={img.title}
          draggable={false}
          className="max-h-full max-w-full object-contain"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: pointers.current.size ? "none" : "transform 120ms ease-out",
          }}
        />
        {images.length > 1 && (
          <>
            <button
              className="btn btn-icon absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-surface/90"
              onClick={() => go(-1)}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Photo précédente"
            >
              <IconChevron dir="left" />
            </button>
            <button
              className="btn btn-icon absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-surface/90"
              onClick={() => go(1)}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Photo suivante"
            >
              <IconChevron />
            </button>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 text-[13.5px] text-ink-2">
        <span className="min-w-0 flex-1 truncate">
          {images.length > 1 ? (
            <>
              <span className="tabular-nums">
                {index + 1} / {images.length}
              </span>
              {img.id !== initialId && (
                <>
                  {" "}
                  <Link href={docHref(img.id)} className="underline underline-offset-2">
                    {img.title}
                  </Link>
                </>
              )}
            </>
          ) : (
            "Molette, pincement ou double-clic pour zoomer"
          )}
        </span>
        <button className="btn btn-ghost h-8 px-2 text-[13px] tabular-nums" onClick={reset} disabled={view.scale === 1}>
          {Math.round(view.scale * 100)} %
        </button>
        <button className="btn btn-ghost btn-icon h-8" onClick={fullscreen} aria-label="Plein écran">
          <IconExpand />
        </button>
      </div>
    </div>
  );
}
