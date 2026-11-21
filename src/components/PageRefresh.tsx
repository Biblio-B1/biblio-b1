"use client";

// Rechargement des données d'une page client après une action (remplace router.refresh(), qui ne
// relit rien quand les données viennent de Supabase côté navigateur).
import { createContext, useContext } from "react";

const PageRefreshContext = createContext<() => void>(() => {});

export const PageRefreshProvider = PageRefreshContext.Provider;

/** Même forme que le routeur Next (`refresh()`), pour remplacer router.refresh() sans autre changement. */
export function usePageRefresh(): { refresh: () => void } {
  return { refresh: useContext(PageRefreshContext) };
}
