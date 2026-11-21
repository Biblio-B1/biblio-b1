import { beforeAll, describe, expect, it } from "vitest";
import { createRlsDb, type RlsDb } from "./harness";

let t: RlsDb;
let adminId: string;
let activeId: string;
let pendingId: string;
let subjectId: string;
let docId: string;

beforeAll(async () => {
  t = await createRlsDb();
  adminId = await t.signUp("admin@example.com", "Admin");
  activeId = await t.signUp("lea@example.com", "Lea");
  pendingId = await t.signUp("nouveau@example.com", "Nouveau");
  await t.admin(async () => {
    await t.db.query("update public.profiles set role = 'admin', status = 'active' where id = $1", [adminId]);
    await t.db.query("update public.profiles set status = 'active' where id = $1", [activeId]);
    subjectId = (
      await t.db.query<{ id: string }>(
        "insert into public.subjects (name, slug, color) values ('Algorithmique et Prog C', 'algo-c', '#3366ff') returning id",
      )
    ).rows[0].id;
    docId = (
      await t.db.query<{ id: string }>(
        `insert into public.documents (title, type, subject_id, file_path, mime, sha256, text, source)
         values ('Cours sur les pointeurs', 'course', $1, 'uploads/imported/pointeurs.pdf', 'application/pdf', 'abc', 'Les pointeurs en C', 'github')
         returning id`,
        [subjectId],
      )
    ).rows[0].id;
    await t.db.query("insert into storage.objects (bucket_id, name, owner) values ('files', 'uploads/imported/pointeurs.pdf', null)");
  });
}, 60_000);

describe("visiteur (anon)", () => {
  it("ne lit aucun contenu", async () => {
    await t.as(null);
    for (const table of ["documents", "exercises", "subjects", "posts", "threads", "homeworks", "profiles"]) {
      expect(await t.count(`select 1 from public.${table}`), table).toBe(0);
    }
    expect(await t.count("select 1 from storage.objects")).toBe(0);
  });

  it("ne peut rien insérer", async () => {
    await t.as(null);
    await expect(t.db.query("insert into public.subjects (name, slug) values ('x', 'x')")).rejects.toThrow();
  });
});

describe("compte en attente", () => {
  it("ne lit que son propre profil", async () => {
    await t.as(pendingId);
    expect(await t.count("select 1 from public.documents")).toBe(0);
    expect(await t.count("select 1 from storage.objects")).toBe(0);
    const r = await t.db.query<{ id: string; status: string }>("select id, status from public.profiles");
    expect(r.rows).toEqual([{ id: pendingId, status: "pending" }]);
  });

  it("ne peut pas se valider lui-même", async () => {
    await t.as(pendingId);
    const attempt = t.db.query("update public.profiles set status = 'active' where id = $1", [pendingId]);
    await attempt.then(
      (r) => expect(r.affectedRows ?? 0).toBe(0),
      (e: Error) => expect(e.message).toMatch(/administrateur|permission|denied/i),
    );
    await t.admin(async () => {
      const r = await t.db.query<{ status: string }>("select status from public.profiles where id = $1", [pendingId]);
      expect(r.rows[0].status).toBe("pending");
    });
  });
});

describe("compte actif", () => {
  it("lit tous les documents et les fichiers", async () => {
    await t.as(activeId);
    expect(await t.count("select 1 from public.documents")).toBe(1);
    expect(await t.count("select 1 from storage.objects where bucket_id = 'files'")).toBe(1);
  });

  it("ne lit que sa propre progression et son propre calendrier", async () => {
    await t.admin(async () => {
      const ex = await t.db.query<{ id: string }>(
        "insert into public.exercises (document_id, number, title, statement, group_key) values ($1, 1, 'Ex 1', 'Écrire swap', 'g1') returning id",
        [docId],
      );
      await t.db.query("insert into public.progress (user_id, exercise_id, status) values ($1, $2, 'doing'), ($3, $2, 'mastered')", [
        activeId,
        ex.rows[0].id,
        adminId,
      ]);
      await t.db.query(
        "insert into public.calendar_links (user_id, encrypted_url, events) values ($1, 'x', '[]'), ($2, 'y', '[]')",
        [activeId, adminId],
      );
    });
    await t.as(activeId);
    expect(await t.count("select 1 from public.progress")).toBe(1);
    expect(await t.count("select 1 from public.calendar_links")).toBe(1);
  });

  it("ne peut pas se donner le rôle admin", async () => {
    await t.as(activeId);
    await t.db.query("update public.profiles set role = 'admin' where id = $1", [activeId]).catch(() => undefined);
    await t.admin(async () => {
      const r = await t.db.query<{ role: string }>("select role from public.profiles where id = $1", [activeId]);
      expect(r.rows[0].role).toBe("member");
    });
  });

  it("dépose un fichier seulement sous uploads/<son id>/", async () => {
    await t.as(activeId);
    await t.db.query("insert into storage.objects (bucket_id, name) values ('files', $1)", [`uploads/${activeId}/a.pdf`]);
    await expect(
      t.db.query("insert into storage.objects (bucket_id, name) values ('files', 'uploads/imported/pirate.pdf')"),
    ).rejects.toThrow();
  });

  it("la recherche trouve le document (accents ignorés)", async () => {
    await t.as(activeId);
    const r = await t.db.query<{ kind: string; id: string }>("select kind, id from public.search('POINTEURS')");
    expect(r.rows).toContainEqual(expect.objectContaining({ kind: "document", id: docId }));
  });
});

describe("administrateur", () => {
  it("liste les demandes en attente avec leur e-mail ; un membre ne voit rien", async () => {
    await t.as(adminId);
    const r = await t.db.query<{ name: string; email: string }>("select name, email from public.pending_requests()");
    expect(r.rows).toContainEqual({ name: "Nouveau", email: "nouveau@example.com" });
    await t.as(activeId);
    const m = await t.db.query("select * from public.pending_requests()");
    expect(m.rows).toEqual([]);
  });

  it("valide un compte en attente", async () => {
    const other = await t.signUp("autre@example.com", "Autre");
    await t.as(adminId);
    const r = await t.db.query("update public.profiles set status = 'active' where id = $1", [other]);
    expect(r.affectedRows).toBe(1);
  });
});

describe("contraintes", () => {
  it("pseudo unique sans tenir compte de la casse", async () => {
    await expect(t.signUp("lea2@example.com", "LEA")).rejects.toThrow();
  });

  it("la recherche ne renvoie rien à un visiteur", async () => {
    await t.as(null);
    const r = await t.db.query("select * from public.search('pointeurs')");
    expect(r.rows).toEqual([]);
  });

  it("créer un exercice met sa vérification en file", async () => {
    await t.admin(async () => {
      const ex = await t.db.query<{ id: string }>(
        "insert into public.exercises (document_id, number, title, statement, group_key) values ($1, 2, 'Ex 2', 'Somme', 'g2') returning id",
        [docId],
      );
      const c = await t.db.query<{ status: string }>("select status from public.exercise_checks where exercise_id = $1", [
        ex.rows[0].id,
      ]);
      expect(c.rows).toEqual([{ status: "pending" }]);
    });
  });

  it("claim_check est réservé à service_role et prend une vérification en attente", async () => {
    await t.as(activeId);
    await expect(t.db.query("select * from public.claim_check()")).rejects.toThrow();
    await t.as("service");
    const r = await t.db.query<{ status: string; attempts: number }>("select status, attempts from public.claim_check()");
    expect(r.rows[0]).toMatchObject({ status: "running", attempts: 1 });
  });
});
