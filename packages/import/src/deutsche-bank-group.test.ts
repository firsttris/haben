import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStatement } from "./parse.ts";

const datei = readFileSync(join(import.meta.dirname, "..", "test-fixtures", "deutsche-bank-group.csv"));
const text = new TextDecoder().decode(datei);
const ersetzt = (von: string, nach: string) => new TextEncoder().encode(text.replace(von, nach));

describe("Deutsche Bank, Norisbank und Postbank (CSV)", () => {
  const auszug = parseStatement(new Uint8Array(datei), "Kontoumsaetze_123_4567890_00_20260930_120000.csv");
  const t = auszug.transactions;

  it("erkennt das Format und nimmt die eigene IBAN aus dem Kopfblock", () => {
    expect(auszug.format).toBe("deutsche-bank-group-csv");
    expect(auszug.accountIban).toBe("DE60123456780012345678");
    expect(auszug.accountName).toBe("Geschäftskonto");
    expect(auszug.currency).toBe("EUR");
    expect(auszug.warnings).toEqual([]);
  });

  it("liest den Zeitraum aus dem Kopfblock", () => {
    expect(auszug.periodFrom).toBe("2026-09-01");
    expect(auszug.periodTo).toBe("2026-09-30");
  });

  it("übernimmt die Salden, wenn der letzte Kontostand plus die Umsätze den Kontostand am Ende ergibt", () => {
    expect(auszug.openingBalance).toBe(200_000);
    expect(auszug.closingBalance).toBe(351_571);
    expect(auszug.statedBalance).toEqual({ date: "2026-09-30", amount: 351_571 });
  });

  it("nimmt die Fußzeile als Kontostand, nicht als Umsatz", () => {
    expect(t).toHaveLength(7);
    expect(t.map((x) => x.purpose)).not.toContain("Kontostand");
  });

  it("liest Beträge mit keiner, einer oder zwei Nachkommastellen; Betrag schlägt Soll und Haben", () => {
    expect(t.map((x) => x.amount)).toEqual([119_000, -8_450, 50_000, -3_999, -2_790, -1_200, -990]);
  });

  it("liest Buchungstag und Wert als TT.MM.JJJJ", () => {
    expect(t.map((x) => x.bookingDate)).toEqual(["2026-09-01", "2026-09-03", "2026-09-07", "2026-09-10", "2026-09-14", "2026-09-18", "2026-09-30"]);
    expect(t.map((x) => x.valueDate)).toEqual(["2026-09-01", "2026-09-05", "2026-09-07", "2026-09-10", "2026-09-14", "2026-09-18", "2026-09-30"]);
  });

  it("Gegenseite aus „Begünstigter / Auftraggeber“, auch wenn dort nichts steht", () => {
    expect(t.map((x) => x.counterpartyName)).toEqual([
      "Musterwerk GmbH",
      "Stadtwerke Musterstadt",
      "",
      "Telefonanbieter AG",
      "Musterladen",
      "Fehlerhafte Bank AG",
      "",
    ]);
  });

  it("nimmt die Gegen-IBAN nur mit gültiger Prüfziffer und nie die eigene", () => {
    expect(t.map((x) => x.counterpartyIban)).toEqual([
      "DE02120300000000202051",
      "DE02500105170137075030",
      undefined,
      "DE02100500000054540402",
      // Umbuchung auf ein eigenes Konto: die Spalte trägt die eigene IBAN
      undefined,
      // Falsche Prüfziffer
      undefined,
      undefined,
    ]);
  });

  it("Kundenreferenz als Referenz der Bank, NOTPROVIDED zählt nicht", () => {
    expect(t.map((x) => x.bankReference)).toEqual(["2026-014", undefined, undefined, "REF-4711", undefined, undefined, undefined]);
  });

  it("Lastschrift: Mandatsreferenz und Gläubiger-ID aus eigenen Spalten", () => {
    expect(t[1]).toMatchObject({ mandateReference: "MND-77", creditorId: "DE98ZZZ09999999999" });
    expect(t[3]).toMatchObject({ mandateReference: "MND-0815", creditorId: "DE98ZZZ09999999999" });
    expect(t[0]?.mandateReference).toBeUndefined();
    expect(t[0]?.creditorId).toBeUndefined();
  });

  it("Verwendungszweck und Buchungsart aus eigenen Spalten", () => {
    expect(t.map((x) => x.purpose)).toEqual([
      "Rechnung 2026-014",
      "Abschlag Strom September",
      "Einzahlung 07.09.2026 11:20 Karte 09",
      "Rechnung September",
      "Einkauf Filiale 12",
      "Test ungültige Prüfziffer",
      "Kontoführung September",
    ]);
    expect(t.map((x) => x.type)).toEqual([
      "SEPA Überweisung",
      "SEPA Lastschrift",
      "Bargeldeinzahlung",
      "SEPA Lastschrift",
      "Kartenzahlung",
      "SEPA Überweisung",
      "Entgelt",
    ]);
  });

  it("lässt die Salden weg und nennt den Grund, wenn die Summe nicht aufgeht", () => {
    const s = parseStatement(ersetzt("Kontostand;30.9.2026;;;3.515,71;EUR", "Kontostand;30.9.2026;;;3.515,72;EUR"));
    expect(s.openingBalance).toBeUndefined();
    expect(s.closingBalance).toBeUndefined();
    expect(s.warnings.join()).toMatch(/gehen nicht mit den Umsätzen auf/);
  });

  it("meldet Fremdwährung wie die anderen Parser", () => {
    const s = parseStatement(ersetzt(";1.190;;;;;1.190;EUR", ";1.190;;;;;1.190;USD"));
    expect(s.warnings.join()).toMatch(/Fremdwährung.*USD/);
  });

  it("meldet einen ungültigen Betrag mit Zeile", () => {
    expect(() => parseStatement(ersetzt(";500;;;;;500;EUR", ";5x0;;;;;500;EUR"))).toThrow(/Zeile 11/);
  });

  it("meldet einen fehlenden Betrag, wenn Betrag, Soll und Haben leer sind", () => {
    expect(() => parseStatement(ersetzt(";-39,99;;EUR", ";;;EUR"))).toThrow(/Der Betrag fehlt \(Zeile 12\)/);
  });
});

describe("Deutsche Bank, Norisbank und Postbank (CSV) ohne Umsätze", () => {
  const datei = readFileSync(join(import.meta.dirname, "..", "test-fixtures", "deutsche-bank-group-leer.csv"));

  it("nimmt einen Export ohne Umsätze an und übernimmt die Nullsalden", () => {
    const auszug = parseStatement(new Uint8Array(datei));
    expect(auszug.format).toBe("deutsche-bank-group-csv");
    expect(auszug.accountIban).toBe("DE75512108001245126199");
    expect(auszug.accountName).toBe("Top-Zinskonto");
    expect(auszug.transactions).toEqual([]);
    expect(auszug.openingBalance).toBe(0);
    expect(auszug.closingBalance).toBe(0);
    expect(auszug.periodFrom).toBe("2026-01-01");
    expect(auszug.periodTo).toBe("2026-12-31");
    expect(auszug.warnings).toEqual([]);
  });
});
