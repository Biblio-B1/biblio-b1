// Versions des moteurs WebAssembly servis au navigateur. Elles font partie de l'URL
// (/runtimes/<moteur>/<version>/…) : ces fichiers peuvent donc être mis en cache « immutable »
// (next.config.ts) et une mise à jour change d'URL. Doivent correspondre aux versions installées
// (épinglées dans package.json) : scripts/copy-runtimes.mjs refuse sinon, et un test le vérifie.
// Fichier importé tel quel par Node (copy-runtimes.mjs, « type stripping ») : aucun import.

export const RUNTIME_VERSIONS = {
  clang: "22.0.0-git20695-13",
  pyodide: "314.0.8",
} as const;

export type RuntimeName = keyof typeof RUNTIME_VERSIONS;

/** Chemin public d'un moteur, sans barre finale : `/runtimes/clang/22.0.0-…`. */
export function runtimePath(name: RuntimeName, base = "/runtimes"): string {
  return `${base.replace(/\/$/, "")}/${name}/${RUNTIME_VERSIONS[name]}`;
}
