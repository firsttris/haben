import { describe, expect, it } from "vitest";
import { buildEInvoice, netUnitPrice } from "./xml.ts";
import { extractFacturXXml } from "./zugferd.ts";
import { euBuyer, grossPriceLines, mixedRateLines, publicBuyer, sampleDocument, thirdCountryBuyer, zeroRateLines } from "./samples.ts";

const ascii = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

describe("netUnitPrice", () => {
  it("nimmt so viele Nachkommastellen wie nötig, damit Menge × Preis das Zeilennetto ergibt", () => {
    expect(netUnitPrice(824, 1000)).toBe("8.24");
    expect(netUnitPrice(5765, 7000)).toBe("8.236");
    expect(netUnitPrice(829, 23500)).toBe("0.3528");
    expect(netUnitPrice(-5765, 7000)).toBe("8.236");
    expect(netUnitPrice(0, 1000)).toBe("0.00");
  });

  it("bleibt bei großen Mengen innerhalb eines halben Cents", () => {
    const net = 72_626_420;
    const millis = 123_456_789;
    const price = Number(netUnitPrice(net, millis));
    expect(Math.abs((price * millis) / 1000 - net / 100)).toBeLessThanOrEqual(0.005);
  });
});

describe("buildEInvoice", () => {
  it("bettet bei ZUGFeRD factur-x.xml in das PDF ein", async () => {
    const { xml, pdf } = await buildEInvoice(sampleDocument());
    expect(ascii(pdf.subarray(0, 5))).toBe("%PDF-");
    // Dateiname als UTF-16-Hexstring im EmbeddedFiles-Namensbaum
    expect(ascii(pdf)).toContain(Buffer.from("﻿factur-x.xml", "utf16le").swap16().toString("hex").toUpperCase());
    expect(ascii(pdf)).toContain("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>");
    expect(extractFacturXXml(pdf)).toBe(xml);
    expect(xml).toContain("<ram:ID>2026-034</ram:ID>");
    expect(xml).toContain("<ram:TypeCode>380</ram:TypeCode>");
    expect(xml).toContain("<ram:GrandTotalAmount>17409.58</ram:GrandTotalAmount>");
    expect(xml).toContain('<ram:BilledQuantity unitCode="HUR">152</ram:BilledQuantity>');
    expect(xml).toContain('<ram:ID schemeID="FC">13/345/67890</ram:ID>');
    expect(xml).toContain("<ram:IBANID>DE89370400440532013000</ram:IBANID>");
    expect(xml).toContain("<ram:ApplicableHeaderTradeDelivery/>");
  });

  it("schreibt Storno als Gutschrift 381 mit positiven Beträgen und Rechnungsbezug (UBL)", async () => {
    const { xml, pdf } = await buildEInvoice(sampleDocument({ kind: "storno", format: "xrechnung-ubl", lines: mixedRateLines }));
    expect(ascii(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(xml).toContain("<CreditNote ");
    expect(xml).toContain("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>");
    expect(xml).toMatch(/<cac:BillingReference>\s*<cac:InvoiceDocumentReference>\s*<cbc:ID>2026-034<\/cbc:ID>\s*<cbc:IssueDate>2026-09-30<\/cbc:IssueDate>/);
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">3118.82</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:PriceAmount currencyID="EUR">1200.00</cbc:PriceAmount>');
    expect(xml).not.toMatch(/>-\d/);
  });

  it("Bruttopreise: Netto je Satz, Zeilennetto und Netto-Einzelpreis im XML (UBL)", async () => {
    const { xml } = await buildEInvoice(sampleDocument({ format: "xrechnung-ubl", lines: grossPriceLines, priceMode: "brutto" }));
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">447.17</cbc:PayableAmount>');
    expect(xml).toMatch(/<cbc:TaxableAmount currencyID="EUR">275.18<\/cbc:TaxableAmount>\s*<cbc:TaxAmount currencyID="EUR">52.29<\/cbc:TaxAmount>/);
    expect(xml).toMatch(/<cbc:TaxableAmount currencyID="EUR">111.87<\/cbc:TaxableAmount>\s*<cbc:TaxAmount currencyID="EUR">7.83<\/cbc:TaxAmount>/);
    // 7 Abzüge zu 9,80 € brutto: 57,65 € netto, also 8,236 € je Stück
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="EUR">57.65</cbc:LineExtensionAmount>');
    expect(xml).toContain('<cbc:PriceAmount currencyID="EUR">8.236</cbc:PriceAmount>');
    const lineNets = [...xml.matchAll(/<cac:InvoiceLine>[\s\S]*?<cbc:LineExtensionAmount currencyID="EUR">([\d.]+)</g)].map((m) => Number(m[1]));
    expect(lineNets.reduce((a, b) => a + b, 0)).toBeCloseTo(387.05, 2);
  });

  it("Bruttopreise im CII", async () => {
    const { xml } = await buildEInvoice(sampleDocument({ format: "xrechnung-cii", lines: grossPriceLines, priceMode: "brutto" }));
    expect(xml).toContain("<ram:GrandTotalAmount>447.17</ram:GrandTotalAmount>");
    expect(xml).toMatch(/<ram:NetPriceProductTradePrice>\s*<ram:ChargeAmount>8.236<\/ram:ChargeAmount>/);
  });

  it("schreibt Storno als 381 mit Rechnungsbezug (CII)", async () => {
    const { xml } = await buildEInvoice(sampleDocument({ kind: "storno", format: "xrechnung-cii" }));
    expect(xml).toContain("<ram:TypeCode>381</ram:TypeCode>");
    expect(xml).toMatch(/<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>2026-034<\/ram:IssuerAssignedID>/);
    expect(xml).toContain("<ram:DuePayableAmount>17409.58</ram:DuePayableAmount>");
    expect(xml).not.toMatch(/>-\d/);
  });

  it("nutzt die Leitweg-ID als Käuferreferenz und Adresse", async () => {
    const { xml } = await buildEInvoice(sampleDocument({ format: "xrechnung-ubl", buyer: publicBuyer }));
    expect(xml).toContain("urn:xeinkauf.de:kosit:xrechnung_3.0");
    expect(xml).toContain("<cbc:BuyerReference>991-12345-67</cbc:BuyerReference>");
    expect(xml).toContain('<cbc:EndpointID schemeID="0204">991-12345-67</cbc:EndpointID>');
  });

  it("nutzt ohne USt-IdNr. die Steuernummer als Verkäuferkennung (BR-CO-26)", async () => {
    const doc = sampleDocument({ format: "xrechnung-cii" });
    doc.seller = { ...doc.seller, ustId: undefined };
    const { xml } = await buildEInvoice(doc);
    expect(xml).toMatch(/<ram:SellerTradeParty>\s*<ram:ID>13\/345\/67890<\/ram:ID>/);
    expect(xml).not.toContain('schemeID="VA"');
  });

  it("weist Rechnungen mit fehlenden Pflichtangaben zurück", async () => {
    const doc = sampleDocument({ format: "xrechnung-cii" });
    doc.seller = { ...doc.seller, telefon: undefined };
    await expect(buildEInvoice(doc)).rejects.toThrow("Telefonnummer fehlt");
  });

  it("Reverse Charge: Kategorie AE mit Befreiungsgrund", async () => {
    const { xml } = await buildEInvoice(sampleDocument({ format: "xrechnung-ubl", buyer: euBuyer, lines: zeroRateLines, taxTreatment: "reverse_charge" }));
    expect(xml).toContain("<cbc:ID>AE</cbc:ID>");
    expect(xml).toContain("<cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode>");
    expect(xml).toContain("<cbc:CompanyID>ATU12345678</cbc:CompanyID>");
  });

  it("Drittland: Kategorie O ohne USt-IdNrn.", async () => {
    const { xml } = await buildEInvoice(sampleDocument({ format: "xrechnung-ubl", buyer: thirdCountryBuyer, lines: zeroRateLines, taxTreatment: "drittland" }));
    expect(xml).toContain("<cbc:ID>O</cbc:ID>");
    expect(xml).not.toContain("DE123456789");
    expect(xml).not.toContain("CHE-123");
  });

  it("lehnt Reverse Charge ohne USt-IdNr. des Kunden ab", async () => {
    const doc = sampleDocument({ lines: zeroRateLines, taxTreatment: "reverse_charge", buyer: { ...euBuyer, ustId: undefined } });
    await expect(buildEInvoice(doc)).rejects.toThrow("USt-IdNr. des Kunden");
  });
});
