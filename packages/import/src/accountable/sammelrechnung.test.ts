import { describe, expect, it } from "vitest";
import { sammelrechnungen, zeilenInSammelrechnungen } from "./sammelrechnung.ts";
import type { AccountableExpenseRow } from "./types.ts";

function zeile(teil: Partial<AccountableExpenseRow> & { row: number }): AccountableExpenseRow {
  return {
    bookingDate: "2026-10-07",
    supplierName: "Hornbach Baumarkt AG",
    gross: 100,
    net: 84,
    tax: 16,
    currency: "EUR",
    taxStatus: "normal",
    taxRate: 1900,
    code: "0490",
    codeName: "Geräte & Werkzeuge",
    paid: true,
    paidDate: "2026-10-07",
    documentPresent: true,
    bankMovement: null,
    ...teil,
  };
}

describe("Sammelrechnungen aus dem Ausgabenblatt", () => {
  it("fasst zwei Zeilen desselben Lieferanten und Tages zusammen", () => {
    const [rechnung, ...rest] = sammelrechnungen([
      zeile({ row: 2, gross: 1770, net: 1487, tax: 283 }),
      zeile({ row: 3, gross: 229, net: 192, tax: 37, code: "4280", codeName: "Dekoration" }),
    ]);
    expect(rest).toHaveLength(0);
    expect(rechnung?.gross).toBe(1999);
    expect(rechnung?.net).toBe(1679);
    expect(rechnung?.tax).toBe(320);
    expect(rechnung?.positions).toHaveLength(2);
    expect(rechnung?.rows).toEqual([2, 3]);
  });

  it("nimmt die Kategorie je Position aus dem Buchungscode", () => {
    const [rechnung] = sammelrechnungen([
      zeile({ row: 2, gross: 1770, net: 1487, tax: 283, code: "0490" }),
      zeile({ row: 3, gross: 229, net: 192, tax: 37, code: "4280" }),
    ]);
    expect(rechnung?.positions.map((p) => p.category)).toEqual(["hardware", "buero"]);
  });

  it("lässt eine einzelne Zeile liegen", () => {
    expect(sammelrechnungen([zeile({ row: 2 })])).toEqual([]);
  });

  it("trennt nach Tag", () => {
    const ergebnis = sammelrechnungen([zeile({ row: 2, bookingDate: "2026-10-07" }), zeile({ row: 3, bookingDate: "2026-10-08" })]);
    expect(ergebnis).toEqual([]);
  });

  it("trennt nach Lieferant", () => {
    const ergebnis = sammelrechnungen([zeile({ row: 2, supplierName: "Hornbach Baumarkt AG" }), zeile({ row: 3, supplierName: "Aliexpress" })]);
    expect(ergebnis).toEqual([]);
  });

  it("lässt Reverse Charge draußen", () => {
    const ergebnis = sammelrechnungen([zeile({ row: 2, taxStatus: "Importieren" }), zeile({ row: 3, taxStatus: "Importieren" })]);
    expect(ergebnis).toEqual([]);
  });

  it("lässt Fremdwährung ohne Eurobetrag draußen", () => {
    const ergebnis = sammelrechnungen([
      zeile({ row: 2, currency: "USD", gross: null, net: null, tax: null }),
      zeile({ row: 3, currency: "USD", gross: null, net: null, tax: null }),
    ]);
    expect(ergebnis).toEqual([]);
  });

  it("überspringt Zeilen ohne Belegdatei", () => {
    const ergebnis = sammelrechnungen([zeile({ row: 2, documentPresent: false }), zeile({ row: 3, documentPresent: false })]);
    expect(ergebnis).toEqual([]);
  });

  it("nennt die Zeilennummern zum Überspringen", () => {
    const zeilen = zeilenInSammelrechnungen([zeile({ row: 2 }), zeile({ row: 3 }), zeile({ row: 4, supplierName: "Aliexpress" })]);
    expect([...zeilen].sort()).toEqual([2, 3]);
  });
});
