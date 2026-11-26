import { describe, expect, it } from "vitest";
import {
  daysUntil,
  diffTimetable,
  examAlerts,
  examsFromTimetable,
  examFromRow,
  examRowFromSnapshot,
  formatExamAnnounce,
  alertStage,
  homeworkReminders,
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

describe("titres des messages", () => {
  it("une icône par type, jamais partagée entre deux types", async () => {
    const { TITLES } = await import("../../supabase/functions/_shared/channel-core");
    const icon = (t: string) => t.split(" ")[0];
    expect(new Set([TITLES.homework, TITLES.exam, TITLES.project, TITLES.document("x"), TITLES.timetable].map(icon)).size).toBe(5);
    expect(icon(TITLES.examSoon("dans 2 semaines"))).toBe(icon(TITLES.exam));
    expect(icon(TITLES.projectTomorrow)).toBe(icon(TITLES.project));
    expect(icon(TITLES.homeworkTomorrow)).toBe(icon(TITLES.homework));
    expect(TITLES.examTomorrow).toContain("<b>CONTRÔLE DEMAIN</b>");
  });
});

describe("diffTimetable", () => {
  it("une séance vue dans plusieurs emplois du temps n'est annoncée qu'une fois", () => {
    const of = (name: string, o: Parameters<typeof ev>[0] = {}) => ({ ...S(o), uid: `Cours-2037424-20-${name}-Index-Education` });
    const before = [of("DUPONT_Jean"), of("MARTIN_Lea"), of("DURAND_Ali")];
    const after = [of("DUPONT_Jean", { location: "Salle G017- E4" }), of("MARTIN_Lea", { location: "Salle G017- E4" }), of("DURAND_Ali", { location: "Salle G017- E4" })];
    expect(diffTimetable(before, after, opts).map((c) => c.kind)).toEqual(["room"]);
    expect(diffTimetable(before, before, opts)).toEqual([]);
    // Un élève de plus qui lie son emploi du temps : rien à annoncer.
    expect(diffTimetable(before.slice(0, 2), before, opts)).toEqual([]);
    expect(diffTimetable([], before, opts).map((c) => c.kind)).toEqual(["added"]);
  });

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
  it("emploi du temps : changement de salle avec matière, date, horaire et lien", () => {
    const [m] = formatTimetableChanges(diffTimetable([S()], [S({ location: "Salle G017- E4" })], opts), APP);
    expect(m).toContain(
      [
        "🚪 <b>Changement de salle</b>",
        "📚 Matière : <b>Algorithmique et programmation C</b> (IA Gr1)",
        "📅 Date : mercredi 25 novembre",
        "🕒 Horaire : 09:00–12:00",
        "📍 Salle : Salle EM319 - EIFFEL 1 → <b>Salle G017- E4</b>",
      ].join("\n"),
    );
    expect(m).toContain(`${APP}/timetable/`);
  });

  it("cours passé en visio : matière, date et horaire", () => {
    const [m] = formatTimetableChanges(diffTimetable([S()], [S({ type: "CRS-CV", location: "" })], opts), APP);
    expect(m).toContain(
      [
        "💻 <b>Cours en visio</b>",
        "📚 Matière : <b>Algorithmique et programmation C</b> (IA Gr1)",
        "📅 Date : <b>mercredi 25 novembre</b>",
        "🕒 Horaire : <b>09:00–12:00</b>",
        "📍 Lieu : <b>en visio</b> (au lieu de Salle EM319 - EIFFEL 1)",
      ].join("\n"),
    );
  });

  it("horaire modifié : matière, avant et maintenant (date et heures)", () => {
    const [m] = formatTimetableChanges(diffTimetable([S()], [S({ start: "2026-11-26T13:00:00Z", end: "2026-11-26T16:00:00Z" })], opts), APP);
    expect(m).toContain("📚 Matière : <b>Algorithmique et programmation C</b>");
    expect(m).toContain("⬅️ Avant : mercredi 25 novembre, 09:00–12:00");
    expect(m).toContain("➡️ Maintenant : <b>jeudi 26 novembre, 14:00–17:00</b>");
  });

  it("un document : type, titre, matière et lien", () => {
    const [m] = formatDocuments([{ id: "d1", title: "TD pointeurs", type: "exercise", subject: "Algo C" }], APP);
    expect(m).toContain("📄 <b>NOUVEAU DOCUMENT · EXERCICES</b>");
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
    expect(out[0]).toContain("📄 <b>3 NOUVEAUX DOCUMENTS</b>");
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
    const h = { id: "h", title: "Exercices 1 à 5", subject: "Maths", dueDate: "2026-11-26", attachments: ["td.pdf"] };
    const m = formatHomework(h, APP);
    expect(m).toContain("📝 <b>NOUVEAU DEVOIR</b>");
    expect(m).toContain("📚 Matière : <b>Maths</b>");
    expect(m).toContain("📅 À rendre le : <b>jeudi 26 novembre</b>");
    expect(m).toContain("📎 Pièce jointe : td.pdf");
    expect(formatHomework({ ...h, attachments: ["td.pdf", "corrigé <v1>.pdf"] }, APP)).toContain("📎 2 pièces jointes :\n  • td.pdf\n  • corrigé &lt;v1&gt;.pdf");
    expect(formatHomework({ ...h, attachments: [] }, APP)).not.toContain("📎");
    const c = formatHomework({ ...h, title: "Contrôle chapitre 3" }, APP);
    expect(c).toContain("🔴 <b>NOUVEAU CONTRÔLE</b>");
    expect(c).toContain("📚 Matière : <b>Maths</b>");
    expect(c).toContain("📅 Date : <b>jeudi 26 novembre</b>");
  });
});

describe("alertes de contrôle", () => {
  it("reconnaît les contrôles dans un titre", () => {
    for (const t of ["Contrôle de maths", "DS n°2", "Partiel", "QCM Linux", "Évaluation C"]) expect(isExamTitle(t), t).toBe(true);
    expect(isExamTitle("Exercices 1 à 5")).toBe(false);
  });

  it("une semaine avant, puis la veille à partir de 17 h, une seule fois chacune", () => {
    const exam = [{ key: "hw:1", subject: "Algorithmique et programmation C", title: "Contrôle pointeurs", day: "2026-11-30" }];
    expect(daysUntil("2026-11-30", NOW)).toBe(7);
    const a = examAlerts(exam, new Set(), NOW, APP);
    expect(a.map((x) => x.key)).toEqual(["hw:1:semaine"]);
    expect(a[0].text).toContain("🔴 <b>RAPPEL · CONTRÔLE DANS 1 SEMAINE</b>");
    expect(a[0].text).toContain("📚 Matière : <b>Algorithmique et programmation C</b>");
    expect(a[0].text).toContain("📝 Contrôle pointeurs");
    expect(a[0].text).toContain("📅 Date : <b>lundi 30 novembre</b>");
    expect(examAlerts(exam, new Set(["hw:1:semaine"]), NOW, APP)).toEqual([]);

    const eve = new Date("2026-11-29T16:30:00Z"); // 17 h 30 à Paris, la veille
    expect(examAlerts(exam, new Set(["hw:1:semaine"]), eve, APP).map((x) => x.key)).toEqual(["hw:1:veille"]);
    const morning = new Date("2026-11-29T08:00:00Z");
    expect(examAlerts(exam, new Set(["hw:1:semaine"]), morning, APP)).toEqual([]);
  });

  it("séances « EVALUATION » de l'emploi du temps", () => {
    const e = examsFromTimetable([S({ uid: "x", type: "EVALUATION" }), S({ uid: "y" })]);
    expect(e).toEqual([
      { key: "edt:x", subject: "Algorithmique et programmation C", day: "2026-11-25", time: "09:00–12:00", place: "Salle EM319 - EIFFEL 1" },
    ]);
    const [alert] = examAlerts(e, new Set(), NOW, APP);
    expect(alert.text).toContain("📅 Date : <b>mercredi 25 novembre</b>\n🕒 Horaire : <b>09:00–12:00</b>\n📍 Lieu : Salle EM319 - EIFFEL 1");
  });

  it("paliers : 3, 2 et 1 semaine(s) avant, puis la veille au soir", () => {
    // NOW : lundi 23 novembre, 11 h à Paris.
    expect(alertStage("2026-12-14", NOW)).toBe("3sem"); // 21 jours
    expect(alertStage("2026-12-08", NOW)).toBe("3sem"); // 15 jours
    expect(alertStage("2026-12-07", NOW)).toBe("2sem"); // 14 jours
    expect(alertStage("2026-12-01", NOW)).toBe("2sem"); // 8 jours
    expect(alertStage("2026-11-30", NOW)).toBe("semaine");
    expect(alertStage("2026-11-25", NOW)).toBe("semaine");
    expect(alertStage("2026-11-24", NOW)).toBeNull(); // demain, mais avant 17 h
    expect(alertStage("2026-11-24", new Date("2026-11-23T16:00:00Z"))).toBe("veille");
    expect(alertStage("2026-12-15", NOW)).toBeNull(); // 22 jours
    expect(alertStage("2026-11-23", NOW)).toBeNull(); // aujourd'hui

    // Rappels à partir de 8 h (heure de Paris), pas à minuit ; la veille reste à 17 h.
    const night = new Date("2026-11-22T23:05:00Z"); // lundi 23, 0 h 05 à Paris
    const early = new Date("2026-11-23T06:55:00Z"); // 7 h 55
    const eight = new Date("2026-11-23T07:00:00Z"); // 8 h 00
    expect(alertStage("2026-11-30", night)).toBeNull();
    expect(alertStage("2026-11-30", early)).toBeNull();
    expect(alertStage("2026-11-30", eight)).toBe("semaine");
    expect(alertStage("2026-12-14", eight)).toBe("3sem");
    expect(alertStage("2026-11-30", night, { anyHour: true })).toBe("semaine"); // annonce de nuit : palier couvert
    expect(alertStage("2026-11-24", night, { anyHour: true })).toBeNull(); // la veille attend 17 h
    expect(examAlerts([{ key: "x", subject: "Maths", day: "2026-11-30" }], new Set(), night, APP)).toEqual([]);

    const exam = [{ key: "exam:1", subject: "Maths", day: "2026-12-14", kind: "controle" as const }];
    const [three] = examAlerts(exam, new Set(), NOW, APP);
    expect(three).toMatchObject({ key: "exam:1:3sem" });
    expect(three.text).toContain("🔴 <b>RAPPEL · CONTRÔLE DANS 3 SEMAINES</b>");
    expect(examAlerts(exam, new Set(["exam:1:3sem"]), NOW, APP)).toEqual([]);
    const later = new Date("2026-11-30T10:00:00Z"); // 14 jours avant
    expect(examAlerts(exam, new Set(["exam:1:3sem"]), later, APP)[0]).toMatchObject({ key: "exam:1:2sem" });
    const projet = [{ ...exam[0], kind: "projet" as const, day: "2026-12-03" }]; // 10 jours
    expect(examAlerts(projet, new Set(), NOW, APP)[0].text).toContain("🏁 <b>RAPPEL · PROJET FINAL À RENDRE DANS 10 JOURS</b>");
  });

  it("devoir coché « projet final » : annoncé comme projet, rappelé comme un contrôle, lien vers les devoirs", () => {
    const hw = { id: "p1", title: "Site web de la promo", subject: "Développement web", dueDate: "2026-12-14", finalProject: true };
    const t = formatHomework(hw, APP);
    expect(t).toContain("🏁 <b>NOUVEAU PROJET FINAL</b>");
    expect(t).toContain("📝 Projet : Site web de la promo");
    expect(t).toContain("📅 À rendre le : <b>lundi 14 décembre</b>");
    expect(t).toContain(`${APP}/devoirs/`);
    const [alert] = examAlerts([{ key: "hw:p1", subject: hw.subject, title: hw.title, day: hw.dueDate, kind: "projet" }], new Set(), NOW, APP);
    expect(alert.key).toBe("hw:p1:3sem");
    expect(alert.text).toContain("🏁 <b>RAPPEL · PROJET FINAL À RENDRE DANS 3 SEMAINES</b>");
    expect(alert.text).toContain("📅 À rendre le : <b>lundi 14 décembre</b>");
    expect(alert.text).toContain(`<a href="${APP}/devoirs/">Voir les devoirs</a>`);
    const eve = new Date("2026-12-13T17:30:00Z");
    expect(homeworkReminders([{ ...hw }], new Set(), eve, APP)).toEqual([]); // rappel « contrôle », pas « devoir »
    expect(formatHomework({ ...hw, finalProject: false }, APP)).toContain("📝 <b>NOUVEAU DEVOIR</b>");
  });

  it("devoirs : rappel la veille au soir seulement, sauf ceux qui sont des contrôles", () => {
    const hws = [
      { id: "h1", title: "Exercices 1 à 5", subject: "Maths", dueDate: "2026-11-24", englishGroup: null },
      { id: "h2", title: "Contrôle chapitre 2", subject: "Maths", dueDate: "2026-11-24" },
      { id: "h3", title: "TP réseau", subject: "Réseaux", dueDate: "2026-11-30" },
    ];
    expect(homeworkReminders(hws, new Set(), NOW, APP)).toEqual([]);
    const eve = new Date("2026-11-23T17:30:00Z"); // 18 h 30 à Paris
    const r = homeworkReminders(hws, new Set(), eve, APP);
    expect(r.map((x) => x.key)).toEqual(["hwr:h1:veille"]);
    expect(r[0].text).toContain("📝 <b>RAPPEL · DEVOIR À RENDRE DEMAIN</b>");
    expect(r[0].text).toContain("📝 Devoir : Exercices 1 à 5");
    expect(r[0].text).toContain("📅 À rendre le : <b>mardi 24 novembre</b>");
    expect(homeworkReminders(hws, new Set(["hwr:h1:veille"]), eve, APP)).toEqual([]);
  });
});

describe("table des contrôles", () => {
  const row = {
    id: "e1",
    kind: "projet" as const,
    title: "Projet final <web>",
    exam_date: "2026-11-27",
    start_time: "14:00:00",
    end_time: "16:30:00",
    location: "Salle EM319",
    details: "Rendu sur Boostcamp",
    source: "manual" as const,
    edt_uid: null,
    subject_label: null,
    subjects: { name: "Développement web" },
  };

  it("ligne du site → contrôle (clé, horaire, HTML échappé)", () => {
    expect(examFromRow(row)).toEqual({
      key: "exam:e1",
      subject: "Développement web",
      title: "Projet final <web>",
      day: "2026-11-27",
      time: "14:00–16:30",
      place: "Salle EM319",
      kind: "projet",
      group: null,
    });
    expect(examFromRow({ ...row, source: "edt", edt_uid: "u9", subjects: null, subject_label: "Maths" }).key).toBe("edt:u9");
  });

  it("annonce et alertes d'un projet final", () => {
    const e = examFromRow(row);
    const t = formatExamAnnounce({ ...e, details: row.details }, APP);
    expect(t).toContain("🏁 <b>NOUVEAU PROJET FINAL</b>");
    expect(t).toContain("📝 Projet final &lt;web&gt;");
    expect(t).toContain("📅 À rendre le : <b>vendredi 27 novembre</b>");
    expect(t).toContain("🕒 Horaire : <b>14:00–16:30</b>");
    expect(t).toContain("Rendu sur Boostcamp");
    expect(t).toContain(`${APP}/controles/`);
    expect(t).not.toContain("📎");
    const one = formatExamAnnounce({ ...e, attachments: ["sujet.pdf"] }, APP);
    expect(one).toContain("📎 Pièce jointe : sujet.pdf");
    const two = formatExamAnnounce({ ...e, attachments: ["sujet.pdf", "barème <v2>.pdf"] }, APP);
    expect(two).toContain("📎 2 pièces jointes :\n  • sujet.pdf\n  • barème &lt;v2&gt;.pdf");
    expect(two).toContain("télécharger les pièces jointes</a>");
    expect(examAlerts([e], new Set(), NOW, APP)[0].text).toContain("PROJET FINAL À RENDRE DANS 4 JOURS");
  });

  it("séance EVALUATION → ligne edt ; autres séances ignorées", () => {
    expect(examRowFromSnapshot(S({ uid: "x", type: "EVALUATION" }))).toEqual({
      source: "edt",
      edt_uid: "x",
      kind: "controle",
      subject_label: "Algorithmique et programmation C",
      title: "",
      exam_date: "2026-11-25",
      start_time: "09:00",
      end_time: "12:00",
      location: "Salle EM319 - EIFFEL 1",
      english_group: null,
    });
    expect(examRowFromSnapshot(S({ uid: "y" }))).toBeNull();
    // Anglais : le groupe vient du champ « TD » de la séance.
    const en = examRowFromSnapshot(S({ uid: "en", type: "EVALUATION", matiere: "Anglais professionnel & technique avancé" }));
    expect(en?.english_group).toBe("IA Gr1");
    expect(examRowFromSnapshot(S({ uid: "z", type: "EVALUATION", status: "cancelled" }))).toBeNull();
  });
});

describe("contrôles d'anglais : groupe", () => {
  it("le groupe figure dans l'annonce et les rappels", () => {
    const row = {
      id: "g1",
      kind: "controle" as const,
      title: "Oral",
      exam_date: "2026-11-30",
      start_time: null,
      end_time: null,
      location: null,
      source: "manual" as const,
      edt_uid: null,
      subject_label: null,
      english_group: "Anglais avancé <Gr2>",
      subjects: { name: "Anglais" },
    };
    const e = examFromRow(row);
    expect(e.group).toBe("Anglais avancé <Gr2>");
    expect(formatExamAnnounce(e, APP)).toContain("📚 Matière : <b>Anglais</b> (groupe Anglais avancé &lt;Gr2&gt;)");
    expect(examAlerts([e], new Set(), NOW, APP)[0].text).toContain("(groupe Anglais avancé &lt;Gr2&gt;)");
    expect(formatExamAnnounce(examFromRow({ ...row, english_group: null }), APP)).not.toContain("groupe");
  });
});
