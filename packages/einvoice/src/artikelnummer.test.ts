import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_OPTIONS } from "@haben/core";
import { describe, expect, it } from "vitest";
import { buildDeliveryNotePdf, deliveryNotePdfData } from "./order.ts";
import { pdfData, renderInvoicePdf } from "./pdf.ts";
import { quotePdfData } from "./quote.ts";
import { sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
import { type SheetData, sheetText } from "./sheet-text.ts";
import type { InvoiceDocument, InvoiceFormat } from "./types.ts";
import { buildEInvoice } from "./xml.ts";

// Artikelnummer des Verkäufers (BT-155, Item Seller's identifier, EN 16931-1), höchstens eine je Position (#388).
// Syntax: UBL cac:Item/cac:SellersItemIdentification/cbc:ID (PEPPOL BIS Billing 3.0), CII
// ram:SpecifiedTradeProduct/ram:SellerAssignedID; Factur-X/ZUGFeRD 2.5 erlaubt es ab dem Profil EN 16931.

/** Text eines PDFs mit pdftotext -layout (poppler-utils); ohne das Werkzeug null */
function pdfText(pdf: Uint8Array): string | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-artikelnummer-"));
  try {
    writeFileSync(join(dir, "beleg.pdf"), pdf);
    return execFileSync("pdftotext", ["-layout", join(dir, "beleg.pdf"), "-"], { encoding: "utf8" });
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Erste Position mit Artikelnummer ET-1042, die zweite ohne */
function withItemNumber(doc: InvoiceDocument, number = "ET-1042"): InvoiceDocument {
  return { ...doc, lines: doc.lines.map((line, i) => (i === 0 ? { ...line, itemNumber: number } : line)) };
}

const FORMATS: InvoiceFormat[] = ["zugferd", "xrechnung-cii", "xrechnung-ubl"];

describe("Artikelnummer in der E-Rechnung (BT-155)", () => {
  it.each(["zugferd", "xrechnung-cii"] as const)("schreibt ram:SellerAssignedID vor den Namen des Produkts (%s)", async (format) => {
    const { xml } = await buildEInvoice(withItemNumber(sampleDocument({ format })));
    expect(xml).toMatch(
      /<ram:SpecifiedTradeProduct>\s*<ram:SellerAssignedID>ET-1042<\/ram:SellerAssignedID>\s*<ram:Name>Softwareentwicklung September<\/ram:Name>/,
    );
    expect(xml.match(/<ram:SellerAssignedID>/g)).toHaveLength(1);
  });

  it("schreibt cac:SellersItemIdentification hinter den Namen ins UBL", async () => {
    const { xml } = await buildEInvoice(withItemNumber(sampleDocument({ format: "xrechnung-ubl" })));
    expect(xml).toMatch(
      /<cbc:Name>Softwareentwicklung September<\/cbc:Name>\s*<cac:SellersItemIdentification>\s*<cbc:ID>ET-1042<\/cbc:ID>\s*<\/cac:SellersItemIdentification>/,
    );
    expect(xml.match(/<cac:SellersItemIdentification>/g)).toHaveLength(1);
  });

  it("schreibt die Artikelnummer auch in die Gutschrift (Storno)", async () => {
    const { xml } = await buildEInvoice(withItemNumber(sampleDocument({ kind: "storno", format: "xrechnung-ubl" })));
    expect(xml).toContain("<CreditNote ");
    expect(xml).toMatch(/<cac:SellersItemIdentification>\s*<cbc:ID>ET-1042<\/cbc:ID>/);
  });

  it.each(FORMATS)("schreibt ohne Artikelnummer nichts davon (%s)", async (format) => {
    const { xml } = await buildEInvoice(withItemNumber(sampleDocument({ format }), "  "));
    expect(xml).not.toMatch(/SellersItemIdentification|SellerAssignedID/);
  });
});

describe("Artikelnummer im PDF", () => {
  it("zeigt die Spalte „Art.-Nr.“, wenn eine Position eine Nummer hat", () => {
    const data = pdfData(withItemNumber(sampleDocument()));
    expect(data.itemNumbers).toBe(true);
    expect(data.labels.columns.itemNumber).toBe("Art.-Nr.");
    expect(data.lines.map((l) => l.itemNumber)).toEqual(["ET-1042", ""]);
    expect(pdfData({ ...withItemNumber(sampleDocument()), language: "en" }).labels.columns.itemNumber).toBe("Item no.");
  });

  it("sieht ohne Nummern aus wie bisher", () => {
    const doc = sampleDocument();
    expect(pdfData(withItemNumber(doc, "")).itemNumbers).toBe(false);
    expect(pdfData(withItemNumber(doc, ""))).toEqual(pdfData(doc));
  });

  it("setzt die Spalte im gerenderten PDF", () => {
    const text = pdfText(renderInvoicePdf(withItemNumber(sampleDocument())));
    if (text === null) return;
    expect(text).toMatch(/Pos\.\s+Art\.-Nr\.\s+Beschreibung/);
    expect(text).toMatch(/1\s+ET-1042\s+Softwareentwicklung September/);
    expect(pdfText(renderInvoicePdf(sampleDocument()))).not.toContain("Art.-Nr.");
  });

  it("zeigt die Nummer im Angebot und im Lieferschein", () => {
    const lines = withItemNumber(sampleDocument()).lines;
    const quote = quotePdfData({
      number: "AN-2026-007",
      issueDate: "2026-09-01",
      validUntil: "2026-10-01",
      seller: sampleSeller,
      buyer: sampleBuyer,
      lines,
      totals: sampleDocument().totals,
    });
    expect(quote.itemNumbers).toBe(true);
    expect(quote.lines[0]!.itemNumber).toBe("ET-1042");
    const deliveryNote = {
      reference: { kind: "rechnung" as const, number: "2026-034", issueDate: "2026-10-02" },
      deliveryDate: "2026-09-30",
      date: "2026-10-02",
      seller: sampleSeller,
      buyer: sampleBuyer,
      lines,
    };
    const note = deliveryNotePdfData(deliveryNote);
    expect(note.itemNumbers).toBe(true);
    expect(note.lines.map((l) => l.itemNumber)).toEqual(["ET-1042", ""]);
    // Lieferschein ohne Preise: Pos., Art.-Nr., Beschreibung, Menge
    const text = pdfText(buildDeliveryNotePdf(deliveryNote));
    if (text !== null) expect(text).toMatch(/1\s+ET-1042\s+Softwareentwicklung September/);
  });
});

describe("Schalter „Artikelnummer“ der Gestaltung", () => {
  const aus = { ...DEFAULT_OPTIONS, itemNumber: false };
  const doc = () => withItemNumber(sampleDocument({}));

  it("zeigt die Spalte als Vorgabe, sobald eine Position eine Nummer hat", () => {
    expect(pdfData({ ...doc(), options: DEFAULT_OPTIONS }).itemNumbers).toBe(true);
  });

  it("blendet die Spalte in Rechnung, Angebot und Lieferschein aus", () => {
    expect(pdfData({ ...doc(), options: aus }).itemNumbers).toBe(false);
    const quote = { ...doc(), validUntil: "2026-12-31", options: aus } as unknown as Parameters<typeof quotePdfData>[0];
    expect(quotePdfData(quote).itemNumbers).toBe(false);
    const note = {
      reference: { kind: "rechnung", number: "R-1", issueDate: "2026-10-01" },
      deliveryDate: "2026-10-02",
      date: "2026-10-02",
      seller: sampleSeller,
      buyer: sampleBuyer,
      lines: doc().lines,
      options: aus,
    } as const;
    expect(deliveryNotePdfData({ ...note, lines: [...note.lines] }).itemNumbers).toBe(false);
  });

  it("nimmt die Spalte auch aus dem PDF", () => {
    const text = pdfText(renderInvoicePdf({ ...doc(), options: aus }));
    if (text === null) return;
    expect(text).not.toContain("ET-1042");
    expect(text).not.toContain("Art.-Nr.");
  });

  it("lässt die Nummer im XML stehen (BT-155)", async () => {
    const { xml } = await buildEInvoice({ ...withItemNumber(sampleDocument({ format: "zugferd" })), options: aus });
    expect(xml).toContain("<ram:SellerAssignedID>ET-1042</ram:SellerAssignedID>");
  });

  it("nimmt die Nummer auch aus dem Text für Screenreader", () => {
    const data = pdfData({ ...doc(), options: aus }) as unknown as SheetData;
    expect(sheetText(data).flatMap((part) => part.lines).join("\n")).not.toContain("ET-1042");
  });
});
