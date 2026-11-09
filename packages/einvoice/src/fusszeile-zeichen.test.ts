import { DEFAULT_OPTIONS, footerIssues } from "@haben/core";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";

/** TDD-Review #420: Die Fußzeile gilt für jeden Beleg; was Typst in PDF/A nicht setzen kann, darf sie nicht unbemerkt speichern */
describe("Eigene Fußzeile: Zeichen ohne Schrift", () => {
  it("weist Zeichen ohne Schrift beim Speichern ab oder erzeugt trotzdem ein PDF", () => {
    const footerColumns = ["電話 {telefon}", "{steuernummer}"];
    if (footerIssues(footerColumns).length > 0) return;
    expect(() => renderInvoicePdf({ ...sampleDocument(), options: { ...DEFAULT_OPTIONS, footerColumns } })).not.toThrow();
  });

  it.each(["📞", "📧", "👍"])("weist auch %s ab oder erzeugt trotzdem ein PDF", (zeichen) => {
    const footerColumns = [`${zeichen} Kontakt`, "{steuernummer}"];
    if (footerIssues(footerColumns).length > 0) return;
    expect(() => renderInvoicePdf({ ...sampleDocument(), options: { ...DEFAULT_OPTIONS, footerColumns } })).not.toThrow();
  });

  it.each(["、", "「", "㎏", "✅", "Ａ"])("weist auch %s aus der Grundebene ab oder erzeugt trotzdem ein PDF", (zeichen) => {
    const footerColumns = [`${zeichen} Kontakt`, "{steuernummer}"];
    if (footerIssues(footerColumns).length > 0) return;
    expect(() => renderInvoicePdf({ ...sampleDocument(), options: { ...DEFAULT_OPTIONS, footerColumns } })).not.toThrow();
  });
});
