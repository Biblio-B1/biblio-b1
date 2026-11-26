// Rôles des comptes. « delegate » (délégué·e) : modère devoirs, contrôles, documents et
// signalements pour la classe, sans les droits d'administration (comptes, matières, rôles).
export type Role = "admin" | "delegate" | "member";

/** Administrateur ou délégué(e) : peut modérer le contenu de toute la classe. */
export function isModerator(role: string | null | undefined): boolean {
  return role === "admin" || role === "delegate";
}

export const ROLE_BADGE: Partial<Record<Role, string>> = { admin: "Admin", delegate: "Délégué(e)" };
