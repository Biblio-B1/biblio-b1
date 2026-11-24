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

  it("la recherche trouve le document (accents ignorés) avec de quoi filtrer", async () => {
    await t.as(activeId);
    const r = await t.db.query<Record<string, unknown>>("select * from public.search('POINTEURS')");
    expect(r.rows).toContainEqual(
      expect.objectContaining({ entity: "document", id: docId, doc_type: "course", subject_id: subjectId, title: "Cours sur les pointeurs" }),
    );
    expect(r.rows[0].created_at).toBeTruthy();
  });

  it("l'extrait surligne avec <mark> et échappe le HTML du document", async () => {
    await t.admin(async () => {
      await t.db.query(
        `insert into public.documents (title, type, file_path, mime, sha256, text, source)
         values ('Piège', 'note', 'x.md', 'text/markdown', 'xss', 'malloc <script>alert(1)</script> fin', 'upload')`,
      );
    });
    await t.as(activeId);
    const r = await t.db.query<{ snippet: string }>("select snippet from public.search('malloc') where title = 'Piège'");
    expect(r.rows[0].snippet).toContain("<mark>malloc</mark>");
    expect(r.rows[0].snippet).not.toContain("<script>");
    expect(r.rows[0].snippet).toContain("&lt;script&gt;");
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

describe("professeurs et calendriers", () => {
  it("un compte validé relève les professeurs, sans doublon, en fusionnant les matières", async () => {
    await t.as(activeId);
    await t.db.query("select public.register_teachers($1::jsonb)", [
      JSON.stringify([{ name: "M. DUPONT JEAN", subjects: ["Maths"] }]),
    ]);
    await t.db.query("select public.register_teachers($1::jsonb)", [
      JSON.stringify([{ name: "m. dupont jean", subjects: ["Algo", "Maths"] }]),
    ]);
    const r = await t.db.query<{ name: string; subjects: string[] }>("select name, subjects from public.teachers");
    expect(r.rows).toEqual([{ name: "M. DUPONT JEAN", subjects: ["Algo", "Maths"] }]);
  });

  it("un membre renseigne un e-mail valide ; un e-mail invalide est refusé", async () => {
    await t.as(activeId);
    await t.db.query("update public.teachers set email = 'jean.dupont@ecole.fr'");
    await expect(t.db.query("update public.teachers set email = 'pas-un-mail'")).rejects.toThrow();
  });

  it("un compte en attente ne lit ni ne relève rien ; seul l'admin supprime", async () => {
    await t.as(pendingId);
    expect(await t.count("select 1 from public.teachers")).toBe(0);
    await expect(
      t.db.query("select public.register_teachers($1::jsonb)", [JSON.stringify([{ name: "Mme X", subjects: [] }])]),
    ).rejects.toThrow();
    await t.as(activeId);
    await t.db.query("delete from public.teachers");
    expect(await t.count("select 1 from public.teachers")).toBe(1);
    await t.as(adminId);
    await t.db.query("delete from public.teachers");
    expect(await t.count("select 1 from public.teachers")).toBe(0);
  });

  it("un membre peut avoir un calendrier Boostcamp et un calendrier Outlook", async () => {
    await t.as("service");
    await t.db.query(
      "insert into public.calendar_links (user_id, source, encrypted_url) values ($1, 'outlook', 'b')",
      [activeId],
    );
    await expect(
      t.db.query("insert into public.calendar_links (user_id, source, encrypted_url) values ($1, 'gmail', 'c')", [activeId]),
    ).rejects.toThrow();
    await t.as(activeId);
    expect(await t.count("select 1 from public.calendar_links")).toBe(2);
  });
});

describe("annuaire des élèves", () => {
  it("liste les comptes validés ; l'e-mail seulement pour qui l'a choisi", async () => {
    await t.as(activeId);
    await t.db.query("update public.profiles set show_email = true where id = $1", [activeId]);
    const r = await t.db.query<{ name: string; email: string | null }>("select name, email from public.directory_students()");
    expect(r.rows.map((x) => x.name)).not.toContain("Nouveau");
    expect(r.rows.find((x) => x.name === "Lea")?.email).toBe("lea@example.com");
    expect(r.rows.find((x) => x.name === "Admin")?.email).toBeNull();
  });

  it("un compte en attente ne voit personne", async () => {
    await t.as(pendingId);
    expect(await t.count("select * from public.directory_students()")).toBe(0);
  });
});

describe("professeurs masqués", () => {
  it("seul l'admin masque ; un prof masqué n'est pas recréé par le relevé", async () => {
    await t.as(activeId);
    await t.db.query("select public.register_teachers($1::jsonb)", [JSON.stringify([{ name: "Mme MASQUEE ANNE", subjects: ["A"] }])]);
    await expect(t.db.query("update public.teachers set hidden = true where name = 'Mme MASQUEE ANNE'")).rejects.toThrow();
    await t.as(adminId);
    await t.db.query("update public.teachers set hidden = true where name = 'Mme MASQUEE ANNE'");
    await t.as(activeId);
    await t.db.query("select public.register_teachers($1::jsonb)", [JSON.stringify([{ name: "Mme MASQUEE ANNE", subjects: ["B"] }])]);
    const r = await t.db.query<{ hidden: boolean }>("select hidden from public.teachers where lower(name) = 'mme masquee anne'");
    expect(r.rows).toEqual([{ hidden: true }]);
  });
});

describe("canal Telegram", () => {
  it("un document ou un devoir ajouté entre dans la file ; le site ne la lit pas", async () => {
    await t.as(activeId);
    await t.db.query(
      "insert into public.homeworks (subject_id, title, due_date) values ($1, 'Contrôle C', '2026-12-01')",
      [subjectId],
    );
    await expect(t.db.query("select * from public.channel_outbox")).rejects.toThrow();
    await t.as("service");
    const r = await t.db.query<{ kind: string }>("select kind from public.channel_outbox order by id");
    expect(r.rows.map((x) => x.kind)).toContain("homework");
    expect(r.rows.map((x) => x.kind)).toContain("document");
  });
});

describe("contrôles", () => {
  it("un membre ajoute un contrôle (annoncé) ; ceux de l'emploi du temps ne se touchent pas depuis le site", async () => {
    await t.as(activeId);
    const id = (
      await t.db.query<{ id: string }>(
        "insert into public.exams (kind, subject_id, title, exam_date, start_time) values ('controle', $1, 'DS pointeurs', '2026-12-02', '09:00') returning id",
        [subjectId],
      )
    ).rows[0].id;
    await expect(
      t.db.query("insert into public.exams (source, edt_uid, subject_label, exam_date) values ('edt', 'u1', 'Maths', '2026-12-03')"),
    ).rejects.toThrow();
    await t.as("service");
    await t.db.query("insert into public.exams (source, edt_uid, subject_label, exam_date, author_id) values ('edt', 'u1', 'Maths', '2026-12-03', null)");
    const queued = await t.db.query<{ ref: string }>("select ref from public.channel_outbox where kind = 'exam'");
    expect(queued.rows.map((x) => x.ref)).toEqual([id]);
    await t.as(activeId);
    expect(await t.count("select 1 from public.exams")).toBe(2);
    await t.db.query("delete from public.exams where source = 'edt'");
    expect(await t.count("select 1 from public.exams where source = 'edt'")).toBe(1);
    await t.as(pendingId);
    expect(await t.count("select 1 from public.exams")).toBe(0);
    await t.as(adminId);
    await t.db.query("delete from public.exams where id = $1", [id]);
    expect(await t.count("select 1 from public.exams where source = 'manual'")).toBe(0);
  });

  it("pièces jointes : tout membre en joint (dans son dossier), seul l'auteur ou l'admin les retire", async () => {
    await t.as("service");
    const examId = (await t.db.query<{ id: string }>("select id from public.exams where edt_uid = 'u1'")).rows[0].id;
    await t.as(activeId);
    const add = (path: string) =>
      t.db.query("insert into public.exam_attachments (exam_id, path, name, mime, size) values ($1, $2, 'sujet.pdf', 'application/pdf', 10) returning id", [examId, path]);
    const attId = (await add(`uploads/${activeId}/abc.pdf`)).rows[0] as { id: string };
    await add(`uploads/${activeId}/def.pdf`);
    await expect(add(`uploads/${adminId}/vol.pdf`)).rejects.toThrow();
    await t.as(pendingId);
    expect(await t.count("select 1 from public.exam_attachments")).toBe(0);
    await t.as(adminId);
    expect(await t.count("select 1 from public.exam_attachments")).toBe(2);
    const other = await t.signUp("joint@example.com", "Joint");
    await t.admin(() => t.db.query("update public.profiles set status = 'active' where id = $1", [other]));
    await t.as(other);
    await t.db.query("delete from public.exam_attachments where id = $1", [attId.id]);
    expect(await t.count("select 1 from public.exam_attachments")).toBe(2);
    await t.as(activeId);
    await t.db.query("delete from public.exam_attachments where id = $1", [attId.id]);
    expect(await t.count("select 1 from public.exam_attachments")).toBe(1);
    await t.as("service");
    await t.db.query("delete from public.exams where id = $1", [examId]);
    expect(await t.count("select 1 from public.exam_attachments")).toBe(0);
  });
});
