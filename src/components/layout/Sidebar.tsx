"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { UNCLASSIFIED_SLUG, subjectHref } from "@/lib/routes";
import { Spine } from "./Spine";
import { IconBooks, IconCalendar, IconCheckList, IconClose, IconExam, IconHome, IconHomework, IconMail, IconPen, IconSettings, IconUpload, IconUsers } from "./Icons";

export type SidebarSubject = { slug: string; name: string; color: string; count: number };

export const MENU_EVENT = "bb1:menu";
/** Ferme le menu du téléphone (fin d'une étape du tutoriel). */
export const MENU_CLOSE_EVENT = "bb1:menu-close";

type Props = {
  subjects: SidebarSubject[];
  unclassified: number;
  /** null : visiteur sans compte (bibliothèque publique seulement). */
  user: { name: string; role: "admin" | "member" } | null;
  /** Demandes de compte en attente (administrateur uniquement). */
  pendingUsers?: number;
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

function SidebarContent({ subjects, unclassified, user, pendingUsers = 0 }: Props) {
  const pathname = usePathname();
  const slug = useSearchParams().get("slug");
  const { signOut } = useAuth();
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
            <NavLink href="/timetable" active={is("/timetable")}>
              <IconCalendar /> Emploi du temps
            </NavLink>
            <NavLink href="/devoirs" active={pathname === "/devoirs" || pathname.startsWith("/devoirs/")}>
              <IconHomework /> Devoirs
            </NavLink>
            <NavLink href="/controles" active={is("/controles")}>
              <IconExam /> Contrôles
            </NavLink>
            <NavLink href="/annuaire" active={is("/annuaire")}>
              <IconMail /> Annuaire
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
          <NavLink key={s.slug} href={subjectHref(s.slug)} active={pathname === "/library/subject" && slug === s.slug}>
            <Spine color={s.color} />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="text-[12.5px] text-ink-3 tabular-nums">{s.count || ""}</span>
          </NavLink>
        ))}
        {unclassified > 0 && (
          <NavLink href={subjectHref(UNCLASSIFIED_SLUG)} active={pathname === "/library/subject" && slug === UNCLASSIFIED_SLUG}>
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
          <NavLink href="/admin/users" active={is("/admin/users")}>
            <IconUsers /> <span className="flex-1">Demandes de compte</span>
            {pendingUsers > 0 && (
              <span
                aria-label={`${pendingUsers} en attente`}
                className="rounded-full bg-primary px-1.5 text-[12px] leading-5 font-semibold text-on-primary tabular-nums"
              >
                {pendingUsers}
              </span>
            )}
          </NavLink>
          <NavLink href="/admin/reports" active={is("/admin/reports")}>
            <IconCheckList /> Signalements
          </NavLink>
        </nav>
      )}

      {user ? (
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-2 pt-3 text-sm">
        <Link href="/settings" className="flex min-w-0 items-center gap-1.5 text-ink-2 hover:text-ink" title="Paramètres du compte">
          <IconSettings size={16} />
          <span className="truncate">{user.name}</span>
        </Link>
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-[13px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
        >
          Se déconnecter
        </button>
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

/** Glissement vers la gauche au-delà duquel le menu se ferme (fraction de sa largeur). */
const CLOSE_RATIO = 0.3;

export function Sidebar(props: Props) {
  const [open, setOpen] = useState(false);
  // Décalage du menu pendant qu'on le fait glisser du doigt (≤ 0), null sinon.
  const [drag, setDrag] = useState<number | null>(null);
  const touch = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onMenu = () => setOpen(true);
    const onClose = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener(MENU_EVENT, onMenu);
    window.addEventListener(MENU_CLOSE_EVENT, onClose);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(MENU_EVENT, onMenu);
      window.removeEventListener(MENU_CLOSE_EVENT, onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Menu ouvert : la page derrière ne défile plus.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = before;
    };
  }, [open]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, t: e.timeStamp, axis: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = touch.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // On décide une fois le sens du geste : horizontal = on tire le menu, vertical = on fait défiler.
    if (!s.axis && Math.hypot(dx, dy) > 8) s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (s.axis === "x") setDrag(Math.min(0, dx));
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s || s.axis !== "x" || drag === null) return setDrag(null);
    const width = panel.current?.offsetWidth ?? 288;
    const speed = drag / Math.max(1, e.timeStamp - s.t); // px/ms, négatif vers la gauche
    if (drag < -width * CLOSE_RATIO || speed < -0.5) setOpen(false);
    setDrag(null);
  };

  const dragging = drag !== null;
  const width = panel.current?.offsetWidth ?? 288;
  const shown = open ? 1 + (drag ?? 0) / width : 0;

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 overflow-y-auto border-r border-line bg-bg md:block">
        <SidebarContent {...props} />
      </aside>
      <div
        className={`fixed inset-0 z-40 md:hidden ${open ? "" : "pointer-events-none"}`}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
        inert={!open}
      >
        <button
          aria-label="Fermer le menu"
          tabIndex={-1}
          className={`absolute inset-0 bg-black/40 ${dragging ? "" : "transition-opacity duration-200 motion-reduce:transition-none"}`}
          style={{ opacity: shown }}
          onClick={() => setOpen(false)}
        />
        <aside
          ref={panel}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => {
            touch.current = null;
            setDrag(null);
          }}
          className={`absolute inset-y-0 left-0 w-[min(18rem,85vw)] touch-pan-y overflow-y-auto overscroll-contain border-r border-line bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-xl ${
            dragging ? "" : "transition-transform duration-200 ease-out motion-reduce:transition-none"
          }`}
          style={{ transform: open ? `translateX(${drag ?? 0}px)` : "translateX(-100%)" }}
        >
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
    </>
  );
}
