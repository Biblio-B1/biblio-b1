"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/search/CommandPalette";
import { IconMenu, IconSearch, IconUpload } from "./Icons";
import { MENU_EVENT } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Barre du haut : menu (mobile), recherche globale (palette, Ctrl/Cmd K), dépôt, thème.
 * Sans compte : recherche par titre dans la bibliothèque publique et lien de connexion.
 */
export function TopBar({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [signedIn]);

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
{signedIn ? (
        <>
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
        </>
      ) : (
        <form action="/library" role="search" className="relative flex h-9 min-w-0 flex-1 items-center md:max-w-md">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" size={16} />
          <input
            name="q"
            type="search"
            aria-label="Rechercher un document par titre"
            placeholder="Rechercher un document…"
            className="input h-9 w-full pl-8 text-[14px]"
          />
        </form>
      )}
      <div className="ml-auto flex items-center gap-1">
        {signedIn ? (
          <Link href="/upload" className="btn btn-primary" aria-label="Déposer des fichiers">
            <IconUpload size={16} />
            <span className="hidden sm:inline">Déposer</span>
          </Link>
        ) : (
          <Link href="/login" className="btn btn-primary">
            Se connecter
          </Link>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
