import { describe, expect, it } from "vitest";
import { advanceVatPlan } from "./anzahlung-steuer.ts";

const total = [{ rate: 1900, base: 30_000, tax: 5_700 }];
const part = [{ rate: 1900, base: 10_000, tax: 1_900 }];

describe("Steuerzeitpunkte einer Soll-Anzahlung", () => {
  it("verteilt eine Zahlung vor der Leistung und ignoriert spätere Zahlungen bis zur Aufhebung der Schlussrechnung", () => {
    expect(
      advanceVatPlan(total, [
        { date: "2026-12-12", paid: part },
        { date: "2027-01-20", performance: 1 },
        { date: "2027-02-12", paid: part },
        { date: "2027-03-12", performance: -1 },
      ]),
    ).toEqual([
      { date: "2026-12-12", shares: part },
      { date: "2027-01-20", shares: [{ rate: 1900, base: 20_000, tax: 3_800 }] },
      { date: "2027-03-12", shares: [{ rate: 1900, base: -10_000, tax: -1_900 }] },
    ]);
  });

  it("erhält gemischte Steuersätze und gespeicherte Rundungsreste ohne neue anteilige Berechnung", () => {
    const taxes = [
      { rate: 1900, base: 10_003, tax: 1_901 },
      { rate: 700, base: 8_001, tax: 560 },
    ];
    const paid = [
      { rate: 1900, base: 3_334, tax: 634 },
      { rate: 700, base: 2_667, tax: 187 },
    ];
    expect(
      advanceVatPlan(taxes, [
        { date: "2026-12-12", paid },
        { date: "2027-01-20", performance: 1 },
      ]),
    ).toEqual([
      { date: "2026-12-12", shares: paid },
      {
        date: "2027-01-20",
        shares: [
          { rate: 1900, base: 6_669, tax: 1_267 },
          { rate: 700, base: 5_334, tax: 373 },
        ],
      },
    ]);
  });

  it("fasst gleiche Tage unabhängig von der Erfassungsreihenfolge zusammen", () => {
    const events = [
      { date: "2027-01-20", performance: 1 as const },
      { date: "2027-01-20", paid: part },
    ];
    expect(advanceVatPlan(total, events)).toEqual([{ date: "2027-01-20", shares: total }]);
    expect(advanceVatPlan(total, [...events].reverse())).toEqual(advanceVatPlan(total, events));
  });

  it("besteuert eine unbezahlte, vor der Leistung stornierte Anforderung überhaupt nicht", () => {
    expect(advanceVatPlan(total, [{ date: "2027-01-20", correction: [{ rate: 1900, base: -30_000, tax: -5_700 }] }])).toEqual([]);
  });

  it("berücksichtigt Erlösminderungen erst bei Leistung, anschließend auch ihre Gegenzeile", () => {
    expect(
      advanceVatPlan(total, [
        { date: "2026-12-12", writtenOff: part },
        { date: "2027-01-20", performance: 1 },
        { date: "2027-02-12", writtenOff: [{ rate: 1900, base: -10_000, tax: -1_900 }] },
      ]),
    ).toEqual([
      { date: "2027-01-20", shares: [{ rate: 1900, base: 20_000, tax: 3_800 }] },
      { date: "2027-02-12", shares: part },
    ]);
  });
});
