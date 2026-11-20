/**
 * Exécuté une fois au démarrage du serveur Next.js (pas pendant `next build`) : une configuration
 * invalide ou refusée en production fait échouer le démarrage avec un message en français.
 * (`npm start` valide déjà avant de lancer Next, cf. scripts/start.mjs ; ceci couvre `next start`
 * lancé directement et `next dev`.)
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv } = await import("./server/env");
  try {
    validateEnv(process.env);
  } catch (e) {
    console.error(`\n[biblio-b1] ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
