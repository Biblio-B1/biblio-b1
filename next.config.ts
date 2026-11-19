import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2", "pdfjs-dist"],
};

export default nextConfig;
