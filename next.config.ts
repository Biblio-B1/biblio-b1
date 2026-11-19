import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2", "pdfjs-dist", "mammoth"],
  webpack: (config, { dev }) => {
    if (dev) {
      // Les fichiers déposés (storage/) et les sorties d'outils ne doivent pas relancer la compilation.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/node_modules/**", "**/.git/**", "**/storage/**", "**/.playwright-mcp/**"],
      };
    }
    return config;
  },
  experimental: {
    // Uploads : un fichier (50 Mo max) par appel de server action, plus la marge multipart.
    serverActions: { bodySizeLimit: "52mb" },
    // Le middleware tronque sinon les corps de requête au-delà de 10 Mo.
    middlewareClientMaxBodySize: "52mb",
  },
};

export default nextConfig;
