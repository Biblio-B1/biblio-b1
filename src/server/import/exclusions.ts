/**
 * Règles d'exclusion de l'import : ce qui n'a rien à voir avec les cours (captures de films,
 * logos, artefacts de compilation, versions archivées en double). Données pures, partagées par
 * le scan (dossier + zip) et la commande de nettoyage (`npm run prune`).
 *
 * Les motifs sont testés sur du texte normalisé (minuscules, sans accents). Une image décorative
 * est exclue, une image de formule (trigo.png...) est gardée.
 */

/** Nom d'un dossier (un segment du chemin), normalisé. */
export const EXCLUDED_DIR_PATTERNS: RegExp[] = [
  /^\.git$/i,
  /^bin$/i,
  /^obj$/i,
  /^node_modules$/i,
  /^000_template$/i,
  /^__macosx$/i,
  /^cmakefiles$/i,
  /^cmake-build-/i, // cmake-build-debug, cmake-build-release...
  /^\.idea$/i,
  /^\.vscode$/i,
  /_files$/i, // pages web enregistrées
  // Anciennes versions d'un cours dont une version plus récente existe à côté.
  /^version[\s_-]*archives?$/i,
  /^(old|anciennes?)[\s_-]*versions?$/i,
];

/** Chemin relatif complet (séparateur « / »), normalisé. */
export const EXCLUDED_FILE_PATTERNS: RegExp[] = [
  // Captures d'écran de films (devoir « Spirited Away »...) : sans rapport avec le cours.
  /netflix/i,
  // Logos et icônes (images seulement : « logigramme » ne correspond pas).
  /(^|\/)[^/]*(?<![a-z])(logos?|icons?|icones?|favicon)(?![a-z])[^/]*\.(png|jpe?g|webp|gif|svg)$/i,
  // Artefacts de génération CMake / CLion.
  /(^|\/)cmakelists\.txt$/i,
  /(^|\/)cmakecache\.txt$/i,
  /(^|\/)cmake_install\.cmake$/i,
  /(^|\/)targetdirectories\.txt$/i,
  /(^|\/)clion-[a-z-]+\.txt$/i,
  /(^|\/)jps\.txt$/i,
  // Fichiers de dépôt à la racine.
  /^(license|licence|readme)(\.[a-z]+)?$/i,
];

const norm = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Vrai si le nom d'un dossier est exclu. */
export function isExcludedDirName(name: string): boolean {
  const n = norm(name);
  return EXCLUDED_DIR_PATTERNS.some((re) => re.test(n));
}

/** Vrai si le chemin relatif (fichier) est exclu, par son nom ou par l'un de ses dossiers. */
export function isExcludedPath(relPath: string): boolean {
  const p = norm(relPath.replace(/\\/g, "/"));
  const parts = p.split("/").filter(Boolean);
  if (parts.slice(0, -1).some((d) => EXCLUDED_DIR_PATTERNS.some((re) => re.test(d)))) return true;
  return EXCLUDED_FILE_PATTERNS.some((re) => re.test(p));
}
