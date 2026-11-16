import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectStatementFormat, parseStatement } from "./parse.ts";

// Anonymisiert nach einem echten Export (#1161): Windows-1252, CRLF, Kopfblock, neueste Buchung zuerst
const datei = readFileSync(join(import.meta.dirname, "..", "test-fixtures", "ing.csv"));
const text = new TextDecoder("windows-1252").decode(datei);
const zeilen = text.split("\r\n");
const ersetzt = (von: string, nach: string) => new TextEncoder().encode(text.replace(von, nach));
const ohneZeilen = (...weg: string[]) => new TextEncoder().encode(zeilen.filter((z) => !weg.some((w) => z.startsWith(w))).join("\r\n"));

describe("ING-CSV (Umsatzanzeige)", () => {
  const auszug = parseStatement(new Uint8Array(datei), "Umsatzanzeige_DE41xxxx_20261116.csv");
  const t = auszug.transactions;

  it("erkennt das Format am Inhalt und liest IBAN und Kontoname aus dem Kopf", () => {
    expect(detectStatementFormat(new Uint8Array(datei))).toBe("ing-csv");
    expect(auszug.format).toBe("ing-csv");
    expect(auszug.accountIban).toBe("DE41500105170123456789");
    expect(auszug.accountName).toBe("Girokonto");
    expect(auszug.currency).toBe("EUR");
    expect(auszug.warnings).toEqual([]);
  });

  it("liest Windows-1252 (Umlaute in Spalten und Text)", () => {
    expect(t[1]?.purpose).toBe("Kontoführung 10/2026");
    expect(t[4]?.type).toBe("Dauerauftrag / Terminüberweisung");
  });

  it("nimmt den Zeitraum aus dem Kopf", () => {
    expect(auszug.periodFrom).toBe("2026-10-01");
    expect(auszug.periodTo).toBe("2026-11-15");
  });

  it("liest Beträge mit Tausenderpunkt, Ausgang negativ, in der Reihenfolge der Datei", () => {
    expect(t.map((x) => x.amount)).toEqual([11_950, -490, -2_142, 476_000, -85_000]);
  });

  it("liest Buchung und Wertstellungsdatum als TT.MM.JJJJ", () => {
    expect(t.map((x) => x.bookingDate)).toEqual(["2026-11-02", "2026-10-30", "2026-10-15", "2026-10-06", "2026-10-01"]);
    expect(t[0]?.valueDate).toBe("2026-11-03");
    expect(t[2]?.valueDate).toBe("2026-10-14");
  });

  it("Gegenseite, Buchungstext als Art, Verwendungszweck und Referenz ohne Platzhalter", () => {
    expect(t.map((x) => x.counterpartyName)).toEqual([
      "Alpenblick Media AG",
      "ING",
      "VISA BEISPIEL SOFTWARE",
      "Nordwerk Software GmbH",
      "Hausverwaltung Beispiel",
    ]);
    expect(t.map((x) => x.type)).toEqual(["Gutschrift", "Entgelt", "Lastschrift", "Gutschrift", "Dauerauftrag / Terminüberweisung"]);
    expect(t[3]).toMatchObject({ purpose: "RE-2026-031 Entwicklung September", bankReference: "NSCT2610060000123456" });
    // NOTPROVIDED ist der Platzhalter der Bank, keine Referenz
    expect(t[0]?.bankReference).toBeUndefined();
    // Die Umsatzanzeige nennt keine IBAN der Gegenseite
    expect(t.every((x) => x.counterpartyIban === undefined)).toBe(true);
  });

  it("Salden aus der Spalte „Saldo“, nicht aus dem Kopf", () => {
    expect(auszug.openingBalance).toBe(100_000);
    expect(auszug.closingBalance).toBe(500_318);
  });

  it("aufsteigend sortiert ergeben sich dieselben Salden", () => {
    const tabelle = zeilen.findIndex((z) => z.startsWith("Buchung;"));
    const umsaetze = zeilen.slice(tabelle + 1).filter((z) => z !== "");
    const aufsteigend = [...zeilen.slice(0, tabelle + 1), ...umsaetze.reverse()].join("\r\n").replace("Datum absteigend", "Datum aufsteigend");
    const s = parseStatement(new TextEncoder().encode(aufsteigend));
    expect(s.transactions.map((x) => x.bookingDate)[0]).toBe("2026-10-01");
    expect([s.openingBalance, s.closingBalance]).toEqual([100_000, 500_318]);
    expect(s.warnings).toEqual([]);
  });

  it("gefilterter Export: nur die enthaltenen Umsätze, keine Salden, ein Hinweis", () => {
    // Der Saldo im Kopf gilt fürs ganze Konto; zwischen den gefundenen Zeilen fehlen Umsätze
    const gefiltert = new TextDecoder()
      .decode(ohneZeilen("30.10.2026", "15.10.2026", "01.10.2026"))
      .replace("Sortierung;Datum absteigend", "Filter;RE-2026;Sortierung;Datum absteigend");
    const s = parseStatement(new TextEncoder().encode(gefiltert));
    expect(s.transactions.map((x) => x.amount)).toEqual([11_950, 476_000]);
    expect(s.openingBalance).toBeUndefined();
    expect(s.closingBalance).toBeUndefined();
    expect(s.warnings).toEqual(["Gefilterter Export (Suche „RE-2026“): Haben übernimmt nur diese Umsätze und keine Salden."]);
  });

  it("ein einzelner gefundener Umsatz lässt sich importieren", () => {
    const einer = new TextDecoder()
      .decode(ohneZeilen("02.11.2026", "30.10.2026", "15.10.2026", "01.10.2026"))
      .replace("Sortierung;Datum absteigend", "Filter;Nordwerk;Sortierung;Datum absteigend");
    const s = parseStatement(new TextEncoder().encode(einer));
    expect(s.transactions).toHaveLength(1);
    expect(s.transactions[0]).toMatchObject({ amount: 476_000, counterpartyName: "Nordwerk Software GmbH", index: 0 });
  });

  it("ohne Filterzeile, aber mit Lücke in der Spalte „Saldo“: keine Salden und ein Hinweis", () => {
    const s = parseStatement(ohneZeilen("15.10.2026"));
    expect(s.transactions).toHaveLength(4);
    expect(s.openingBalance).toBeUndefined();
    expect(s.warnings).toEqual(["Die Spalte „Saldo“ geht nicht lückenlos auf; Salden werden nicht übernommen."]);
  });

  it("nimmt die Währung des Betrags, nicht die des Saldos", () => {
    const s = parseStatement(ersetzt("4.910,00;EUR;4.760,00;EUR", "4.910,00;EUR;4.760,00;USD"));
    expect(s.transactions[3]?.currency).toBe("USD");
    expect(s.warnings.join()).toMatch(/Fremdwährung.*USD/);
  });

  it("meldet einen ungültigen Betrag mit Zeile", () => {
    expect(() => parseStatement(ersetzt(";EUR;-4,90;EUR", ";EUR;vier;EUR"))).toThrow(/Ungültiger Betrag „vier“ \(Zeile 16\)/);
  });
});
