import { describe, expect, it } from "vitest";
import { convertForeignAmounts, foreignToEuro, formatExchangeRate, parseBmfRates, parseExchangeRate } from "./currency.ts";

describe("parseExchangeRate", () => {
  it.each([
    ["1,0812", "1.0812"],
    ["1.0812", "1.0812"],
    [" 0,85 ", "0.85"],
    ["161,79", "161.79"],
    ["1.081200", "1.0812"],
    ["2", "2"],
    ["007,5", "7.5"],
  ])("%j → %j", (input, rate) => {
    expect(parseExchangeRate(input)).toBe(rate);
  });

  it.each(["", "0", "0,000000", "-1,08", "1,0812345", "1.081,2", "abc", "1e3"])("lehnt %j ab", (input) => {
    expect(parseExchangeRate(input)).toBeNull();
  });
});

describe("formatExchangeRate", () => {
  it("zeigt den Kurs mit Komma und ohne Nullen am Ende", () => {
    expect(formatExchangeRate("1.081200")).toBe("1,0812");
  });
});

describe("foreignToEuro", () => {
  it("teilt durch den Kurs und rundet kaufmännisch", () => {
    // 100,00 USD bei 1 EUR = 1,0812 USD: 92,4898… €
    expect(foreignToEuro(10_000, "1.0812")).toBe(9249);
    // 10.000 JPY bei 1 EUR = 161,79 JPY: 61,81 €
    expect(foreignToEuro(1_000_000, "161.79")).toBe(6181);
  });

  it("rundet halbe Cent symmetrisch zur Null, damit Gutschriften den Beleg genau aufheben", () => {
    // 0,01 bei Kurs 2 = 0,005 € → 0,01 €
    expect(foreignToEuro(1, "2")).toBe(1);
    expect(foreignToEuro(-1, "2")).toBe(-1);
    expect(foreignToEuro(-10_000, "1.0812")).toBe(-9249);
  });

  it("rechnet auch sehr große Beträge exakt (ohne Gleitkomma)", () => {
    expect(foreignToEuro(10_000_000_000, "0.000001")).toBe(10_000_000_000_000_000);
    expect(foreignToEuro(9_999_999_999, "3")).toBe(3_333_333_333);
  });
});

describe("convertForeignAmounts", () => {
  const rows = [{ taxRate: 1900, originalNet: 10_000, originalTax: 1_900 }];

  it("rechnet Netto und Steuer je Satz einzeln um", () => {
    expect(convertForeignAmounts(rows, "1.0812", false)).toEqual([{ taxRate: 1900, net: 9249, tax: 1757 }]);
  });

  it("§ 13b: Steuer aus dem umgerechneten Netto, nicht aus der Fremdwährungssteuer", () => {
    // 9.249 × 19 % = 1.757,31 → 1.757; aus 0 USD Steuer käme 0 heraus
    expect(convertForeignAmounts([{ taxRate: 1900, originalNet: 10_000, originalTax: 0 }], "1.0812", true)).toEqual([
      { taxRate: 1900, net: 9249, tax: 1757 },
    ]);
  });
});

describe("parseBmfRates", () => {
  it("Monatskopf mit Punkt („01.2026“)", () => {
    const csv = ["Land;Währung;01.2026;02.2026", "Australien;1 Euro;1,5523 AUD;1,5612 AUD"].join("\n");
    expect(parseBmfRates(csv, 2026)).toEqual([
      { currency: "AUD", month: "2026-01", rate: "1.5523" },
      { currency: "AUD", month: "2026-02", rate: "1.5612" },
    ]);
  });

  it("Code aus eigener Spalte: das Land „USA“ ist kein Währungscode", () => {
    expect(parseBmfRates(["Land;ISO-Code;Januar;Februar", "USA;USD;1,0812;1,0790"].join("\n"), 2026).map((r) => r.currency)).toEqual(["USD", "USD"]);
    // ohne benannte Spalte: die Zelle vor den Monaten
    expect(parseBmfRates(["Land;;Januar", "USA;USD;1,0812"].join("\n"), 2026).map((r) => r.currency)).toEqual(["USD"]);
  });

  it("liest die CSV des BMF: Kurs und Code in der Zelle, Tausenderpunkte, leere Monate", () => {
    const csv = [
      "﻿Land;Währung;Januar;Februar;März;April",
      "Australien;1 Euro;1,5523 AUD;1,5612 AUD;;",
      "Indonesien;1 Euro;15.172,93 IDR;15.201,5 IDR;;",
      '"USA";"1 Euro";"1,0812 USD";"1,0790 USD";"";""',
      "Ecuador;1 Euro;1,0812 USD;1,0790 USD;;",
      "Japan;1 Euro;161,79 JPY;-;;",
    ].join("\r\n");
    expect(parseBmfRates(csv, 2026)).toEqual([
      { currency: "AUD", month: "2026-01", rate: "1.5523" },
      { currency: "AUD", month: "2026-02", rate: "1.5612" },
      { currency: "IDR", month: "2026-01", rate: "15172.93" },
      { currency: "IDR", month: "2026-02", rate: "15201.5" },
      { currency: "JPY", month: "2026-01", rate: "161.79" },
      { currency: "USD", month: "2026-01", rate: "1.0812" },
      { currency: "USD", month: "2026-02", rate: "1.079" },
    ]);
  });

  it("nimmt den Code aus einer eigenen Spalte und Monate als 01/2026", () => {
    const csv = ["Umsatzsteuer-Umrechnungskurse 2026", "", "Land\tISO\t01/2026\t02/2026", "Vereinigtes Königreich\tGBP\t0,8412\t0,8399"].join("\n");
    expect(parseBmfRates(csv, 2026)).toEqual([
      { currency: "GBP", month: "2026-01", rate: "0.8412" },
      { currency: "GBP", month: "2026-02", rate: "0.8399" },
    ]);
  });

  it("ohne Kopfzeile mit Monaten oder für ein anderes Jahr: nichts", () => {
    expect(parseBmfRates("<html>Fehler</html>", 2026)).toEqual([]);
    expect(parseBmfRates("Land;01/2025\nUSA;1,05 USD", 2026)).toEqual([]);
  });
});
