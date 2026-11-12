import { describe, expect, it } from "vitest";
import { pdfData } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";
import { type SheetData, sheetText } from "./sheet-text.ts";
import { buildEInvoice } from "./xml.ts";
import { extractFacturXXml } from "./zugferd.ts";

const notice =
  "Bei steuerpflichtigen Grundstücksleistungen für den privaten Bereich sind diese Rechnung, ein Zahlungsbeleg oder eine andere beweiskräftige Unterlage zwei Jahre aufzubewahren (§ 14b Abs. 1 Satz 5 UStG). Die Frist beginnt mit dem Schluss des Kalenderjahres der Rechnungsausstellung.";

describe("Aufbewahrungshinweis bei Grundstücksleistungen (#718)", () => {
  it("steht im Pflichttext unter den Summen und im zugänglichen Blatttext, ohne den freien Hinweis zu ersetzen", () => {
    const doc = { ...sampleDocument({ note: "Bitte _pünktlich_ zahlen." }), propertyRetention: true };
    const data = pdfData(doc);
    expect(data.taxNote).toBe(notice);
    expect(data.note).toBe(doc.note);
    expect(sheetText(data as unknown as SheetData).flatMap((part) => part.lines).join("\n")).toContain(notice);
  });

  it("erhält den Kleinunternehmerhinweis, wenn der Haken freiwillig gesetzt ist", () => {
    const doc = sampleDocument({ taxTreatment: "kleinunternehmer" });
    const taxNote = pdfData(doc).taxNote;
    const withNotice = { ...doc, propertyRetention: true };
    const data = pdfData(withNotice);
    expect(data.taxNote).toContain(taxNote);
    expect(data.taxNote).toContain(notice);
    expect(data.taxNote!.indexOf(taxNote!)).toBeLessThan(data.taxNote!.indexOf(notice));
  });

  it("nennt in englischen Belegen ebenfalls Dauer und Fristbeginn", () => {
    const doc = { ...sampleDocument(), language: "en" as const, propertyRetention: true };
    const text = pdfData(doc).taxNote;
    expect(text).toContain("two years");
    expect(text).toContain("end of the calendar year");
    expect(text).toContain("§ 14b(1), sentence 5 UStG");
  });

  it("ändert ohne Haken keine bisherigen PDF-Daten", () => {
    const doc = sampleDocument({ note: "Unveränderter Freitext" });
    const off = { ...doc, propertyRetention: false };
    expect(pdfData(off)).toEqual(pdfData(doc));
  });

  it.each(["xrechnung-ubl", "xrechnung-cii", "zugferd"] as const)("steht bei %s als eigener BT-22 neben den Nutzereingaben", async (format) => {
    const doc = { ...sampleDocument({ format, intro: "Terrassenrenovierung", note: "Vielen Dank." }), propertyRetention: true };
    const { xml, pdf } = await buildEInvoice(doc);
    const tag = format === "xrechnung-ubl" ? "cbc:Note" : "ram:Content";
    expect(xml).toContain(`<${tag}>${notice}</${tag}>`);
    expect(xml).toContain(`<${tag}>Terrassenrenovierung</${tag}>`);
    expect(xml).toContain(`<${tag}>Vielen Dank.</${tag}>`);
    if (format === "zugferd") expect(extractFacturXXml(pdf)).toBe(xml);
  });

  it("ändert ohne Haken kein bestehendes XML", async () => {
    const doc = sampleDocument({ format: "xrechnung-ubl" });
    const original = await buildEInvoice(doc);
    const disabled = { ...doc, propertyRetention: false };
    const off = await buildEInvoice(disabled);
    expect(off.xml).toBe(original.xml);
  });
});
