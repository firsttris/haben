import { describe, expect, it } from "vitest";
import { addDays } from "./holidays.ts";
import { computeInvoice, computeInvoiceTotals, convertPrice, formatInvoiceNumber, formatQuoteNumber, lineAmount, parseQuantity, totalsFromTaxes } from "./invoice.ts";
import { taxIncluded } from "./money.ts";

describe("Rechnungssummen", () => {
  it("Zeilennetto aus Tausendstel-Menge", () => {
    expect(lineAmount(152_000, 9500)).toBe(1_444_000);
    expect(lineAmount(500, 333)).toBe(167);
  });

  it("Steuer je Satz auf die Summe", () => {
    const totals = computeInvoiceTotals([
      { quantity: 1000, unitPrice: 1, taxRate: 1900 },
      { quantity: 1000, unitPrice: 1, taxRate: 1900 },
      { quantity: 1000, unitPrice: 1, taxRate: 1900 },
      { quantity: 1000, unitPrice: 10_000, taxRate: 700 },
    ]);
    expect(totals.taxes).toEqual([
      { rate: 1900, base: 3, tax: 1 },
      { rate: 700, base: 10_000, tax: 700 },
    ]);
    expect(totals).toMatchObject({ net: 10_003, tax: 701, gross: 10_704 });
  });

  it("negative Beträge für Storno", () => {
    expect(computeInvoiceTotals([{ quantity: 1000, unitPrice: -100_000, taxRate: 1900 }])).toMatchObject({
      net: -100_000,
      tax: -19_000,
      gross: -119_000,
    });
  });
});

describe("Bruttopreise", () => {
  it("9,80 € inkl. 19 % USt bleiben 9,80 €", () => {
    // netto ließe sich 9,80 € nicht erreichen: 8,23 € + 1,56 € = 9,79 €, 8,24 € + 1,57 € = 9,81 €
    expect(computeInvoiceTotals([{ quantity: 1000, unitPrice: 823, taxRate: 1900 }]).gross).toBe(979);
    expect(computeInvoiceTotals([{ quantity: 1000, unitPrice: 824, taxRate: 1900 }]).gross).toBe(981);
    const { totals, lineNets } = computeInvoice([{ quantity: 1000, unitPrice: 980, taxRate: 1900 }], "brutto");
    expect(totals).toEqual({ net: 824, tax: 156, gross: 980, taxes: [{ rate: 1900, base: 824, tax: 156 }] });
    expect(lineNets).toEqual([824]);
  });

  it("Steuer je Satz aus der Bruttosumme, nicht je Zeile", () => {
    // Je Zeile herausgerechnet wären es 3 × 0,16 € = 0,48 €; aus der Summe 2,97 € sind es 0,47 €
    const lines = [1, 2, 3].map(() => ({ quantity: 1000, unitPrice: 99, taxRate: 1900 as const }));
    const { totals, lineNets } = computeInvoice(lines, "brutto");
    expect(totals.taxes).toEqual([{ rate: 1900, base: 250, tax: 47 }]);
    expect(lineNets.reduce((a, b) => a + b, 0)).toBe(250);
  });

  it("verteilt das Netto exakt auf die Zeilen, den Rest auf die größte Zeile", () => {
    const lines = [
      { quantity: 1000, unitPrice: 99, taxRate: 1900 as const },
      { quantity: 2000, unitPrice: 1_190, taxRate: 1900 as const },
      { quantity: 1000, unitPrice: 99, taxRate: 1900 as const },
      { quantity: 1500, unitPrice: 535, taxRate: 700 as const },
    ];
    const { totals, lineNets } = computeInvoice(lines, "brutto");
    expect(totals.gross).toBe(99 + 2_380 + 99 + 803);
    for (const t of totals.taxes) {
      const sum = lines.reduce((s, l, i) => s + (l.taxRate === t.rate ? lineNets[i]! : 0), 0);
      expect(sum).toBe(t.base);
    }
    // Zeile 2 (größter Betrag) trägt den Rundungsrest; die kleinen Zeilen bleiben bei ihrem eigenen Netto
    expect(lineNets[0]).toBe(99 - taxIncluded(99, 1900));
    expect(lineNets[2]).toBe(99 - taxIncluded(99, 1900));
  });

  it("Storno im Brutto-Modus hebt die Rechnung exakt auf", () => {
    const lines = [
      { quantity: 3000, unitPrice: 333, taxRate: 1900 as const },
      { quantity: 1000, unitPrice: 1_005, taxRate: 700 as const },
      { quantity: 1000, unitPrice: 1, taxRate: 1900 as const },
    ];
    const original = computeInvoice(lines, "brutto");
    const storno = computeInvoice(
      lines.map((l) => ({ ...l, unitPrice: -l.unitPrice })),
      "brutto",
    );
    expect(storno.totals.net).toBe(-original.totals.net);
    expect(storno.totals.tax).toBe(-original.totals.tax);
    expect(storno.totals.taxes).toEqual(original.totals.taxes.map((t) => ({ rate: t.rate, base: -t.base, tax: -t.tax })));
    expect(storno.lineNets).toEqual(original.lineNets.map((n) => -n));
  });

  it("0 % und netto bleiben unverändert", () => {
    const lines = [{ quantity: 1000, unitPrice: 5_000, taxRate: 0 as const }];
    expect(computeInvoice(lines, "brutto")).toEqual(computeInvoice(lines, "netto"));
    expect(computeInvoice([{ quantity: 2000, unitPrice: 100, taxRate: 1900 }]).lineNets).toEqual([200]);
  });

  it("Preise zwischen netto und brutto umrechnen", () => {
    expect(convertPrice(824, 1900, "netto", "brutto")).toBe(981);
    expect(convertPrice(980, 1900, "brutto", "netto")).toBe(824);
    expect(convertPrice(1_070, 700, "brutto", "netto")).toBe(1_000);
    expect(convertPrice(1_000, 700, "netto", "netto")).toBe(1_000);
  });

  it("Summen aus gespeicherten Steuerzeilen", () => {
    expect(
      totalsFromTaxes([
        { rate: 700, base: 1_000, tax: 70 },
        { rate: 1900, base: 824, tax: 156 },
      ]),
    ).toEqual({ net: 1_824, tax: 226, gross: 2_050, taxes: [{ rate: 1900, base: 824, tax: 156 }, { rate: 700, base: 1_000, tax: 70 }] });
  });
});

describe("Hilfen", () => {
  it("Menge parsen", () => {
    expect(parseQuantity("152")).toBe(152_000);
    expect(parseQuantity("0,5")).toBe(500);
    expect(parseQuantity("1.000")).toBe(1_000_000);
    expect(parseQuantity("1.000,25")).toBe(1_000_250);
    expect(parseQuantity("1.5")).toBeNull();
    expect(parseQuantity("x")).toBeNull();
  });
  it("Fälligkeit", () => {
    expect(addDays("2026-10-02", 14)).toBe("2026-10-16");
    expect(addDays("2026-12-20", 14)).toBe("2027-01-03");
  });
  it("Rechnungsnummer", () => {
    expect(formatInvoiceNumber(2026, 34)).toBe("2026-034");
    expect(formatQuoteNumber(2026, 7)).toBe("AN-2026-007");
  });
});
