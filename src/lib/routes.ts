// Adresses des pages à identifiant : paramètres de requête, car l'export statique (github.io)
// ne génère pas de page par document ni par matière.
export const UNCLASSIFIED_SLUG = "sans-matiere";

export const docHref = (id: string) => `/doc?id=${encodeURIComponent(id)}`;
export const subjectHref = (slug: string) => `/library/subject?slug=${encodeURIComponent(slug)}`;
export const exerciseHref = (id: string) => `/training/exercise?id=${encodeURIComponent(id)}`;
