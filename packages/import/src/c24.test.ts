import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStatement } from "./parse.ts";

const datei = readFileSync(join(import.meta.dirname, "..", "test-fixtures", "c24.csv"));
const text = new TextDecoder().decode(datei);
const ersetzt = (von: string, nach: string) => new TextEncoder().encode(text.replace(von, nach));

describe("C24-CSV", () => {
  const auszug = parseStatement(new Uint8Array(datei), "Transaktionen.csv");
  const t = auszug.transactions;

  it("erkennt das Format; ohne IBAN in der Datei, mit dem Namen des Kontos bzw. der Pocket", () => {
    expect(auszug.format).toBe("c24-csv");
    expect(auszug.accountIban).toBeUndefined();
    expect(auszug.accountName).toBe("Geschäft");
    expect(auszug.currency).toBe("EUR");
    expect(auszug.warnings).toEqual([]);
  });

  it("ohne Kontostand in der Datei: keine Salden, Zeitraum aus den Buchungstagen", () => {
    expect(auszug.openingBalance).toBeUndefined();
    expect(auszug.closingBalance).toBeUndefined();
    expect(auszug.periodFrom).toBe("2026-10-01");
    expect(auszug.periodTo).toBe("2026-10-30");
  });

  it("liest alle Zeilen, obwohl sie eine Spalte kürzer sind als die Kopfzeile, in der Reihenfolge der Datei", () => {
    expect(t.map((x) => x.bookingDate)).toEqual(["2026-10-30", "2026-10-27", "2026-10-21", "2026-10-15", "2026-10-12", "2026-10-01", "2026-10-01"]);
    expect(t.map((x) => x.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("liest Beträge mit Euro-Zeichen, auch vierstellig ohne Tausenderpunkt, Ausgang negativ", () => {
    expect(t.map((x) => x.amount)).toEqual([-25_000, -2_380, 125_000, 380, -11_900, 1, 40_000]);
    expect(t.every((x) => x.currency === "EUR")).toBe(true);
  });

  it("Gegenseite aus „Zahlungsempfänger“ in beiden Richtungen, Gegen-IBAN ohne Leerzeichen", () => {
    expect(t.map((x) => x.counterpartyName)).toEqual([
      "Rücklagen",
      "Wolkenwerk",
      "Alpenblick Media AG",
      "Wolkenwerk",
      "Bürohaus Nord GmbH",
      "C24 Bank",
      "Hauptkonto",
    ]);
    // Kartenzahlungen, Zinsen und Umbuchungen zwischen Pockets nennen keine IBAN
    expect(t.map((x) => x.counterpartyIban)).toEqual([undefined, undefined, "BE68539007547034", undefined, "DE89370400440532013000", undefined, undefined]);
  });

  it("Zweck aus Verwendungszweck und Beschreibung (Händlertext der Kartenzahlung)", () => {
    expect(t.map((x) => x.purpose)).toEqual([
      "Umsatzsteuer Q3",
      "WOLKENWERK* HOSTING 10/26",
      "RE-2026-031",
      "WOLKENWERK* HOSTING 09/26",
      "Miete Oktober 2026",
      "",
      "Startkapital Erika Mustermann",
    ]);
  });

  it("Buchungsart aus dem Transaktionstyp", () => {
    expect(t.map((x) => x.type)).toEqual([
      "Pocket-Umbuchung",
      "Online-Kartenzahlung",
      "Echtzeit-Überweisung",
      "Rückerstattung",
      "Überweisung",
      "Zinszahlung",
      "Pocket-Umbuchung",
    ]);
  });

  it("lehnt eine Datei mit Umsätzen mehrerer Konten ab", () => {
    expect(() => parseStatement(ersetzt(",1234567890,Geschäft,Wohnen,", ",1234567891,Rücklagen,Wohnen,"))).toThrow(/mehrerer Konten/);
  });

  it("meldet einen ungültigen Betrag mit Zeile", () => {
    expect(() => parseStatement(ersetzt('"-119,00 €"', '"-1x9,00 €"'))).toThrow(/Zeile 6/);
  });

  it("meldet ein ungültiges Datum mit Zeile", () => {
    expect(() => parseStatement(ersetzt("Zinszahlung,01.10.2026", "Zinszahlung,32.10.2026"))).toThrow(/Zeile 7/);
  });
});
