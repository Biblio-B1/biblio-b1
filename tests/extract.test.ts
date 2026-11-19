import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { extractText } from "@/server/extract/text";
import { splitExercises } from "@/server/extract/exercises";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
let dir: string;

async function makePdf(pages: string[][]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage([595, 842]);
    lines.forEach((l, i) => page.drawText(l, { x: 50, y: 780 - i * 20, size: 12, font }));
  }
  return Buffer.from(await pdf.save());
}

function makeDocx(paragraphs: string[]): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "[Content_Types].xml",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
  );
  zip.addFile(
    "_rels/.rels",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  zip.addFile(
    "word/document.xml",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
  );
  return zip.toBuffer();
}

function write(name: string, buf: Buffer | string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, buf);
  return p;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-extract-"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("extractText", () => {
  it("lit un PDF texte avec un titre d'exercice en début de ligne", async () => {
    const p = write("a.pdf", await makePdf([["Exercice 1 : Somme", "Calculer la somme.", "Exercice 2 : Produit", "Calculer le produit."]]));
    const text = await extractText(p, PDF);
    expect(text).toMatch(/^Exercice 1 : Somme$/m);
    expect(text).toMatch(/^Exercice 2 : Produit$/m);
  });

  it("PDF sans texte (scan) -> chaîne vide", async () => {
    const p = write("scan.pdf", await makePdf([[]]));
    expect(await extractText(p, PDF)).toBe("");
  });

  it("lit un .docx", async () => {
    const p = write("a.docx", makeDocx(["Bonjour le monde", "Exercice 1 Pointeurs"]));
    const text = await extractText(p, DOCX);
    expect(text).toContain("Bonjour le monde");
    expect(text).toContain("Exercice 1 Pointeurs");
  });

  it("lit les fichiers texte/code en utf-8, ignore images et pptx", async () => {
    expect(await extractText(write("a.c", "int main() { return 0; }\n// é"), "text/x-csrc")).toContain("é");
    expect(await extractText(write("a.md", "# Titre"), "text/markdown")).toBe("# Titre");
    expect(await extractText(write("a.png", Buffer.from([1, 2, 3])), "image/png")).toBe("");
    expect(await extractText(write("a.pptx", Buffer.from([1, 2, 3])), "application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("");
  });

  it("fichier corrompu ou absent -> '' sans lever", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await extractText(write("bad.pdf", "pas un pdf"), PDF)).toBe("");
    expect(await extractText(write("bad.docx", "pas un docx"), DOCX)).toBe("");
    expect(await extractText(path.join(dir, "absent.pdf"), PDF)).toBe("");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("splitExercises", () => {
  it("découpe un PDF en deux exercices avec titres et corps", async () => {
    const p = write("b.pdf", await makePdf([["Intro du TD", "Exercice 1 : Somme", "Calculer la somme.", "Exercice 2 : Produit", "Calculer le produit."]]));
    const ex = splitExercises(await extractText(p, PDF));
    expect(ex).toHaveLength(2);
    expect(ex[0]).toMatchObject({ number: 1, title: "Exercice 1 : Somme" });
    expect(ex[0].body).toBe("Calculer la somme.");
    expect(ex[1]).toMatchObject({ number: 2, title: "Exercice 2 : Produit", body: "Calculer le produit." });
  });

  it("reconnaît Exercise, Exo, EXERCICE ; ignore le texte avant le premier titre", () => {
    const ex = splitExercises("Préambule\nExercise 3\nDo it\n  EXO 4 - x\nbody\nEXERCICE 5\nz");
    expect(ex.map((e) => e.number)).toEqual([3, 4, 5]);
    expect(ex[0].body).toBe("Do it");
  });

  it("aucun titre ou texte vide -> []", () => {
    expect(splitExercises("")).toEqual([]);
    expect(splitExercises("Rien à voir, l'exercice est ici 1")).toEqual([]);
  });
});

describe("splitExercises : formats et robustesse", () => {
  const nums = (t: string) => splitExercises(t).map((e) => e.number);
  const body = "Écrire une fonction qui calcule la somme des éléments.";

  it.each([
    "Exercice n°3",
    "Exercice N° 3",
    "Exercice no 3",
    "Ex 3",
    "Ex. 3",
    "Exo 3",
    "EXERCICE 3 -",
    "Exercice 3 :",
    "Exercice 3.",
    "Exercise 3:",
    "Exercice 3 – Tableaux",
  ])("reconnaît « %s »", (h) => {
    const ex = splitExercises(`${h}\n${body}`);
    expect(ex).toHaveLength(1);
    expect(ex[0].number).toBe(3);
    expect(ex[0].body).toBe(body);
  });

  it("ne coupe pas sur une phrase coupée ni sur « exemple »", () => {
    const t = `Exercice 1 : A\n${body}\nexercice 1 pour calculer la somme\nExemple 2 de plus`;
    const ex = splitExercises(t);
    expect(ex).toHaveLength(1);
    expect(ex[0].body).toContain("exercice 1 pour calculer");
    expect(nums("Exercice 1 du TD précédent")).toEqual([]);
  });

  it("table des matières : une seule occurrence par numéro, celle au corps substantiel", () => {
    const t = ["Sommaire", "Exercice 1 ........ 2", "Exercice 2 ........ 3", "Exercice 1", "Exercice 2", "Exercice 1 : Somme", body, "Exercice 2 : Produit", body + " bis"].join("\n");
    const ex = splitExercises(t);
    expect(ex.map((e) => e.title)).toEqual(["Exercice 1 : Somme", "Exercice 2 : Produit"]);
    expect(ex[0].body).toBe(body);
  });

  it("même numéro répété sans points de conduite : garde le corps substantiel", () => {
    const ex = splitExercises(["Exercice 1", "Exercice 2", "Exercice 1 : Somme", body, "Exercice 2 : Produit", body].join("\n"));
    expect(ex.map((e) => e.number)).toEqual([1, 2]);
    expect(ex[0].title).toBe("Exercice 1 : Somme");
  });

  it("numérotation qui repart sous une autre partie : les deux sont gardés, titres uniques", () => {
    const ex = splitExercises(["Partie 1", "Exercice 1", body, "Partie 2", "Exercice 1", body + " autre"].join("\n"));
    expect(ex).toHaveLength(2);
    expect(ex.map((e) => e.title)).toEqual(["Partie 1 – Exercice 1", "Partie 2 – Exercice 1"]);
    expect(ex[0].body).toBe(body);
  });
});
