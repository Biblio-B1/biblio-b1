import { describe, expect, it } from "vitest";
import { examItems, findDuplicates, homeworkItems, type DueItem } from "@/lib/duplicates";

const existing: DueItem[] = [
  ...homeworkItems([
    { id: "h1", subjectId: "c", subjectName: "Algorithmique et programmation C", dueDate: "2026-12-02", title: "TD pointeurs", isFinalProject: false, authorName: "Lea" },
    { id: "h2", subjectId: "web", subjectName: "Développement web", dueDate: "2026-12-02", title: "Site", isFinalProject: true, authorName: "Tom" },
  ]),
  ...examItems([
    { id: "e1", subjectId: null, subjectName: "ALGORITHMIQUE et programmation  C", date: "2026-12-16", title: "", startTime: "08:30", authorName: null, source: "edt" },
  ]),
];

describe("doublons possibles", () => {
  it("même matière (identifiant) et même date, quel que soit le type", () => {
    expect(findDuplicates({ subjectId: "c", subjectName: "Algorithmique et programmation C", date: "2026-12-02" }, existing).map((d) => d.id)).toEqual(["h1"]);
    expect(findDuplicates({ subjectId: "web", subjectName: "Développement web", date: "2026-12-02" }, existing)[0]).toMatchObject({ id: "h2", kind: "projet" });
  });

  it("contrôle de l'emploi du temps : reconnu par le nom de la matière (casse, espaces)", () => {
    const d = findDuplicates({ subjectId: "c", subjectName: "Algorithmique et programmation C", date: "2026-12-16" }, existing);
    expect(d.map((x) => [x.id, x.kind, x.title])).toEqual([["e1", "controle", "à 08h30 (emploi du temps Boostcamp)"]]);
  });

  it("autre date, autre matière ou date vide : aucun doublon", () => {
    expect(findDuplicates({ subjectId: "c", subjectName: "Algorithmique et programmation C", date: "2026-12-03" }, existing)).toEqual([]);
    expect(findDuplicates({ subjectId: "maths", subjectName: "Mathématiques", date: "2026-12-02" }, existing)).toEqual([]);
    expect(findDuplicates({ subjectId: "c", subjectName: "Algorithmique et programmation C", date: "" }, existing)).toEqual([]);
  });
});
