import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTextFormatting } from "@haben/core";
import { pdfData, renderInvoicePdf } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";
import { buildEInvoice, toEInvoiceData } from "./xml.ts";

const hasPoppler = spawnSync("pdftotext", ["-v"]).status === 0;

function formattedDocument() {
  const doc = sampleDocument({ intro: "*Leistungsumfang*", note: "__Abnahme__ und _Freigabe_" });
  doc.lines = doc.lines.map((line, i) => (i === 0 ? { ...line, detail: "**Systempflege** und _Kontrolle_" } : line));
  return doc;
}

describe("Formatierung von PDF und E-Rechnung", () => {
  it("gibt dem PDF dieselben Auszeichnungen wie der Vorschau mit", () => {
    const doc = formattedDocument();
    const data = pdfData(doc);
    expect(data.introFormatted).toEqual(parseTextFormatting(doc.intro!));
    expect(data.noteFormatted).toEqual(parseTextFormatting(doc.note!));
    expect(data.lines[0]!.detailFormatted).toEqual(parseTextFormatting(doc.lines[0]!.detail!));
  });

  it.skipIf(!hasPoppler)("druckt Inhalt ohne Zeichen mit echten fetten und kursiven Schriften", () => {
    const doc = formattedDocument();
    doc.intro += "\n*_Zusammen_*";
    const pdf = renderInvoicePdf(doc);
    const result = spawnSync("pdftotext", ["-raw", "-", "-"], { input: pdf, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Leistungsumfang");
    expect(result.stdout).toContain("Systempflege");
    expect(result.stdout).toContain("Abnahme und Freigabe");
    expect(result.stdout).not.toMatch(/\*Leistungsumfang|__Abnahme|_Freigabe_/);
    const fonts = spawnSync("pdffonts", ["-"], { input: pdf, encoding: "utf8" });
    expect(fonts.status).toBe(0);
    expect(fonts.stdout).toContain("IBMPlexSans-Italic");
    expect(fonts.stdout).toContain("IBMPlexSans-SmBldItalic");
    // Die reguläre Schriftfamilie hat keinen Bold-Schnitt. Eine vorhandene fette
    // Gesamtsumme beweist daher noch nicht, dass der ausgezeichnete Text fett ist.
    const directory = mkdtempSync(join(tmpdir(), "haben-textformat-"));
    try {
      const path = join(directory, "beispiel.pdf");
      writeFileSync(path, pdf);
      const layout = spawnSync("pdftohtml", ["-xml", "-stdout", "-i", path], { encoding: "utf8" });
      expect(layout.status, layout.stderr).toBe(0);
      const boldFonts = [...layout.stdout.matchAll(/<fontspec\b[^>]*id="(\d+)"[^>]*family="[^"]*IBMPlexSans-SmBld"/g)].map((match) => match[1]);
      const heading = layout.stdout.match(/<text\b[^>]*font="(\d+)"[^>]*>Leistungsumfang<\/text>/);
      expect(boldFonts).toContain(heading?.[1]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("übergibt nur Klartext als BT-22 und BT-154", () => {
    const invoice = toEInvoiceData(formattedDocument())["ubl:Invoice"];
    expect(invoice["cbc:Note"]).toEqual(["Leistungsumfang", "Abnahme und Freigabe"]);
    expect(invoice["cac:InvoiceLine"][0]!["cac:Item"]["cbc:Description"]).toBe("Systempflege und Kontrolle");
  });

  it.each(["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const)("entfernt die Zeichen auch aus dem erzeugten %s-XML", async (format) => {
    const { xml } = await buildEInvoice({ ...formattedDocument(), format });
    expect(xml).toContain("Leistungsumfang");
    expect(xml).toContain("Systempflege und Kontrolle");
    expect(xml).not.toMatch(/\*Leistungsumfang|__Abnahme|_Freigabe_/);
  });
});
