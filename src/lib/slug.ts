/** Minuscule, sans accents, espaces réduits (mots-clés de classement). */
export function normalizeKeyword(k: string): string {
  return k.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function slugify(name: string): string {
  return (
    normalizeKeyword(name)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "matiere"
  );
}
