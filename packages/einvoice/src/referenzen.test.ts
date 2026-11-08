import { describe, expect, it } from "vitest";
import { pdfData } from "./pdf.ts";
import { quotePdfData } from "./quote.ts";
import { confirmationPdfData, deliveryNotePdfData } from "./order.ts";
import { sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
import type { InvoiceFormat, OrderReferences } from "./types.ts";
import { buildEInvoice } from "./xml.ts";

// Bestellnummer des Kunden (BT-13), eigene Auftragsnummer (BT-14) und Lieferschein (BT-16) nach EN 16931-1.
// Syntax: UBL cac:OrderReference/cbc:ID, cbc:SalesOrderID, cac:DespatchDocumentReference/cbc:ID (PEPPOL BIS Billing 3.0);
// CII ram:BuyerOrderReferencedDocument, ram:SellerOrderReferencedDocument (in ApplicableHeaderTradeAgreement) und
// ram:DespatchAdviceReferencedDocument (in ApplicableHeaderTradeDelivery), je mit ram:IssuerAssignedID.
// Factur-X/ZUGFeRD 2.5 erlaubt alle drei im Profil EN 16931 (FACTUR-X_EN16931.xsd).

const references: OrderReferences = { buyerOrder: "4500012345", sellerOrder: "AN-2026-007", despatchAdvice: "LS-0815" };
const FORMATS: InvoiceFormat[] = ["zugferd", "xrechnung-cii", "xrechnung-ubl"];

describe("Referenzen in der E-Rechnung", () => {
  it.each(["zugferd", "xrechnung-cii"] as const)("schreibt BT-13, BT-14 und BT-16 an ihre Stelle im CII (%s)", async (format) => {
    const { xml } = await buildEInvoice({ ...sampleDocument({ format }), references });
    const agreement = xml.match(/<ram:ApplicableHeaderTradeAgreement>([\s\S]*?)<\/ram:ApplicableHeaderTradeAgreement>/)?.[1] ?? "";
    // Reihenfolge laut Schema: SellerOrderReferencedDocument vor BuyerOrderReferencedDocument
    expect(agreement).toMatch(
      /<ram:SellerOrderReferencedDocument>\s*<ram:IssuerAssignedID>AN-2026-007<\/ram:IssuerAssignedID>\s*<\/ram:SellerOrderReferencedDocument>\s*<ram:BuyerOrderReferencedDocument>\s*<ram:IssuerAssignedID>4500012345<\/ram:IssuerAssignedID>\s*<\/ram:BuyerOrderReferencedDocument>/,
    );
    const delivery = xml.match(/<ram:ApplicableHeaderTradeDelivery>([\s\S]*?)<\/ram:ApplicableHeaderTradeDelivery>/)?.[1] ?? "";
    // Nach dem Lieferdatum (ActualDeliverySupplyChainEvent), falls vorhanden
    expect(delivery).toMatch(
      /<ram:DespatchAdviceReferencedDocument>\s*<ram:IssuerAssignedID>LS-0815<\/ram:IssuerAssignedID>\s*<\/ram:DespatchAdviceReferencedDocument>\s*$/,
    );
    for (const value of Object.values(references)) expect(xml.split(value).length - 1).toBe(1);
  });

  it("schreibt BT-16 im CII hinter das Lieferdatum", async () => {
    const doc = { ...sampleDocument({ format: "xrechnung-cii" }), serviceFrom: "2026-09-30", serviceTo: "2026-09-30", references };
    const { xml } = await buildEInvoice(doc);
    expect(xml).toMatch(/<\/ram:ActualDeliverySupplyChainEvent>\s*<ram:DespatchAdviceReferencedDocument>/);
  });

  it("schreibt BT-13, BT-14 und BT-16 ins UBL", async () => {
    const { xml } = await buildEInvoice({ ...sampleDocument({ format: "xrechnung-ubl" }), references });
    expect(xml).toMatch(/<cac:OrderReference>\s*<cbc:ID>4500012345<\/cbc:ID>\s*<cbc:SalesOrderID>AN-2026-007<\/cbc:SalesOrderID>\s*<\/cac:OrderReference>/);
    expect(xml).toMatch(/<cac:DespatchDocumentReference>\s*<cbc:ID>LS-0815<\/cbc:ID>\s*<\/cac:DespatchDocumentReference>/);
  });

  it("setzt im UBL ohne Bestellnummer NA in cbc:ID, wenn es eine Auftragsnummer gibt (PEPPOL, cac:OrderReference/cbc:ID)", async () => {
    const { xml } = await buildEInvoice({ ...sampleDocument({ format: "xrechnung-ubl" }), references: { sellerOrder: "AN-2026-007" } });
    expect(xml).toMatch(/<cac:OrderReference>\s*<cbc:ID>NA<\/cbc:ID>\s*<cbc:SalesOrderID>AN-2026-007<\/cbc:SalesOrderID>/);
    const cii = await buildEInvoice({ ...sampleDocument({ format: "xrechnung-cii" }), references: { sellerOrder: "AN-2026-007" } });
    expect(cii.xml).not.toContain("BuyerOrderReferencedDocument");
    expect(cii.xml).not.toContain(">NA<");
  });

  it.each(FORMATS)("schreibt jede Referenz auch allein (%s)", async (format) => {
    for (const [key, value] of Object.entries(references)) {
      const { xml } = await buildEInvoice({ ...sampleDocument({ format }), references: { [key]: value } });
      expect(xml).toContain(`>${value}<`);
    }
  });

  it.each(FORMATS)("schreibt ohne Referenzen nichts davon (%s)", async (format) => {
    const { xml } = await buildEInvoice({ ...sampleDocument({ format }), references: { buyerOrder: "  ", sellerOrder: "", despatchAdvice: "" } });
    expect(xml).not.toMatch(/OrderReference|OrderReferencedDocument|DespatchDocumentReference|DespatchAdviceReferencedDocument/);
  });

  it("schreibt die Referenzen auch in Storno und Korrektur (Gutschrift)", async () => {
    const { xml } = await buildEInvoice({ ...sampleDocument({ kind: "storno", format: "xrechnung-ubl" }), references });
    expect(xml).toContain("<CreditNote ");
    expect(xml).toContain("<cbc:SalesOrderID>AN-2026-007</cbc:SalesOrderID>");
    expect(xml).toContain("<cbc:ID>LS-0815</cbc:ID>");
    const cii = await buildEInvoice({ ...sampleDocument({ kind: "korrektur", format: "zugferd" }), references });
    expect(cii.xml).toContain("<ram:IssuerAssignedID>4500012345</ram:IssuerAssignedID>");
    expect(cii.xml).toContain("<ram:IssuerAssignedID>LS-0815</ram:IssuerAssignedID>");
  });
});

describe("Referenzen im PDF", () => {
  it("zeigt gesetzte Referenzen im Kopfblock der Rechnung", () => {
    const data = pdfData({ ...sampleDocument(), references });
    expect(data.meta).toContainEqual({ label: "Ihre Bestellung", value: "4500012345" });
    expect(data.meta).toContainEqual({ label: "Unser Auftrag", value: "AN-2026-007" });
    expect(data.meta).toContainEqual({ label: "Lieferschein", value: "LS-0815" });
  });

  it("zeigt auf Englisch englische Bezeichnungen", () => {
    const data = pdfData({ ...sampleDocument(), language: "en", references });
    expect(data.meta).toContainEqual({ label: "Your order", value: "4500012345" });
    expect(data.meta).toContainEqual({ label: "Our order", value: "AN-2026-007" });
    expect(data.meta).toContainEqual({ label: "Delivery note", value: "LS-0815" });
  });

  it("sieht ohne Referenzen aus wie bisher", () => {
    const doc = sampleDocument();
    expect(pdfData({ ...doc, references: { buyerOrder: "", sellerOrder: " " } }).meta).toEqual(pdfData(doc).meta);
  });

  const quote = {
    number: "AN-2026-007",
    issueDate: "2026-09-01",
    validUntil: "2026-10-01",
    seller: sampleSeller,
    buyer: sampleBuyer,
    lines: sampleDocument().lines,
    totals: sampleDocument().totals,
    references: { buyerOrder: "4500012345", despatchAdvice: "LS-0815" },
  };

  it("zeigt die Referenzen im Angebot und in der Auftragsbestätigung", () => {
    expect(quotePdfData(quote).meta).toContainEqual({ label: "Ihre Bestellung", value: "4500012345" });
    expect(confirmationPdfData(quote, "2026-09-05").meta).toContainEqual({ label: "Ihre Bestellung", value: "4500012345" });
    expect(quotePdfData(quote).meta).toContainEqual({ label: "Lieferschein", value: "LS-0815" });
  });

  it("zeigt die Referenzen im Lieferschein", () => {
    const data = deliveryNotePdfData({
      reference: { kind: "rechnung", number: "2026-034", issueDate: "2026-10-02" },
      deliveryDate: "2026-09-30",
      date: "2026-10-02",
      seller: sampleSeller,
      buyer: sampleBuyer,
      lines: sampleDocument().lines,
      references: { buyerOrder: "4500012345", sellerOrder: "AN-2026-007" },
    });
    expect(data.meta).toContainEqual({ label: "Ihre Bestellung", value: "4500012345" });
    expect(data.meta).toContainEqual({ label: "Unser Auftrag", value: "AN-2026-007" });
  });
});
