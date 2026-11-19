import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";

/**
 * Synchronise un dépôt git dans `dest` : `clone --depth 1` s'il est absent, sinon mise à jour
 * (fetch --depth 1 puis alignement sur la branche distante ; le clone n'est jamais modifié à la main).
 * Lève en cas d'échec réseau : l'appelant décide de continuer avec le clone existant.
 */
export async function syncRepo(url: string, dest: string): Promise<void> {
  const abs = path.resolve(dest);
  if (fs.existsSync(path.join(abs, ".git"))) {
    const git = simpleGit(abs);
    await git.fetch(["--depth", "1", "origin"]);
    await git.reset(["--hard", "FETCH_HEAD"]);
    return;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (fs.existsSync(abs) && fs.readdirSync(abs).length > 0) {
    throw new Error(`Le dossier ${abs} existe et n'est pas un dépôt git.`);
  }
  await simpleGit().clone(url, abs, ["--depth", "1"]);
}
