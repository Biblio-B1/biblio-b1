"use client";

// Téléphone : barre de navigation fixée en bas de l'écran (pouce), en plus du menu ☰ du haut.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconBooks, IconCalendar, IconHome, IconMail, IconUpload } from "./Icons";

type Item = { href: string; label: string; icon: typeof IconHome; active: (path: string) => boolean };

const ITEMS: Item[] = [
  { href: "/", label: "Accueil", icon: IconHome, active: (p) => p === "/" },
  { href: "/library", label: "Bibliothèque", icon: IconBooks, active: (p) => p.startsWith("/library") || p.startsWith("/doc") },
  { href: "/timetable", label: "Emploi du temps", icon: IconCalendar, active: (p) => p.startsWith("/timetable") },
  { href: "/annuaire", label: "Annuaire", icon: IconMail, active: (p) => p.startsWith("/annuaire") },
  { href: "/upload", label: "Déposer", icon: IconUpload, active: (p) => p.startsWith("/upload") },
];

export function BottomNav() {
  const raw = usePathname() || "/";
  const path = raw.length > 1 ? raw.replace(/\/$/, "") : raw;
  return (
    <nav
      aria-label="Navigation rapide"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid h-16 grid-cols-5">
        {ITEMS.map(({ href, label, icon: Icon, active }) => {
          const on = active(path);
          return (
            <li key={href} className="min-w-0">
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-1 px-0.5 text-[11px] leading-tight transition-colors ${
                  on ? "font-semibold text-ink" : "text-ink-3 active:text-ink"
                }`}
              >
                <span
                  className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${on ? "bg-sunken text-ink" : ""}`}
                  aria-hidden
                >
                  <Icon size={20} />
                </span>
                <span className="max-w-full text-center break-words hyphens-auto">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
