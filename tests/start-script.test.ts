import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const START = path.resolve(import.meta.dirname, "../scripts/start.mjs");

describe("scripts/start.mjs", () => {
  it("configuration de production refusée : sort en code 1 avec le message français, sans lancer Next", () => {
    // Dossier vide comme répertoire de travail : aucun .env du dépôt n'est chargé.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-start-"));
    try {
      const r = spawnSync(process.execPath, [START], {
        cwd,
        env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, NODE_ENV: "production", ADMIN_INVITE_CODE: "change-me", PORT: "3999" },
        encoding: "utf8",
        timeout: 20_000,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Configuration de production refusée : ADMIN_INVITE_CODE/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
