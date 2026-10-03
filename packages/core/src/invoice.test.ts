import { describe, expect, it } from "vitest";
import { addDays, computeInvoiceTotals, formatInvoiceNumber, formatQuoteNumber, lineNet, parseQuantity } from "./invoice.ts";

describe("Rechnungssummen", () => {
  it("Zeilennetto aus Tausendstel-Menge", () => {
    expect(lineNet(152_000, 9500)).toBe(1_444_000);
    expect(lineNet(500, 333)).toBe(167);
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

describe("Hilfen", () => {
  it("Menge parsen", () => {
    expect(parseQuantity("152")).toBe(152_000);
    expect(parseQuantity("0,5")).toBe(500);
    expect(parseQuantity("1.000")).toBe(1_000_000);
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
