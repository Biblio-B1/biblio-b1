/** Règles de classement automatique d'une matière (partagées par le site et les scripts du PC). */
export type SubjectRules = {
  /** Expressions régulières (insensibles à la casse et aux accents) testées sur le chemin et le nom. */
  pathPatterns: string[];
  /** Mot-clé (sans accent, minuscule) -> poids. */
  keywords: Record<string, number>;
};
