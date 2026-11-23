import { describe, expect, it } from "vitest";
import {
  daysUntil,
  diffTimetable,
  examAlerts,
  examsFromTimetable,
  formatDocuments,
  formatHomework,
  formatTimetableChanges,
  isExamTitle,
  snapshot,
  type Snapshot,
} from "../../supabase/functions/_shared/channel-core";

const APP = "https://biblio-b1.github.io/biblio-b1";
const NOW = new Date("2026-11-23T10:00:00Z"); // lundi 23 novembre, 11 h à Paris

function ev(over: Partial<{ uid: string; start: string; end: string; location: string; type: string; status: "cancelled"; title: string; matiere: string }> = {}) {
  const type = over.type ?? "CRS";
  return {
    uid: over.uid ?? "u1",
    title: over.title ?? `Algorithmique et programmation C - M. VANDAMME SIMON - Bch B1 Intelligence Artificielle Gr1 (fr) - ${type}`,
    start: over.start ?? "2026-11-25T08:00:00Z",
    end: over.end ?? "2026-11-25T11:00:00Z",
    allDay: false,
    status: over.status,
    location: over.location ?? "Salle EM319 - EIFFEL 1",
    description: `Matière : ${over.matiere ?? "Algorithmique et programmation C"}\nEnseignant : M. VANDAMME SIMON\nTD : Bch B1 Intelligence Artificielle Gr1 (fr)\nType : ${type}`,
  };
}
const S = (o: Parameters<typeof ev>[0] = {}) => snapshot(ev(o)) as Snapshot;
const opts = { now: NOW, horizonDays: 21, complete: true };

describe("snapshot", () => {
  it("matière, groupe, salle ; visio pour les types « -CV »", () => {
    expect(S()).toMatchObject({ subject: "Algorithmique et programmation C", groups: "IA Gr1", visio: false, location: "Salle EM319 - EIFFEL 1" });
    expect(S({ type: "CRS-CV", location: "" }).visio).toBe(true);
    expect(S({ location: "Salle EM227 - EIFFEL 1 (Meet-up)" }).visio).toBe(false);
  });
  it("ignore e-learning, autonomie et jours fériés", () => {
    expect(snapshot(ev({ type: "ELEARNING" }))).toBeNull();
    expect(snapshot(ev({ type: "AUTONOMIE" }))).toBeNull();
    expect(snapshot({ ...ev(), title: "Férié", description: undefined })).toBeNull();
  });
});

describe("diffTimetable", () => {
  it("salle, visio, présentiel, horaire, annulation", () => {
    expect(diffTimetable([S()], [S({ location: "Salle G017- E4" })], opts).map((c) => c.kind)).toEqual(["room"]);
    expect(diffTimetable([S()], [S({ type: "CRS-CV", location: "" })], opts).map((c) => c.kind)).toEqual(["toVisio"]);
    expect(diffTimetable([S({ type: "CRS-CV", location: "" })], [S()], opts).map((c) => c.kind)).toEqual(["toPresentiel"]);
    expect(diffTimetable([S()], [S({ start: "2026-11-26T08:00:00Z", end: "2026-11-26T11:00:00Z" })], opts).map((c) => c.kind)).toEqual(["moved"]);
    expect(diffTimetable([S()], [S({ status: "cancelled" })], opts).map((c) => c.kind)).toEqual(["cancelled"]);
  });

  it("ajout et suppression dans les 3 semaines à venir seulement", () => {
    expect(diffTimetable([], [S()], opts).map((c) => c.kind)).toEqual(["added"]);
    expect(diffTimetable([S()], [], opts).map((c) => c.kind)).toEqual(["removed"]);
    const far = S({ uid: "far", start: "2027-02-01T08:00:00Z", end: "2027-02-01T10:00:00Z" });
    expect(diffTimetable([], [far], opts)).toEqual([]);
    const past = S({ uid: "past", start: "2026-11-20T08:00:00Z", end: "2026-11-20T10:00:00Z" });
    expect(diffTimetable([past], [], opts)).toEqual([]);
  });

  it("relevé incomplet (un calendrier illisible) : aucune suppression annoncée", () => {
    expect(diffTimetable([S()], [], { ...opts, complete: false })).toEqual([]);
  });

  it("identifiant changé, même matière et même début : modification, pas suppression + ajout", () => {
    const c = diffTimetable([S({ uid: "old" })], [S({ uid: "new", location: "Salle G017- E4" })], opts);
    expect(c.map((x) => x.kind)).toEqual(["room"]);
  });

  it("rien de changé : rien à annoncer", () => {
    expect(diffTimetable([S()], [S()], opts)).toEqual([]);
  });
});

describe("messages", () => {
  it("emploi du temps : changement de salle lisible, avec lien", () => {
    const [m] = formatTimetableChanges(diffTimetable([S()], [S({ location: "Salle G017- E4" })], opts), APP);
    expect(m).toContain("🚪 <b>Changement de salle</b> : <b>Algorithmique et programmation C</b> (IA Gr1)");
    expect(m).toContain("mercredi 25 novembre, 09:00–12:00");
    expect(m).toContain("Salle EM319 - EIFFEL 1 → <b>Salle G017- E4</b>");
    expect(m).toContain(`${APP}/timetable/`);
  });

  it("un document : type, titre, matière et lien", () => {
    const [m] = formatDocuments([{ id: "d1", title: "TD pointeurs", type: "exercise", subject: "Algo C" }], APP);
    expect(m).toContain("📄 <b>Nouveau document : exercices</b>");
    expect(m).toContain("<b>TD pointeurs</b>");
    expect(m).toContain(`${APP}/doc/?id=d1`);
  });

  it("plusieurs documents : un seul message, regroupés par matière", () => {
    const docs = [
      { id: "a", title: "Cours 1", type: "course", subject: "Maths" },
      { id: "b", title: "TD 1", type: "exercise", subject: "Maths" },
      { id: "c", title: "<script>", type: "note", subject: null },
    ];
    const out = formatDocuments(docs, APP);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("📄 <b>3 nouveaux documents</b>");
    expect(out[0]).toContain("📚 <b>Maths</b>\n  • Cours : ");
    expect(out[0]).toContain("&lt;script&gt;");
  });

  it("un très grand import est découpé en messages de moins de 4096 caractères", () => {
    const docs = Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}`, title: `Document numéro ${i} avec un titre assez long`, type: "course", subject: `Matière ${i % 7}` }));
    const out = formatDocuments(docs, APP);
    expect(out.length).toBeGreaterThan(1);
    for (const m of out) expect(m.length).toBeLessThan(4096);
  });

  it("devoir : matière, date, pièce jointe ; un contrôle est annoncé comme tel", () => {
    const h = { id: "h", title: "Exercices 1 à 5", subject: "Maths", dueDate: "2026-11-26", attachmentName: "td.pdf" };
    const m = formatHomework(h, APP);
    expect(m).toContain("📝 <b>Nouveau devoir</b>");
    expect(m).toContain("📅 Pour le jeudi 26 novembre");
    expect(m).toContain("📎 td.pdf");
    expect(formatHomework({ ...h, title: "Contrôle chapitre 3" }, APP)).toContain("📣 <b>Contrôle annoncé</b>");
  });
});

describe("alertes de contrôle", () => {
  it("reconnaît les contrôles dans un titre", () => {
    for (const t of ["Contrôle de maths", "DS n°2", "Partiel", "QCM Linux", "Évaluation C"]) expect(isExamTitle(t), t).toBe(true);
    expect(isExamTitle("Exercices 1 à 5")).toBe(false);
  });

  it("une semaine avant, puis la veille à partir de 17 h, une seule fois chacune", () => {
    const exam = [{ key: "hw:1", title: "Contrôle C", day: "2026-11-30" }];
    expect(daysUntil("2026-11-30", NOW)).toBe(7);
    const a = examAlerts(exam, new Set(), NOW, APP);
    expect(a.map((x) => x.key)).toEqual(["hw:1:semaine"]);
    expect(a[0].text).toContain("Contrôle dans 7 jours");
    expect(examAlerts(exam, new Set(["hw:1:semaine"]), NOW, APP)).toEqual([]);

    const eve = new Date("2026-11-29T16:30:00Z"); // 17 h 30 à Paris, la veille
    expect(examAlerts(exam, new Set(["hw:1:semaine"]), eve, APP).map((x) => x.key)).toEqual(["hw:1:veille"]);
    const morning = new Date("2026-11-29T08:00:00Z");
    expect(examAlerts(exam, new Set(["hw:1:semaine"]), morning, APP)).toEqual([]);
  });

  it("séances « EVALUATION » de l'emploi du temps", () => {
    const e = examsFromTimetable([S({ uid: "x", type: "EVALUATION" }), S({ uid: "y" })]);
    expect(e).toEqual([{ key: "edt:x", title: "Algorithmique et programmation C", day: "2026-11-25", detail: "🕒 09:00–12:00 · Salle EM319 - EIFFEL 1" }]);
  });
});
