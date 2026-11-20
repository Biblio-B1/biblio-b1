"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/search/CommandPalette";
import { IconMenu, IconSearch, IconUpload } from "./Icons";
import { MENU_EVENT } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

/** Barre du haut : menu (mobile), recherche globale (palette, Ctrl/Cmd K), dépôt, thème. */
export function TopBar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Rechercher"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        className="relative flex h-9 min-w-0 flex-1 items-center rounded-md border border-line bg-surface pr-3 pl-8 text-left text-[14px] text-ink-3 md:max-w-md"
      >
        <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" size={16} />
        <span className="truncate">Rechercher…</span>
        <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line px-1.5 font-mono text-[11px] sm:block">
          Ctrl K
        </kbd>
      </button>
      <CommandPalette open={open} onOpenChange={setOpen} />
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
