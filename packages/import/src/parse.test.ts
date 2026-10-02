import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  detectStatementFormat,
  parseDotAmount,
  parseGermanAmount,
  parseStatement,
  StatementParseError,
} from "./index.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url)));

describe("parseGermanAmount", () => {
  it.each([
    ["1.234,56", 123456],
    ["-3.000,00", -300000],
    ["4.760,00 €", 476000],
    ["23.418,72 EUR", 2341872],
    ["12,5", 1250],
    ["0,07", 7],
    ["100", 10000],
    ["+1,00", 100],
    ["−45,90", -4590],
    ["45,90-", -4590],
    ["1 234,56", 123456],
    ["-0,00", 0],
  ])("%s → %i", (input, cents) => {
    expect(parseGermanAmount(input)).toBe(cents);
  });

  it.each(["", "abc", "1,234", "12.34", "1.23,00", "1,2,3"])("lehnt %j ab", (input) => {
    expect(parseGermanAmount(input)).toBeNull();
  });

  it("rechnet ohne Gleitkommafehler", () => {
    expect(parseGermanAmount("0,29")).toBe(29);
    expect(parseGermanAmount("1.000.000,01")).toBe(100000001);
  });
});

describe("parseDotAmount", () => {
  it.each([
    ["4760.00", 476000],
    ["-4.5", -450],
    ["-21.37", -2137],
    ["1,234.56", 123456],
    ["0.29", 29],
  ])("%s → %i", (input, cents) => {
    expect(parseDotAmount(input)).toBe(cents);
  });
});

describe("DKB (neues Format)", () => {
  const s = parseStatement(fixture("dkb-neu.csv"), "dkb-neu.csv");

  it("erkennt Format, Konto und Salden", () => {
    expect(s.format).toBe("dkb-csv");
    expect(s.accountIban).toBe("DE12120300001234567890");
    expect(s.accountName).toBe("Girokonto");
    expect(s.currency).toBe("EUR");
    expect(s.closingBalance).toBe(2341872);
    expect(s.openingBalance).toBe(2341872 - 50164);
    expect(s.periodFrom).toBe("2026-09-15");
    expect(s.periodTo).toBe("2026-10-01");
  });

  it("überspringt vorgemerkte Umsätze mit Warnung", () => {
    expect(s.transactions).toHaveLength(5);
    expect(s.warnings).toEqual(["1 vorgemerkter Umsatz wurde übersprungen."]);
  });

  it("liest Umsätze in Dateireihenfolge", () => {
    expect(s.transactions.map((t) => [t.index, t.bookingDate, t.amount, t.counterpartyName])).toEqual([
      [0, "2026-10-01", 476000, "Nordwerk Software GmbH"],
      [1, "2026-09-30", -123456, "Finanzamt Musterstadt"],
      [2, "2026-09-29", -1190, "Hosting AG"],
      [3, "2026-09-29", -1190, "Hosting AG"],
      [4, "2026-09-15", -300000, "Büro & Co. KG"],
    ]);
    expect(s.transactions[0]).toMatchObject({
      counterpartyIban: "DE89370400440532013000",
      purpose: "RE 2026-031 Leistungen August",
      type: "Eingang",
      valueDate: "2026-10-01",
    });
    expect(s.transactions[1]!.purpose).toBe("St.-Nr. 123/456/78901 UStVA 08/2026");
    expect(s.transactions[2]).toMatchObject({ creditorId: "DE98ZZZ09999999999", mandateReference: "HOST-0815" });
    expect(s.transactions[4]!.bankReference).toBe("KREF-2026-09");
  });

  it("findet Spalten über den Namen, nicht über die Position", () => {
    const csv = [
      `"Tagesgeld";"DE02120300000000202051"`,
      `"Kontostand vom 31.08.2026:";"1.000,00 €"`,
      `"Buchungsdatum";"Betrag (EUR)";"Zahlungsempfänger";"Zahlungspflichtiger";"Verwendungszweck";"IBAN"`,
      `"31.08.2026";"-10,00";"Empfänger GmbH";"Ich";"Test";"DE44500105175407324931"`,
      `"30.08.2026";"20,00";"Ich";"Zahler AG";"Test 2";""`,
    ].join("\n");
    const r = parseStatement(new TextEncoder().encode(csv));
    expect(r.format).toBe("dkb-csv");
    expect(r.accountName).toBe("Tagesgeld");
    expect(r.transactions.map((t) => [t.amount, t.counterpartyName])).toEqual([
      [-1000, "Empfänger GmbH"],
      [2000, "Zahler AG"],
    ]);
    expect(r.openingBalance).toBe(99000);
  });

  it("übernimmt keinen Saldo, der vor der letzten Buchung liegt", () => {
    const csv = [
      `"Girokonto";"DE02120300000000202051"`,
      `"Kontostand vom 01.08.2026:";"1.000,00 €"`,
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)"`,
      `"31.08.26";"31.08.26";"Gebucht";"Ich";"Laden";"Einkauf";"Ausgang";"";"-10,00"`,
    ].join("\n");
    const r = parseStatement(new TextEncoder().encode(csv));
    expect(r.openingBalance).toBeUndefined();
    expect(r.closingBalance).toBeUndefined();
    expect(r.statedBalance).toEqual({ date: "2026-08-01", amount: 100000 });
    expect(r.warnings).toHaveLength(1);
  });
});

describe("DKB (altes Format, Latin-1)", () => {
  const s = parseStatement(fixture("dkb-alt.csv"));

  it("erkennt Format, Konto, Zeitraum und Salden", () => {
    expect(s.format).toBe("dkb-csv-alt");
    expect(s.accountIban).toBe("DE12120300001234567890");
    expect(s.accountName).toBe("Girokonto");
    expect(s.periodFrom).toBe("2026-09-01");
    expect(s.periodTo).toBe("2026-09-30");
    expect(s.closingBalance).toBe(1865872);
    expect(s.openingBalance).toBe(1818048);
    expect(s.warnings).toEqual([]);
  });

  it("dekodiert Umlaute korrekt", () => {
    expect(s.transactions[3]!.counterpartyName).toBe("Büro & Co. KG");
    expect(s.transactions[5]).toMatchObject({
      counterpartyName: "Bäckerei Müßig",
      purpose: "Frühstück Kundentermin Größe M",
      type: "Überweisung",
      amount: -2340,
    });
  });

  it("liest Gegenkonto und Referenzen", () => {
    expect(s.transactions).toHaveLength(6);
    expect(s.transactions[4]).toMatchObject({
      amount: 476000,
      counterpartyIban: "DE89370400440532013000",
      type: "Gutschrift",
      bankReference: undefined,
    });
  });
});

describe("N26", () => {
  it("liest das aktuelle Format", () => {
    const s = parseStatement(fixture("n26.csv"));
    expect(s.format).toBe("n26-csv");
    expect(s.accountIban).toBeUndefined();
    expect(s.accountName).toBe("Main Account");
    expect(s.openingBalance).toBeUndefined();
    expect(s.periodFrom).toBe("2026-09-01");
    expect(s.periodTo).toBe("2026-09-10");
    expect(s.transactions.map((t) => [t.bookingDate, t.amount, t.counterpartyName, t.purpose])).toEqual([
      ["2026-09-01", 476000, "Nordwerk Software GmbH", "RE 2026-030"],
      ["2026-09-03", -450, "Bäckerei Müßig", ""],
      ["2026-09-05", -2137, "Cloud Services Inc.", "Subscription September"],
      ["2026-09-10", -51230, "Krankenkasse Muster", "Beitrag 09/2026"],
    ]);
    expect(s.transactions[2]!.valueDate).toBe("2026-09-06");
    expect(s.transactions[3]).toMatchObject({ counterpartyIban: "DE02100100100068201011", type: "Direct Debit" });
  });

  it("liest das ältere Format", () => {
    const s = parseStatement(fixture("n26-alt.csv"));
    expect(s.format).toBe("n26-csv");
    expect(s.accountName).toBeUndefined();
    expect(s.transactions.map((t) => [t.bookingDate, t.amount, t.counterpartyIban, t.type])).toEqual([
      ["2022-03-01", 119000, "DE89370400440532013000", "Income"],
      ["2022-03-02", -450, undefined, "MasterCard Payment"],
      ["2022-03-15", -85000, "DE75512108001245126199", "Outgoing Transfer"],
    ]);
    expect(s.transactions[2]!.purpose).toBe("Miete März 2022");
  });
});

describe("CAMT.053", () => {
  it("liest camt.053.001.02 mit Sammelbuchung und vorgemerktem Umsatz", () => {
    const s = parseStatement(fixture("camt053-001-02.xml"));
    expect(s.format).toBe("camt053");
    expect(s.accountIban).toBe("DE12120300001234567890");
    expect(s.currency).toBe("EUR");
    expect(s.openingBalance).toBe(1800000);
    expect(s.closingBalance).toBe(1851374);
    expect(s.periodFrom).toBe("2026-09-01");
    expect(s.periodTo).toBe("2026-09-30");
    expect(s.warnings).toEqual(["1 vorgemerkter Umsatz wurde übersprungen."]);
    expect(s.transactions.map((t) => [t.index, t.bookingDate, t.amount, t.counterpartyName])).toEqual([
      [0, "2026-09-02", 476000, "Nordwerk Software GmbH"],
      [1, "2026-09-15", -300000, "Büro & Co. KG"],
      [2, "2026-09-29", -123456, "Finanzamt Musterstadt"],
      [3, "2026-09-29", -1190, "Hosting AG"],
      [4, "2026-09-30", 20, ""],
    ]);
    const sum = s.transactions.reduce((a, t) => a + t.amount, 0);
    expect(s.openingBalance! + sum).toBe(s.closingBalance);

    expect(s.transactions[0]).toMatchObject({
      counterpartyIban: "DE89370400440532013000",
      purpose: "RE 2026-030 Leistungen Juli",
      bankReference: "2026090200001",
      type: "Gutschrift",
      valueDate: "2026-09-02",
    });
    expect(s.transactions[1]).toMatchObject({
      purpose: "Miete Coworking September",
      counterpartyIban: "DE75512108001245126199",
      bankReference: "2026091500007",
      type: "Überweisung",
    });
    expect(s.transactions[2]).toMatchObject({
      purpose: "St.-Nr. 123/456/78901 UStVA 08/2026",
      bankReference: "STEUER-2026-08",
      mandateReference: "FA-MANDAT-01",
      type: "Lastschrift",
    });
    expect(s.transactions[3]).toMatchObject({ creditorId: "DE98ZZZ09999999999", counterpartyIban: "DE44500105175407324931" });
    expect(s.transactions[4]).toMatchObject({ purpose: "Zinsgutschrift 3. Quartal", type: "Zinsgutschrift 3. Quartal" });
  });

  it("liest camt.053.001.08 mit Präfix, Pty/Nm und mehreren Auszügen", () => {
    const s = parseStatement(fixture("camt053-001-08.xml"));
    expect(s.format).toBe("camt053");
    expect(s.accountIban).toBe("DE12120300001234567890");
    expect(s.openingBalance).toBe(-15000);
    expect(s.closingBalance).toBe(79050);
    expect(s.periodFrom).toBe("2026-10-01");
    expect(s.periodTo).toBe("2026-10-02");
    expect(s.transactions).toEqual([
      expect.objectContaining({
        index: 0,
        amount: 100000,
        counterpartyName: "Lindenhof Verlag e.K.",
        counterpartyIban: "DE68210501700012345678",
        purpose: "RE 2026-032 Lektorat",
        bankReference: "REF-1001",
      }),
      expect.objectContaining({
        index: 1,
        amount: -5950,
        counterpartyName: "Telefon GmbH",
        purpose: "RF18539007547034",
        bankReference: "TEL-2026-10",
        mandateReference: "TEL-778899",
        type: "NDDT+105",
      }),
    ]);
  });

  it("lehnt Dateien mit mehreren Konten ab", () => {
    const xml = new TextDecoder()
      .decode(fixture("camt053-001-08.xml"))
      .replace("<camt:IBAN>DE12120300001234567890</camt:IBAN>", "<camt:IBAN>DE02120300000000202051</camt:IBAN>");
    expect(() => parseStatement(new TextEncoder().encode(xml))).toThrow(/mehrerer Konten/);
  });

  it("warnt bei Fremdwährung", () => {
    const xml = new TextDecoder()
      .decode(fixture("camt053-001-08.xml"))
      .replaceAll("<camt:Ccy>EUR</camt:Ccy>", "<camt:Ccy>CHF</camt:Ccy>")
      .replaceAll('Ccy="EUR"', 'Ccy="CHF"');
    const s = parseStatement(new TextEncoder().encode(xml));
    expect(s.currency).toBe("CHF");
    expect(s.warnings.join()).toMatch(/Fremdwährung.*CHF/);
  });
});

describe("Erkennung und Fehler", () => {
  it.each([
    ["dkb-neu.csv", "dkb-csv"],
    ["dkb-alt.csv", "dkb-csv-alt"],
    ["n26.csv", "n26-csv"],
    ["n26-alt.csv", "n26-csv"],
    ["camt053-001-02.xml", "camt053"],
    ["camt053-001-08.xml", "camt053"],
  ])("%s → %s", (name, format) => {
    expect(detectStatementFormat(fixture(name))).toBe(format);
  });

  it("richtet sich nach dem Inhalt, nicht nach dem Dateinamen", () => {
    expect(parseStatement(fixture("n26.csv"), "auszug.xml").format).toBe("n26-csv");
  });

  it.each([
    ["leer", new Uint8Array()],
    ["Text", new TextEncoder().encode("Hallo Welt\nnoch eine Zeile")],
    ["CSV ohne Kontoauszug", new TextEncoder().encode("a;b;c\n1;2;3\n")],
    ["Binärdaten", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x13, 0x88])],
    ["fremdes XML", new TextEncoder().encode("<?xml version='1.0'?><rss><channel/></rss>")],
    ["kaputtes XML", new TextEncoder().encode("<Document><BkToCstmrStmt><Stmt></BkToCstmrStmt>")],
    ["CAMT.052", new TextEncoder().encode("<Document><BkToCstmrAcctRpt/></Document>")],
  ])("%s → StatementParseError", (_label, bytes) => {
    expect(() => parseStatement(bytes, "datei.csv")).toThrow(StatementParseError);
  });

  it("meldet ungültige Beträge mit Zeilennummer", () => {
    const csv = fixture("n26.csv");
    const broken = new TextDecoder().decode(csv).replace("-512.30", "abc");
    expect(() => parseStatement(new TextEncoder().encode(broken))).toThrow(/Ungültiger Betrag „abc“ \(Zeile 5\)/);
  });
});

describe("Zeichenkodierung", () => {
  const latin1 = fixture("dkb-alt.csv");
  const text = new TextDecoder("windows-1252").decode(latin1);

  it("liest dieselbe Datei als UTF-8 ohne BOM", () => {
    const s = parseStatement(new TextEncoder().encode(text));
    expect(s.transactions[5]!.counterpartyName).toBe("Bäckerei Müßig");
  });

  it("liest UTF-16 mit BOM", () => {
    const le = new Uint8Array(2 + text.length * 2);
    le[0] = 0xff;
    le[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      le[2 + i * 2] = code & 0xff;
      le[3 + i * 2] = code >> 8;
    }
    const s = parseStatement(le);
    expect(s.format).toBe("dkb-csv-alt");
    expect(s.transactions[5]!.purpose).toBe("Frühstück Kundentermin Größe M");
  });

  it("liest die neue DKB-Datei auch als Latin-1", () => {
    const utf8 = new TextDecoder().decode(fixture("dkb-neu.csv")).replace("€", "EUR");
    const s = parseStatement(new Uint8Array(Buffer.from(utf8, "latin1")));
    expect(s.format).toBe("dkb-csv");
    expect(s.transactions[4]!.counterpartyName).toBe("Büro & Co. KG");
  });
});
