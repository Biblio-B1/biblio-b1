import { describe, expect, it } from "vitest";
import { createTestDb } from "@/server/db/client";
import { documents } from "@/server/db/schema";

const TABLES = [
  "users", "sessions", "boostcamp_calendar_links", "invites", "subjects", "documents",
  "exercises", "progress", "threads", "posts", "homeworks", "search_index",
];

describe("createTestDb", () => {
  it("crée toutes les tables", () => {
    const db = createTestDb();
    const rows = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of TABLES) expect(names).toContain(t);
  });

  it("active les clés étrangères", () => {
    const db = createTestDb();
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("indexe un document dans FTS5 et le retrouve par MATCH", () => {
    const db = createTestDb();
    const [doc] = db
      .insert(documents)
      .values({
        title: "Les pointeurs en C",
        type: "course",
        filePath: "uploads/x.pdf",
        mime: "application/pdf",
        sha256: "abc123",
        text: "Un pointeur contient une adresse mémoire.",
        source: "upload",
      })
      .returning()
      .all();
    db.$client
      .prepare(
        "INSERT INTO search_index (kind, ref_id, title, body, subject_id, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("document", doc.id, doc.title, doc.text, "", "", String(Date.now()));
    const hits = db.$client
      .prepare("SELECT ref_id FROM search_index WHERE search_index MATCH 'pointeur'")
      .all();
    expect(hits).toHaveLength(1);
  });
});
