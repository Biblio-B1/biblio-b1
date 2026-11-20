// `npm start` : charge .env, valide la configuration, puis lance `next start` sur PORT
// (Next lit sinon le port avant .env). Une configuration refusée fait sortir en code 1, avant
// de lancer Next : systemd (Restart=on-failure) voit l'échec.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import nextEnv from "@next/env";
import { parseEnv } from "../src/server/env-schema.mjs";

nextEnv.loadEnvConfig(process.cwd(), false);
// `next start` force NODE_ENV=production : on valide avec les mêmes règles.
process.env.NODE_ENV ??= "production";
try {
  parseEnv({ ...process.env, NODE_ENV: "production" });
} catch (e) {
  console.error(`\n[biblio-b1] ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}

const port = process.env.PORT || "3000";
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "start", "-p", port], { stdio: "inherit", env: process.env });
let forwarded = null;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    forwarded = sig;
    child.kill(sig);
  });
}
child.on("exit", (code, signal) => {
  // Arrêt demandé (systemctl stop, Ctrl+C) : sortie normale, même si Next meurt du signal relayé.
  if (forwarded && (signal === forwarded || code === 0 || code === 130 || code === 143)) process.exit(0);
  process.exit(code ?? (signal ? 1 : 0));
});
