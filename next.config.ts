import type { NextConfig } from "next";

// Site exporté en pages statiques (dossier out/) pour GitHub Pages : https://biblio-b1.github.io/biblio-b1/
// NEXT_PUBLIC_BASE_PATH = "/biblio-b1" au build Pages (workflow), vide en local (npm run dev).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  // GitHub Pages sert /page/index.html : adresses avec « / » final.
  trailingSlash: true,
  images: { unoptimized: true },
  // Préfixe toujours défini, y compris dans les workers (moteurs d'exécution, pdf.js).
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  webpack: (config, { dev }) => {
    if (dev) {
      // Les fichiers locaux (storage/, outils) ne doivent pas relancer la compilation.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/node_modules/**", "**/.git/**", "**/storage/**", "**/.playwright-mcp/**"],
      };
    }
    return config;
  },
};

export default nextConfig;
