import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectStatementFormat, withDedupHashes } from "../index.ts";
import {
  type BankCsvFile,
  type BankCsvMapping,
  changesDuplicateDetection,
  findSavedHeader,
  guessHeaderRow,
  initialMapping,
  parseMappedStatement,
  readBankCsv,
  sampleValue,
  suggestBankMapping,
} from "./index.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../test-fixtures/${name}`, import.meta.url)));
const encode = (text: string) => new TextEncoder().encode(text);

function read(bytes: Uint8Array): BankCsvFile {
  const file = readBankCsv(bytes);
  if ("error" in file) throw new Error(file.error);
  return file;
}

/** Erfundene Bank mit Kopfblock, leerer Spalte „Betrag“, Soll und Haben getrennt, Windows-1252 und Kontostand am Ende */
describe("Bank-CSV mit Kopfblock, Soll und Haben", () => {
  const bytes = fixture("unbekannte-bank-soll-haben.csv");
  const file = read(bytes);

  it("erkennt die Bank nicht und liest die Datei trotzdem als Tabelle", () => {
    expect(detectStatementFormat(bytes)).toBeNull();
    expect(file.encoding).toBe("windows-1252");
    expect(file.delimiter).toBe(";");
  });

  it("schlägt die Kopfzeile hinter dem Kopfblock vor", () => {
    const header = guessHeaderRow(file.records);
    expect(file.records[header]!.line).toBe(4);
    expect(file.records[header]!.cells[0]).toBe("Buchungstag");
  });

  it("schlägt Soll und Haben statt der leeren Spalte Betrag vor", () => {
    const mapping = suggestBankMapping(file.records, guessHeaderRow(file.records));
    const at = (key: string) => (mapping.columns[key] === null ? null : mapping.header[mapping.columns[key]!]);
    expect(at("bookingDate")).toBe("Buchungstag");
    expect(at("valueDate")).toBe("Wert");
    expect(at("amount")).toBeNull();
    expect(at("debit")).toBe("Soll");
    expect(at("credit")).toBe("Haben");
    expect(at("counterpartyName")).toBe("Begünstigter / Auftraggeber");
    expect(at("counterpartyIban")).toBe("IBAN");
    expect(at("purpose")).toBe("Verwendungszweck");
    expect(at("type")).toBe("Umsatzart");
    expect(at("bankReference")).toBe("Kundenreferenz");
    expect(at("currency")).toBe("Währung");
    expect(mapping.amountFormat).toBe("de");
  });

  it("liest die Umsätze, Soll als Ausgang, und übernimmt den Kontostand am Ende nicht", () => {
    const headerRow = guessHeaderRow(file.records);
    const result = parseMappedStatement(file.records, headerRow, suggestBankMapping(file.records, headerRow));
    expect(result.problem).toBeNull();
    const s = result.statement!;
    expect(s.format).toBe("csv-zuordnung");
    expect(s.accountIban).toBeUndefined();
    expect(s.periodFrom).toBe("2026-10-01");
    expect(s.periodTo).toBe("2026-10-31");
    expect(s.transactions.map((t) => t.amount)).toEqual([1085280, -119000, -3999, -990]);
    expect(s.transactions[0]).toMatchObject({
      bookingDate: "2026-10-01",
      valueDate: "2026-10-01",
      currency: "EUR",
      counterpartyName: "Nordwerk Software GmbH",
      counterpartyIban: "DE02120300000000202051",
      purpose: "Rechnung 2026-031",
      type: "SEPA-Gutschrift",
    });
    expect(s.transactions[1]!.type).toBe("SEPA-Überweisung an");
    expect(s.transactions[3]).toMatchObject({ counterpartyName: "", counterpartyIban: undefined, purpose: "Kontoführung Oktober", type: "Entgelt" });
    expect(s.warnings).toEqual([expect.stringMatching(/^Zeile 9 nicht übernommen: Buchungstag „Kontostand“ ist kein Datum\./)]);
    expect(result.rows.find((r) => r.line === 9)?.transaction).toBeNull();
  });

  it("findet die gespeicherte Kopfzeile in der nächsten Datei wieder, die Dubletten-Hashes bleiben gleich", () => {
    const headerRow = guessHeaderRow(file.records);
    const mapping = suggestBankMapping(file.records, headerRow);
    const again = read(bytes);
    const found = findSavedHeader(again.records, mapping.header);
    expect(found).toBe(headerRow);
    const hashes = (rows: BankCsvFile, at: number) =>
      withDedupHashes(parseMappedStatement(rows.records, at, mapping).statement!.transactions).map((t) => t.dedupHash);
    expect(hashes(again, found)).toEqual(hashes(file, headerRow));
  });
});

describe("parseMappedStatement", () => {
  const csv = (text: string) => read(encode(text));
  const mapping = (file: BankCsvFile, columns: Record<string, number | null>, amountFormat: "de" | "en" = "de"): BankCsvMapping => ({
    header: file.records[0]!.cells,
    columns: {
      bookingDate: 0,
      valueDate: null,
      amount: null,
      debit: null,
      credit: null,
      currency: null,
      counterpartyName: null,
      counterpartyIban: null,
      purpose: null,
      type: null,
      bankReference: null,
      ...columns,
    },
    amountFormat,
  });

  it("Soll und Haben ergeben dieselben Cent wie eine Spalte mit Vorzeichen, auch wenn die Bank Soll mit Minus schreibt", () => {
    const split = csv("Datum;Soll;Haben;Zweck\n01.10.2026;12,50;;A\n02.10.2026;-7,00;;B\n03.10.2026;;100,00;C\n04.10.2026;0,00;20,00;D\n");
    const signed = csv("Datum;Betrag;Zweck\n01.10.2026;-12,50;A\n02.10.2026;-7,00;B\n03.10.2026;100,00;C\n04.10.2026;20,00;D\n");
    const a = parseMappedStatement(split.records, 0, mapping(split, { debit: 1, credit: 2, purpose: 3 })).statement!;
    const b = parseMappedStatement(signed.records, 0, mapping(signed, { amount: 1, purpose: 2 })).statement!;
    expect(a.transactions.map((t) => t.amount)).toEqual([-1250, -700, 10000, 2000]);
    expect(b.transactions.map((t) => t.amount)).toEqual(a.transactions.map((t) => t.amount));
  });

  it("meldet Zeilen mit Soll und Haben zugleich, ohne Betrag oder mit kaputtem Datum und übernimmt sie nicht", () => {
    const file = csv("Datum;Soll;Haben\n01.10.2026;5,00;6,00\n02.10.2026;;\n31.02.2026;1,00;\n03.10.2026;1,00;\n");
    const result = parseMappedStatement(file.records, 0, mapping(file, { debit: 1, credit: 2 }));
    expect(result.rows.map((r) => r.errors)).toEqual([
      ["Soll und Haben sind beide gefüllt."],
      ["Soll und Haben sind beide leer."],
      ["Buchungstag „31.02.2026“ ist kein Datum."],
      [],
    ]);
    expect(result.statement!.transactions).toHaveLength(1);
    expect(result.statement!.warnings).toHaveLength(3);
  });

  it("liest englische Beträge nur mit Zahlenformat en, und schlägt es vor", () => {
    const file = csv("Date,Amount,Purpose\n2026-10-01,-1234.5,Rent\n2026-10-02,12.00,Refund\n");
    expect(file.delimiter).toBe(",");
    expect(suggestBankMapping(file.records, 0).amountFormat).toBe("en");
    expect(parseMappedStatement(file.records, 0, mapping(file, { amount: 1 }, "en")).statement!.transactions.map((t) => t.amount)).toEqual([-123450, 1200]);
    expect(parseMappedStatement(file.records, 0, mapping(file, { amount: 1 }, "de")).rows[0]!.errors).toEqual(["Betrag „-1234.5“ ist kein Betrag."]);
  });

  it.each([
    [{ bookingDate: null, amount: 1 }, "Ordne den Buchungstag einer Spalte zu."],
    [{ debit: 1 }, "Ordne den Betrag zu oder Soll und Haben."],
    [{ amount: 1, credit: 2 }, "Ordne entweder den Betrag oder Soll und Haben zu, nicht beides."],
    [{ amount: 1, purpose: 1 }, "Die Spalte „Betrag“ ist Betrag und Verwendungszweck zugeordnet"],
  ])("lehnt die Zuordnung %j ab", (columns, problem) => {
    const file = csv("Datum;Betrag;Haben\n01.10.2026;1,00;\n");
    expect(parseMappedStatement(file.records, 0, mapping(file, columns))).toMatchObject({ problem, statement: null });
  });

  it("gilt nur für die Kopfzeile, für die sie gespeichert ist", () => {
    const file = csv("Datum;Betrag\n01.10.2026;1,00\n");
    const other = { ...mapping(file, { amount: 1 }), header: ["Datum", "Umsatz"] };
    expect(parseMappedStatement(file.records, 0, other).problem).toBe("Die Zuordnung gilt für eine andere Kopfzeile.");
    expect(findSavedHeader(file.records, other.header)).toBe(-1);
  });

  it("nimmt nur eine gültige IBAN als Gegen-IBAN", () => {
    const file = csv("Datum;Betrag;IBAN\n01.10.2026;1,00;1234567890\n02.10.2026;1,00;DE02 1203 0000 0000 2020 51\n");
    const s = parseMappedStatement(file.records, 0, mapping(file, { amount: 1, counterpartyIban: 2 })).statement!;
    expect(s.transactions.map((t) => t.counterpartyIban)).toEqual([undefined, "DE02120300000000202051"]);
  });

  it("übernimmt nur Euro: eine Zeile in anderer Währung ist ein Fehler, kein Euro-Betrag (#1275)", () => {
    const file = csv("Datum;Betrag;Währung\n01.10.2026;1,00;eur\n02.10.2026;5,00;USD\n03.10.2026;2,00;\n");
    const result = parseMappedStatement(file.records, 0, mapping(file, { amount: 1, currency: 2 }));
    expect(result.statement!.transactions.map((t) => [t.amount, t.currency])).toEqual([
      [100, "EUR"],
      [200, "EUR"],
    ]);
    expect(result.rows[1]!.errors).toEqual(["Währung USD: Haben bucht Bankkonten nur in Euro."]);
  });

  it("übernimmt keinen Umsatz über 0,00 €", () => {
    const file = csv("Datum;Soll;Haben\n01.10.2026;0,00;\n02.10.2026;1,00;\n");
    const result = parseMappedStatement(file.records, 0, mapping(file, { debit: 1, credit: 2 }));
    expect(result.statement!.transactions.map((t) => t.amount)).toEqual([-100]);
    expect(result.rows[0]!.errors).toEqual(["Der Betrag ist 0,00 €."]);
  });

  it("findet bei Komma das Trennzeichen auch hinter einem Kopfblock ohne Komma", () => {
    const file = csv('Kontoauszug Oktober\n\nDatum,Betrag,Zweck\n01.10.2026,"1,00",A\n');
    expect(file.delimiter).toBe(",");
    expect(file.records[guessHeaderRow(file.records)]!.cells).toEqual(["Datum", "Betrag", "Zweck"]);
  });

  it("lehnt XML und Dateien ohne Tabelle ab", () => {
    expect(readBankCsv(encode("<?xml version='1.0'?><Document/>"))).toEqual({ error: "Die Datei ist XML, keine CSV." });
    expect(readBankCsv(encode("nur eine Zeile\n"))).toEqual({ error: "Die Datei enthält keine Tabelle mit Kopfzeile und Umsätzen." });
  });

  it.each([
    ["PDF", "%PDF-1.7\n1 0 obj;x\n2 0 obj;y\n"],
    ["XLSX (ZIP)", "PK\u0003\u0004;a\nb;c\n"],
    ["Binärdaten", "a;b\u0000\nc;d\n"],
  ])("lehnt %s ab, statt eine Zuordnung anzubieten", (_name, text) => {
    expect(readBankCsv(encode(text))).toEqual({ error: "Die Datei ist keine CSV." });
  });
});

describe("Beginn des Dialogs", () => {
  const file = read(fixture("unbekannte-bank-soll-haben.csv"));
  const vorschlag = initialMapping(file.records, null);

  it("nimmt ohne gespeicherte Zuordnung den Vorschlag", () => {
    expect(vorschlag).toEqual({ headerRow: 2, mapping: suggestBankMapping(file.records, 2), saved: false });
  });

  it("nimmt die gespeicherte Zuordnung, wenn ihre Kopfzeile in der Datei steht, sonst den Vorschlag", () => {
    const gespeichert = { ...vorschlag.mapping, columns: { ...vorschlag.mapping.columns, bankReference: null } };
    expect(initialMapping(file.records, gespeichert)).toEqual({ headerRow: 2, mapping: gespeichert, saved: true });
    const fremd = { ...gespeichert, header: ["Datum", "Betrag"] };
    expect(initialMapping(file.records, fremd)).toEqual(vorschlag);
    // Eine von Hand gewählte andere Kopfzeile verwirft die gespeicherte
    expect(initialMapping(file.records, gespeichert, 0)).toMatchObject({ headerRow: 0, saved: false });
  });

  it("zeigt je Spalte einen Beispielwert aus den Umsätzen", () => {
    expect(sampleValue(file.records, 2, 15)).toBe("-1.190,00");
    expect(sampleValue(file.records, 2, 11)).toBe("");
  });

  it("meldet nur Änderungen, die den Dubletten-Hash berühren", () => {
    const m = vorschlag.mapping;
    expect(changesDuplicateDetection(m, { ...m, columns: { ...m.columns, bankReference: null, type: null, valueDate: null } })).toBe(false);
    expect(changesDuplicateDetection(m, { ...m, columns: { ...m.columns, purpose: null } })).toBe(true);
    expect(changesDuplicateDetection(m, { ...m, amountFormat: "en" })).toBe(true);
  });
});
