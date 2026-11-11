import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStatement } from "./parse.ts";

const datei = readFileSync(join(import.meta.dirname, "..", "test-fixtures", "commerzbank.csv"));
const text = new TextDecoder().decode(datei);
const ersetzt = (von: string, nach: string) => new TextEncoder().encode(text.replace(von, nach));

describe("Commerzbank-CSV", () => {
  const auszug = parseStatement(new Uint8Array(datei), "DE60123456780012345678_EUR_31-10-2026_1200.csv");
  const t = auszug.transactions;

  it("erkennt das Format und nimmt die eigene IBAN aus der Spalte „IBAN Kontoinhaber“", () => {
    expect(auszug.format).toBe("commerzbank-csv");
    expect(auszug.accountIban).toBe("DE60123456780012345678");
    expect(auszug.currency).toBe("EUR");
    expect(auszug.warnings).toEqual([]);
  });

  it("ohne Kontostand in der Datei: keine Salden, Zeitraum aus den Buchungstagen", () => {
    expect(auszug.openingBalance).toBeUndefined();
    expect(auszug.closingBalance).toBeUndefined();
    expect(auszug.periodFrom).toBe("2026-10-01");
    expect(auszug.periodTo).toBe("2026-10-30");
  });

  it("liest Beträge mit keiner, einer oder zwei Nachkommastellen, Ausgang negativ", () => {
    expect(t.map((x) => x.amount)).toEqual([-990, 476_000, 11_950, -119_000, -3_990, 172_550, -85_000]);
  });

  it("liest Buchungstag und Wertstellung als TT.MM.JJJJ", () => {
    expect(t.map((x) => x.bookingDate)).toEqual(["2026-10-30", "2026-10-28", "2026-10-27", "2026-10-20", "2026-10-15", "2026-10-10", "2026-10-01"]);
    expect(t[0]?.valueDate).toBe("2026-10-31");
    expect(t[4]?.valueDate).toBe("2026-10-14");
  });

  it("Gegenseite: Sender beim Eingang, Empfänger beim Ausgang", () => {
    expect(t.map((x) => x.counterpartyName)).toEqual([
      "Commerzbank AG",
      "Nordwerk Software GmbH",
      "Alpenblick Media AG",
      "Bürohaus Nord GmbH",
      "Telefon AG",
      "Rheinpixel GmbH",
      "Hausverwaltung Beispiel",
    ]);
  });

  it("nimmt die Gegen-IBAN aus dem Buchungstext, nur mit gültiger Prüfziffer und nie die Gläubiger-ID", () => {
    expect(t.map((x) => x.counterpartyIban)).toEqual([
      undefined,
      // Eingänge nennen die IBAN des Senders nicht
      undefined,
      undefined,
      "DE89370400440532013000",
      undefined,
      "DE14100100109876543210",
      "DE34200505501234567890",
    ]);
  });

  it("nimmt die eigene IBAN nicht als Gegenkonto", () => {
    const s = parseStatement(ersetzt("Bürohaus Nord GmbH B-2026-118 DE89370400440532013000", "Bürohaus Nord GmbH B-2026-118 DE60123456780012345678"));
    expect(s.transactions[3]?.counterpartyIban).toBeUndefined();
  });

  it("Verwendungszweck aus der eigenen Spalte; ohne ihn der Buchungstext ohne den Namen", () => {
    expect(t.map((x) => x.purpose)).toEqual([
      "Abrechnung 30.10.2026 Kontofuehrung 01.10.2026 bis 31.10.2026 Entgelte 9,9- EUR",
      "RE-2026-031",
      "RE-2026-030",
      "B-2026-118",
      "Kundennr. 4711 Rechnung 10/2026",
      "RE-2026-028",
      "Miete Büro Oktober",
    ]);
  });

  it("Buchungsart aus der Umsatzart", () => {
    expect(t.map((x) => x.type)).toEqual([
      "Zinsen/Entgelte",
      "Überweisung",
      "Überweisung (Echtzeit)",
      "Überweisung",
      "Lastschrift",
      "Lastschrift",
      "Dauerauftrag",
    ]);
  });

  it("End-to-End-Referenz bis zum nächsten Feld, auch mit Leerzeichen; NOTPROVIDED und die angehängte Umsatzart zählen nicht", () => {
    expect(t.map((x) => x.endToEndId)).toEqual([undefined, "Rechnung 2026031", undefined, undefined, "TA 2026 10 4711", "RP-2026-0007", undefined]);
  });

  it("Kundenreferenz als Referenz der Bank", () => {
    expect(t.map((x) => x.bankReference)).toEqual([
      undefined,
      "NSCT2610280000123456789012345678",
      "9c41ab02ef5d4c7a8b1e2f3a4b5c6d7e",
      "2610200123",
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("Lastschrift: Mandatsreferenz und Gläubiger-ID aus dem Buchungstext", () => {
    expect(t[4]).toMatchObject({ mandateReference: "TA-4711-01", creditorId: "DE98ZZZ09999999999" });
    expect(t[5]).toMatchObject({ mandateReference: "M-RP-0007", creditorId: "DE98ZZZ09999999999" });
    expect(t[1]?.mandateReference).toBeUndefined();
    expect(t[1]?.creditorId).toBeUndefined();
  });

  it("lehnt eine Datei mit Umsätzen mehrerer Konten ab", () => {
    const zwei = text.replace(
      "Nordwerk Software GmbH RE-2026-031 End-to-End-Ref.: Rechnung 2026031 Kundenreferenz: NSCT2610280000123456789012345678;4760;EUR;DE60123456780012345678",
      "Nordwerk Software GmbH RE-2026-031 End-to-End-Ref.: Rechnung 2026031 Kundenreferenz: NSCT2610280000123456789012345678;4760;EUR;DE34200505501234567890",
    );
    expect(() => parseStatement(new TextEncoder().encode(zwei))).toThrow(/mehrerer Konten/);
  });

  it("meldet einen ungültigen Betrag mit Zeile", () => {
    expect(() => parseStatement(ersetzt(";-850;EUR;", ";-8x0;EUR;"))).toThrow(/Zeile 8/);
  });
});
