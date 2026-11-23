import { describe, expect, it } from "vitest";
import { displayTeacherName, extractTeachers, mailLinks } from "@/lib/teachers";

const ev = (description?: string) => ({
  uid: Math.random().toString(),
  title: "x",
  start: "2026-11-23T08:00:00Z",
  end: "2026-11-23T09:00:00Z",
  allDay: false,
  description,
});

describe("extractTeachers", () => {
  it("relève les enseignants et leurs matières dans les descriptions Boostcamp", () => {
    const t = extractTeachers([
      ev("Matière : Soutien Programmation C\nEnseignant : M. VANDAMME SIMON\nTD : Bch B1\nType : CRS-CV"),
      ev("Matière : Algorithmique et programmation C\nEnseignant : M. VANDAMME SIMON\nType : CRS"),
      ev("Matière : Communication & posture professionnelle\nEnseignant : Mme COUDERT CAROLE\nSalle : G017"),
      ev("Matière : Maths\nType : ELEARNING"),
      ev(undefined),
    ]);
    expect(t).toEqual([
      { name: "M. VANDAMME SIMON", subjects: ["Algorithmique et programmation C", "Soutien Programmation C"] },
      { name: "Mme COUDERT CAROLE", subjects: ["Communication & posture professionnelle"] },
    ]);
  });

  it("plusieurs enseignants sur une séance", () => {
    expect(extractTeachers([ev("Matière : Projet\nEnseignants : M. A B, Mme C D")]).map((t) => t.name)).toEqual(["M. A B", "Mme C D"]);
  });
});

describe("displayTeacherName", () => {
  it("met les noms en capitales initiales", () => {
    expect(displayTeacherName("M. VANDAMME SIMON")).toBe("M. Vandamme Simon");
    expect(displayTeacherName("Mme LE-BRIS ANNE-MARIE")).toBe("Mme Le-Bris Anne-Marie");
  });
});

describe("mailLinks", () => {
  it("lien mailto et brouillon Outlook avec objet et message encodés", () => {
    const l = mailLinks({ to: ["a@ecole.fr", "b@ecole.fr"], subject: "Question TP 3", body: "Bonjour,\nmerci & à bientôt" });
    expect(l.mailto).toBe("mailto:a@ecole.fr,b@ecole.fr?subject=Question%20TP%203&body=Bonjour%2C%0Amerci%20%26%20%C3%A0%20bient%C3%B4t");
    const u = new URL(l.outlook);
    expect(u.origin + u.pathname).toBe("https://outlook.office.com/mail/deeplink/compose");
    expect(u.searchParams.get("to")).toBe("a@ecole.fr,b@ecole.fr");
    expect(u.searchParams.get("subject")).toBe("Question TP 3");
    expect(u.searchParams.get("body")).toBe("Bonjour,\nmerci & à bientôt");
  });

  it("sans objet ni message : seulement le destinataire", () => {
    expect(mailLinks({ to: ["a@ecole.fr"] }).mailto).toBe("mailto:a@ecole.fr");
  });
});
