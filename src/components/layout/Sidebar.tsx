"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { Spine } from "./Spine";
import { IconBooks, IconCheckList, IconClose, IconHome, IconPen, IconSettings, IconUpload, IconUsers } from "./Icons";

export type SidebarSubject = { slug: string; name: string; color: string; count: number };

export const MENU_EVENT = "bb1:menu";

type Props = {
  subjects: SidebarSubject[];
  unclassified: number;
  /** null : visiteur sans compte (bibliothèque publique seulement). */
  user: { name: string; role: "admin" | "member" } | null;
};

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex h-8 items-center gap-2.5 rounded-md px-2 text-[14px] transition-colors ${
        active ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:bg-sunken hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function SidebarContent({ subjects, unclassified, user }: Props) {
  const pathname = usePathname();
  const is = (p: string) => pathname === p;
  return (
    <div className="flex h-full flex-col gap-6 px-3 py-4">
      <Link href="/" className="flex items-center gap-2.5 px-2 text-[15px] font-semibold tracking-[-0.01em]">
        <span aria-hidden className="flex h-5 items-end gap-[2px]">
          {subjects.slice(0, 5).map((s, i) => (
            <span key={s.slug} className="w-[3px] rounded-[1px]" style={{ background: s.color, height: `${12 + ((i * 5) % 9)}px` }} />
          ))}
        </span>
        Biblio B1
      </Link>

      <nav className="flex flex-col gap-0.5" aria-label="Navigation principale">
        {user && (
          <NavLink href="/" active={is("/")}>
            <IconHome /> Tableau de bord
          </NavLink>
        )}
        <NavLink href="/library" active={is("/library")}>
          <IconBooks /> Bibliothèque
        </NavLink>
        {user && (
          <>
            <NavLink href="/training" active={pathname === "/training" || pathname.startsWith("/training/")}>
              <IconCheckList /> Entraînement
            </NavLink>
            <NavLink href="/upload" active={is("/upload")}>
              <IconUpload /> Déposer des fichiers
            </NavLink>
            <NavLink href="/notes/new" active={is("/notes/new")}>
              <IconPen /> Nouvelle fiche
            </NavLink>
          </>
        )}
      </nav>

      <nav className="flex flex-col gap-0.5" aria-label="Matières">
        <p className="px-2 pb-1 text-[12.5px] font-medium text-ink-3">Matières</p>
        {subjects.map((s) => (
          <NavLink key={s.slug} href={`/library/${s.slug}`} active={pathname === `/library/${s.slug}`}>
            <Spine color={s.color} />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="text-[12.5px] text-ink-3 tabular-nums">{s.count || ""}</span>
          </NavLink>
        ))}
        {unclassified > 0 && (
          <NavLink href="/library/sans-matiere" active={pathname === "/library/sans-matiere"}>
            <Spine color={null} />
            <span className="flex-1">Sans matière</span>
            <span className="text-[12.5px] text-ink-3 tabular-nums">{unclassified}</span>
          </NavLink>
        )}
      </nav>

      {user?.role === "admin" && (
        <nav className="flex flex-col gap-0.5" aria-label="Administration">
          <p className="px-2 pb-1 text-[12.5px] font-medium text-ink-3">Administration</p>
          <NavLink href="/admin/subjects" active={is("/admin/subjects")}>
            <IconSettings /> Matières et règles
          </NavLink>
          <NavLink href="/admin/invites" active={is("/admin/invites")}>
            <IconUsers /> Invitations
          </NavLink>
          <NavLink href="/admin/reports" active={is("/admin/reports")}>
            <IconCheckList /> Signalements
          </NavLink>
        </nav>
      )}

      {user ? (
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-2 pt-3 text-sm">
        <span className="truncate text-ink-2" title={user.name}>
          {user.name}
        </span>
        <form action={logoutAction}>
          <button className="text-[13px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">Se déconnecter</button>
        </form>
      </div>
      ) : (
        <div className="mt-auto border-t border-line px-2 pt-3 text-sm">
          <Link href="/login" className="text-ink-2 underline-offset-2 hover:text-ink hover:underline">
            Se connecter
          </Link>
          <p className="mt-1 text-[12.5px] text-ink-3">Entraînement, dépôt et questions réservés aux membres.</p>
        </div>
      )}
    </div>
  );
}

export function Sidebar(props: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onMenu = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener(MENU_EVENT, onMenu);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(MENU_EVENT, onMenu);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 overflow-y-auto border-r border-line bg-bg md:block">
        <SidebarContent {...props} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button aria-label="Fermer le menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[min(18rem,85vw)] overflow-y-auto border-r border-line bg-bg shadow-xl">
            <button
              onClick={() => setOpen(false)}
              className="btn btn-ghost btn-icon absolute top-3 right-3"
              aria-label="Fermer le menu"
            >
              <IconClose />
            </button>
            <SidebarContent {...props} />
          </aside>
        </div>
      )}
    </>
  );
}
