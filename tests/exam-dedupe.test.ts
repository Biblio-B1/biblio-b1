import { describe, expect, it } from "vitest";
import { edtSessionKey, uniqueExamRows } from "../supabase/functions/_shared/channel-core";
import { uniqueExams, type ExamRow } from "@/lib/api/exams";

describe("contrôles de l'emploi du temps : jamais en double", () => {
  it("l'identifiant de séance ne dépend pas de l'élève", () => {
    expect(edtSessionKey("Cours-2037424-20-BLOSSIER_Manech-Index-Education")).toBe("Cours-2037424-20");
    expect(edtSessionKey("Cours-2037424-20-DE_LA_TOUR_Jean-Marc-Index-Education")).toBe("Cours-2037424-20");
    expect(edtSessionKey("autre-uid")).toBe("autre-uid");
  });

  it("une ligne par séance, ou par matière, groupe, date et heure", () => {
    const row = (edt_uid: string, over: Partial<{ start_time: string; subject_label: string; english_group: string | null }> = {}) => ({
      edt_uid,
      exam_date: "2026-12-18",
      start_time: "15:15",
      subject_label: "TECHAWAY-DATAANALYSIS-N1",
      english_group: null as string | null,
      ...over,
    });
    const rows = [row("Cours-1-20"), row("Cours-1-20"), row("Cours-2-20"), row("Cours-3-20", { start_time: "08:30" }), row("Cours-4-20", { subject_label: "Anglais", english_group: "Gr1" }), row("Cours-5-20", { subject_label: "Anglais", english_group: "Gr2" })];
    expect(uniqueExamRows(rows).map((r) => r.edt_uid)).toEqual(["Cours-1-20", "Cours-3-20", "Cours-4-20", "Cours-5-20"]);
  });

  it("affichage : les doublons de l'emploi du temps sont retirés, pas les contrôles ajoutés à la main", () => {
    const e = (id: string, source: "edt" | "manual"): ExamRow => ({
      id, subjectId: null, subjectName: "Maths", subjectColor: "#000", title: "", date: "2026-12-17", startTime: "10:30", endTime: "12:00",
      location: null, details: null, englishGroup: null, source, edtUid: source === "edt" ? id : null, authorId: null, authorName: null, attachments: [],
    });
    expect(uniqueExams([e("a", "edt"), e("b", "edt"), e("c", "manual")]).map((x) => x.id)).toEqual(["a", "c"]);
  });
});
