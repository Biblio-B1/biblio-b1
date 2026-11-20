import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/server/db/client";
import { documents, exercises } from "@/server/db/schema";
import { enqueueCheck } from "@/server/checks";
import { readSolverStatus } from "@/server/solver/status";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-status-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("solver:status (lecture seule)", () => {
  it("base absente : message clair, aucun fichier créé", () => {
    const f = path.join(dir, "absente", "data.db");
    const r = readSolverStatus(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Base introuvable/);
    expect(fs.existsSync(f)).toBe(false);
    expect(fs.existsSync(path.dirname(f))).toBe(false);
  });

  it("compte par statut sans modifier le fichier", () => {
    const db = createTestDb();
    const doc = db
      .insert(documents)
      .values({ title: "d", type: "exercise", filePath: "f", mime: "application/pdf", sha256: "s", source: "upload", text: "" })
      .returning()
      .get();
    const mk = (n: number) =>
      db.insert(exercises).values({ documentId: doc.id, number: n, title: `t${n}`, statement: "s", groupKey: `g${n}` }).returning().get().id;
    enqueueCheck(db, mk(1));
    mk(2); // sans ligne
    const f = path.join(dir, "data.db");
    db.$client.pragma("journal_mode = DELETE");
    fs.writeFileSync(f, db.$client.serialize());
    const before = fs.readFileSync(f);
    const r = readSolverStatus(f);
    expect(r).toMatchObject({ ok: true, counts: { pending: 1, missing: 1, total: 2, ready: 0 } });
    expect(fs.readFileSync(f).equals(before)).toBe(true);
    expect(fs.existsSync(`${f}-wal`)).toBe(false);
  });

  it("base sans tables : message clair", () => {
    const f = path.join(dir, "vide.db");
    fs.writeFileSync(f, "");
    const r = readSolverStatus(f);
    expect(r.ok).toBe(false);
  });
});
