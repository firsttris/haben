import { describe, expect, it } from "vitest";
import { pdfData } from "./pdf.ts";
import { sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
import type { InvoiceFormat } from "./types.ts";
import { buildEInvoice } from "./xml.ts";

/*
 * Unsere Lieferantennummer beim Kunden (#711) als Verkäuferkennung BT-29 „Seller identifier“ (EN 16931-1, 0..n): UBL
 * cac:AccountingSupplierParty/cac:Party/cac:PartyIdentification/cbc:ID, CII ram:SellerTradeParty/ram:ID. Ohne schemeID
 * (BT-29-1), denn der Kunde vergibt die Nummer selbst. Im PDF steht sie im Kopf. Alle Nummern sind erfunden.
 */

const buyer = { ...sampleBuyer, unsereLieferantennummer: "70815" };
const FORMATS: InvoiceFormat[] = ["zugferd", "xrechnung-cii", "xrechnung-ubl"];

function sellerBlock(xml: string, format: InvoiceFormat): string {
  const pattern =
    format === "xrechnung-ubl"
      ? /<cac:AccountingSupplierParty>([\s\S]*?)<\/cac:AccountingSupplierParty>/
      : /<ram:SellerTradeParty>([\s\S]*?)<\/ram:SellerTradeParty>/;
  return xml.match(pattern)?.[1] ?? "";
}

/** Alle Verkäuferkennungen (BT-29) ohne schemeID, in der Reihenfolge der Datei; im CII die ram:ID vor ram:Name */
function sellerIds(xml: string, format: InvoiceFormat): string[] {
  const block = sellerBlock(xml, format);
  if (format === "xrechnung-ubl") return [...block.matchAll(/<cac:PartyIdentification>\s*<cbc:ID>([^<]*)<\/cbc:ID>/g)].map((m) => m[1]!);
  return [...block.split("<ram:Name>")[0]!.matchAll(/<ram:ID>([^<]*)<\/ram:ID>/g)].map((m) => m[1]!);
}

describe("Unsere Lieferantennummer als Verkäuferkennung (BT-29)", () => {
  it.each(FORMATS)("steht beim Verkäufer, ohne schemeID, nicht beim Käufer (%s)", async (format) => {
    const { xml } = await buildEInvoice(sampleDocument({ format, buyer }));
    expect(sellerIds(xml, format)).toEqual(["70815"]);
    expect(sellerBlock(xml, format)).not.toMatch(/ID schemeID="[^"]*">70815</);
    expect(xml.split("70815").length - 1).toBe(1);
  });

  it.each(FORMATS)("ohne USt-IdNr. steht sie vor der Steuernummer, die BR-CO-26 erfüllt (%s)", async (format) => {
    const { xml } = await buildEInvoice({ ...sampleDocument({ format, buyer }), seller: { ...sampleSeller, ustId: undefined } });
    expect(sellerIds(xml, format)).toEqual(["70815", sampleSeller.steuernummer]);
  });

  it.each(FORMATS)("ohne Lieferantennummer keine Verkäuferkennung, solange die USt-IdNr. da ist (%s)", async (format) => {
    const { xml } = await buildEInvoice(sampleDocument({ format, buyer: sampleBuyer }));
    expect(sellerIds(xml, format)).toEqual([]);
  });
});

describe("Unsere Lieferantennummer im Kopf des PDFs", () => {
  it("steht nach der Kundennummer", () => {
    const meta = pdfData(sampleDocument({ buyer })).meta;
    const labels = meta.map((row) => row.label);
    expect(meta).toContainEqual({ label: "Lieferantennummer", value: "70815" });
    expect(labels.indexOf("Lieferantennummer")).toBe(labels.indexOf("Kundennummer") + 1);
  });

  it("auf Englisch als Supplier number", () => {
    expect(pdfData({ ...sampleDocument({ buyer }), language: "en" }).meta).toContainEqual({ label: "Supplier number", value: "70815" });
  });

  it("fehlt ohne Nummer", () => {
    expect(pdfData(sampleDocument()).meta.map((row) => row.label)).not.toContain("Lieferantennummer");
  });
});
