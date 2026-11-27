// Rôles des comptes. « delegate » (délégué·e) : modère devoirs, contrôles, documents et
// signalements pour la classe, sans les droits d'administration (comptes, matières, rôles).
// « guest » (invité) : connexion anonyme depuis la page de connexion, lecture seule (RLS).
export type Role = "admin" | "delegate" | "member" | "guest";

/** Administrateur ou délégué(e) : peut modérer le contenu de toute la classe. */
export function isModerator(role: string | null | undefined): boolean {
  return role === "admin" || role === "delegate";
}

export const ROLE_BADGE: Partial<Record<Role, string>> = { admin: "Admin", delegate: "Délégué(e)", guest: "Invité" };

/** Message affiché quand un invité tente d'ajouter, modifier ou supprimer quelque chose. */
export const GUEST_READ_ONLY = "Mode invité : consultation uniquement. Créez un compte pour ajouter ou supprimer.";
