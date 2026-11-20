import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
  createHomework,
  deleteHomework,
  isEnglishSubject,
  listHomeworks,
  MAX_HOMEWORK_ATTACHMENT_BYTES,
} from "@/server/homeworks";
import { listSubjects, seedSubjects } from "@/server/subjects";

let root: string;
let db: Db;
let userA: string;
let userB: string;

function mkUser(name: string) {
  return db.insert(users).values({ name, email: `${name}@test.fr`, passwordHash: "x" }).returning().get().id;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-hw-"));
  db = createTestDb();
  seedSubjects(db);
  userA = mkUser("alice");
  userB = mkUser("bob");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("homeworks", () => {
  it("crée un devoir visible par tous, trié par date de rendu", () => {
    const subjects = listSubjects(db);
    const dataSub = subjects.find((s) => s.slug === "infra-data")!;
    const cSub = subjects.find((s) => s.slug === "algorithmique-et-prog-c")!;

    createHomework(db, { subjectId: cSub.id, title: "TP pointeurs", dueDate: "2026-11-26" }, userA, root);
    createHomework(db, { subjectId: dataSub.id, title: "Schéma ETL", dueDate: "2026-11-24" }, userB, root);

    const list = listHomeworks(db);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ subjectSlug: "infra-data", title: "Schéma ETL", dueDate: "2026-11-24", authorName: "bob" });
    expect(list[1]).toMatchObject({ subjectSlug: "algorithmique-et-prog-c", title: "TP pointeurs", dueDate: "2026-11-26", authorName: "alice" });
  });

  it("exige un groupe quand la matière est l'anglais", () => {
    const enSub = listSubjects(db).find((s) => isEnglishSubject(s))!;
    expect(() =>
      createHomework(db, { subjectId: enSub.id, title: "Essay", dueDate: "2026-11-25" }, userA, root),
    ).toThrow(/groupe/i);

    const created = createHomework(
      db,
      { subjectId: enSub.id, title: "Essay", dueDate: "2026-11-25", englishGroup: "Intermédiaire Gr1" },
      userA,
      root,
    );
    expect(created.englishGroup).toBe("Intermédiaire Gr1");
  });

  it("enregistre une pièce jointe <= 30 Mo, refuse > 30 Mo et supprime le fichier à la suppression", () => {
    const cSub = listSubjects(db).find((s) => s.slug === "algorithmique-et-prog-c")!;

    expect(() =>
      createHomework(
        db,
        {
          subjectId: cSub.id,
          title: "Trop gros",
          dueDate: "2026-11-25",
          attachment: { buf: Buffer.alloc(MAX_HOMEWORK_ATTACHMENT_BYTES + 1), originalName: "gros.pdf" },
        },
        userA,
        root,
      ),
    ).toThrow(/30 Mo/);

    const hw = createHomework(
      db,
      {
        subjectId: cSub.id,
        title: "Avec PJ",
        dueDate: "2026-11-25",
        attachment: { buf: Buffer.from("contenu pdf"), originalName: "sujet.pdf" },
      },
      userA,
      root,
    );
    expect(hw.attachmentName).toBe("sujet.pdf");
    expect(hw.attachmentPath).toBeTruthy();
    const abs = path.resolve(root, hw.attachmentPath!);
    expect(fs.existsSync(abs)).toBe(true);

    deleteHomework(db, hw.id, root);
    expect(listHomeworks(db)).toHaveLength(0);
    expect(fs.existsSync(abs)).toBe(false);
  });

  it("refuse une date invalide ou une matière inconnue", () => {
    const cSub = listSubjects(db).find((s) => s.slug === "algorithmique-et-prog-c")!;
    expect(() => createHomework(db, { subjectId: cSub.id, title: "X", dueDate: "2026-02-30" }, userA, root)).toThrow(/Date/);
    expect(() => createHomework(db, { subjectId: "unknown", title: "X", dueDate: "2026-11-24" }, userA, root)).toThrow(/Matière/);
  });
});
