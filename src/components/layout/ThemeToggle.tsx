"use client";

import { THEME_COOKIE } from "@/lib/labels";

/** Bascule clair/sombre en un clic ; mémorisé en cookie (lu côté serveur : pas de flash). */
export function ThemeToggle() {
  function toggle() {
    const dark = document.documentElement.classList.toggle("dark");
    document.cookie = `${THEME_COOKIE}=${dark ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-ghost btn-icon"
      aria-label="Basculer le thème clair / sombre"
      title="Thème clair / sombre"
    >
      {/* Soleil en mode sombre, lune en mode clair (pur CSS, pas d'état à hydrater). */}
      <svg className="hidden dark:block" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg className="block dark:hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
    </button>
  );
}
