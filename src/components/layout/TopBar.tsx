"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { IconMenu, IconSearch, IconUpload } from "./Icons";
import { MENU_EVENT } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Barre du haut : menu (mobile), recherche (Ctrl K), dépôt, thème.
 * La recherche filtre pour l'instant les titres de la bibliothèque ;
 * la palette FTS5 (Task 9) remplacera ce comportement.
 */
export function TopBar() {
  const input = useRef<HTMLInputElement>(null);
  const q = useSearchParams().get("q") ?? "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/90 px-3 backdrop-blur md:px-6">
      <button
        type="button"
        className="btn btn-ghost btn-icon md:hidden"
        aria-label="Ouvrir le menu"
        onClick={() => window.dispatchEvent(new Event(MENU_EVENT))}
      >
        <IconMenu />
      </button>
      <form action="/library" role="search" className="relative min-w-0 flex-1 md:max-w-md">
        <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" size={16} />
        <input
          ref={input}
          key={q}
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Rechercher…"
          aria-label="Rechercher un document"
          aria-keyshortcuts="Control+K"
          className="h-9 w-full rounded-md border border-line bg-surface pr-3 pl-8 text-[14px] placeholder:text-ink-3 sm:pr-14"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line px-1.5 font-mono text-[11px] text-ink-3 sm:block">
          Ctrl K
        </kbd>
      </form>
      <div className="ml-auto flex items-center gap-1">
        <Link href="/upload" className="btn btn-primary" aria-label="Déposer des fichiers">
          <IconUpload size={16} />
          <span className="hidden sm:inline">Déposer</span>
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
