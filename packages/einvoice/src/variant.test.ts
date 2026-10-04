import { describe, expect, it } from "vitest";
import { pdfData } from "./pdf.ts";
import { sampleDocument } from "./samples.ts";
import { toEInvoiceData } from "./xml.ts";

describe("Abschlags- und Schlussrechnung", () => {
  it("Abschlagsrechnung: eigener Titel, Typ 326", () => {
    const doc = { ...sampleDocument(), variant: "abschlag" as const };
    expect(pdfData(doc).title).toBe("Abschlagsrechnung");
    expect(pdfData({ ...doc, language: "en" }).title).toBe("Partial invoice");
    expect(toEInvoiceData(doc)["ubl:Invoice"]["cbc:InvoiceTypeCode"]).toBe("326");
  });

  it("Schlussrechnung: Typ 380 mit Bezug auf jede Abschlagsrechnung", () => {
    const doc = {
      ...sampleDocument(),
      variant: "schluss" as const,
      deducted: [
        { number: "2026-030", issueDate: "2026-09-15" },
        { number: "2026-031", issueDate: "2026-09-30" },
      ],
    };
    expect(pdfData(doc).title).toBe("Schlussrechnung");
    const invoice = toEInvoiceData(doc)["ubl:Invoice"];
    expect(invoice["cbc:InvoiceTypeCode"]).toBe("380");
    expect(invoice["cac:BillingReference"]?.map((r) => r["cac:InvoiceDocumentReference"]["cbc:ID"])).toEqual(["2026-030", "2026-031"]);
    // Storno einer Abschlagsrechnung bleibt eine Stornorechnung
    expect(pdfData({ ...sampleDocument({ kind: "storno" }), variant: "abschlag" }).title).toBe("Stornorechnung");
  });
});
