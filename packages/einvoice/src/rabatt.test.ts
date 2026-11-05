import { describe, expect, it } from "vitest";
import { pdfData } from "./pdf.ts";
import { discountLines, sampleDocument } from "./samples.ts";
import { buildEInvoice } from "./xml.ts";

const nbsp = (s: string) => s.replace(/ €/g, " €").replace(/ %/g, " %");

describe("Rabatte in der E-Rechnung", () => {
  const doc = sampleDocument({ format: "xrechnung-ubl", lines: discountLines, discount: { kind: "prozent", value: 500 } });

  it("Positionsrabatt als Line allowance (BG-27) mit Grundlage und Prozent, Zeilennetto nach Rabatt", async () => {
    const { xml } = await buildEInvoice(doc);
    expect(xml).toMatch(
      /<cbc:LineExtensionAmount currencyID="EUR">12996.00<\/cbc:LineExtensionAmount>[\s\S]*?<cac:AllowanceCharge>\s*<cbc:ChargeIndicator>false<\/cbc:ChargeIndicator>\s*<cbc:AllowanceChargeReasonCode>95<\/cbc:AllowanceChargeReasonCode>\s*<cbc:AllowanceChargeReason>Rabatt<\/cbc:AllowanceChargeReason>\s*<cbc:MultiplierFactorNumeric>10<\/cbc:MultiplierFactorNumeric>\s*<cbc:Amount currencyID="EUR">1444.00<\/cbc:Amount>\s*<cbc:BaseAmount currencyID="EUR">14440.00<\/cbc:BaseAmount>/,
    );
    // Fester Betrag ohne Prozent und Grundlage
    expect(xml).toMatch(/<cbc:AllowanceChargeReason>Rabatt<\/cbc:AllowanceChargeReason>\s*<cbc:Amount currencyID="EUR">49.00<\/cbc:Amount>/);
  });

  it("Gesamtrabatt je Steuersatz als Document level allowance (BG-20), Summen nach BR-CO-13", async () => {
    const { xml } = await buildEInvoice(doc);
    expect(xml).toMatch(
      /<cbc:MultiplierFactorNumeric>5<\/cbc:MultiplierFactorNumeric>\s*<cbc:Amount currencyID="EUR">672.30<\/cbc:Amount>\s*<cbc:BaseAmount currencyID="EUR">13446.00<\/cbc:BaseAmount>\s*<cac:TaxCategory>\s*<cbc:ID>S<\/cbc:ID>\s*<cbc:Percent>19<\/cbc:Percent>/,
    );
    expect(xml).toMatch(
      /<cbc:Amount currencyID="EUR">7.49<\/cbc:Amount>\s*<cbc:BaseAmount currencyID="EUR">149.70<\/cbc:BaseAmount>\s*<cac:TaxCategory>\s*<cbc:ID>S<\/cbc:ID>\s*<cbc:Percent>7<\/cbc:Percent>/,
    );
    expect(xml).toMatch(/<cbc:LineExtensionAmount currencyID="EUR">13595.70<\/cbc:LineExtensionAmount>\s*<cbc:TaxExclusiveAmount/);
    expect(xml).toContain('<cbc:AllowanceTotalAmount currencyID="EUR">679.79</cbc:AllowanceTotalAmount>');
    expect(xml).toContain('<cbc:TaxableAmount currencyID="EUR">12773.70</cbc:TaxableAmount>');
    const cii = await buildEInvoice({ ...doc, format: "xrechnung-cii" });
    expect(cii.xml).toContain("<ram:LineTotalAmount>13595.70</ram:LineTotalAmount>");
    expect(cii.xml).toContain("<ram:AllowanceTotalAmount>679.79</ram:AllowanceTotalAmount>");
    expect(cii.xml).toContain("<ram:TaxBasisTotalAmount>12915.91</ram:TaxBasisTotalAmount>");
  });

  it("Storno als Gutschrift: Abzüge positiv wie alle Beträge", async () => {
    const storno = sampleDocument({ kind: "storno", format: "xrechnung-ubl", lines: discountLines, discount: { kind: "betrag", value: 10_000 } });
    const { xml } = await buildEInvoice(storno);
    expect(xml).toContain('<cbc:AllowanceTotalAmount currencyID="EUR">100.00</cbc:AllowanceTotalAmount>');
    expect(xml).not.toMatch(/<cbc:Amount currencyID="EUR">-/);
  });

  it("Bruttopreise: Abzüge netto, Positionen mit Nettopreis vor dem Rabatt", async () => {
    const gross = sampleDocument({ format: "xrechnung-ubl", lines: discountLines, discount: { kind: "betrag", value: 10_000 }, priceMode: "brutto" });
    const { xml } = await buildEInvoice(gross);
    const total = (name: string) => Number(new RegExp(`<cbc:${name} currencyID="EUR">([\\d.]+)</cbc:${name}>`).exec(xml)![1]);
    expect(Math.round((total("LineExtensionAmount") - total("AllowanceTotalAmount")) * 100)).toBe(gross.totals.net);
    expect(xml).not.toContain("<cbc:MultiplierFactorNumeric>");
  });

  it("ohne Rabatt kein AllowanceCharge", async () => {
    const { xml } = await buildEInvoice(sampleDocument({ format: "xrechnung-ubl" }));
    expect(xml).not.toContain("AllowanceCharge");
    expect(xml).not.toContain("AllowanceTotalAmount");
  });
});

describe("Rabatte im PDF", () => {
  it("Positionsrabatt unter der Bezeichnung, Gesamtrabatt in den Summen", () => {
    const data = pdfData(sampleDocument({ lines: discountLines, discount: { kind: "prozent", value: 500 } }));
    expect(data.lines[0]).toMatchObject({ discount: nbsp("abzüglich 10 % Rabatt (1.444,00 €)"), net: nbsp("12.996,00 €") });
    expect(data.lines[1]).toMatchObject({ discount: nbsp("abzüglich 49,00 € Rabatt"), net: nbsp("450,00 €") });
    expect(data.lines[2]!.discount).toBeNull();
    expect(data.totals.rows.slice(0, 3)).toEqual([
      { label: "Zwischensumme", value: nbsp("13.595,70 €") },
      { label: nbsp("Gesamtrabatt 5 %"), value: nbsp("−679,79 €") },
      { label: "Summe netto", value: nbsp("12.915,91 €") },
    ]);
  });

  it("Bruttopreise: Zwischensumme und Rabatt brutto über dem Gesamtbetrag", () => {
    const doc = sampleDocument({ lines: discountLines, discount: { kind: "betrag", value: 10_000 }, priceMode: "brutto" });
    const data = pdfData(doc);
    expect(data.totals.rows).toEqual([
      { label: "Zwischensumme", value: nbsp("13.595,70 €") },
      { label: "Gesamtrabatt", value: nbsp("−100,00 €") },
    ]);
    expect(data.totals.gross.value).toBe(nbsp("13.495,70 €"));
  });

  it("ohne Rabatt wie bisher", () => {
    const data = pdfData(sampleDocument());
    expect(data.totals.rows[0]!.label).toBe("Summe netto");
    expect(data.lines.every((l) => l.discount === null)).toBe(true);
  });
});
