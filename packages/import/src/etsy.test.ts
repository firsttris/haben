import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectStatementFormat, PSP_FORMATS, parseStatement, StatementParseError, withDedupHashes } from "./index.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url)));
const bytes = (text: string) => new TextEncoder().encode(text);
const brief = (s: ReturnType<typeof parseStatement>) => s.transactions.map((t) => [t.bookingDate, t.amount, t.counterpartyName, t.purpose]);
const sum = (total: number, t: { amount: number }) => total + t.amount;

/*
 * Monatsabrechnung von Etsy (Finanzen › Monatliche Abrechnungen › CSV). Kopfzeile und Datum deutsch oder englisch, die
 * Zeilenarten (Sale, Fee, Marketing, Tax, Refund) englisch; Beträge mit Dezimalpunkt und Währungszeichen, leere Zellen
 * als „--“. Etsy-Dateien liegen als Fixtures: etsy-de.csv (anonymisiert von Lucifus01, Issue #296) und etsy-en.csv (eigene
 * Datei in Euro nach dem Aufbau, den dylancaponi im Issue beschreibt).
 */
const germanHeader = `Datum,Art,Titel,Info,Währung,Betrag,"Gebühren & Steuern",Netto,"Steuerliche Angaben"`;
const englishHeader = `Date,Type,Title,Info,Currency,Amount,"Fees & Taxes",Net,"Tax Details"`;
const german = (rows: string[]) => bytes([germanHeader, ...rows].join("\n"));
const english = (rows: string[]) => bytes([englishHeader, ...rows].join("\n"));

describe("Etsy-Monatsabrechnung", () => {
  it("liest die deutsche Abrechnung: jede Zeile ein Umsatz, Verkäufe, Gebühren und Auszahlung getrennt", () => {
    const file = fixture("etsy-de.csv");
    expect(detectStatementFormat(file)).toBe("etsy-csv");
    const s = parseStatement(file, "etsy-de.csv");
    expect(s.format).toBe("etsy-csv");
    expect(s.currency).toBe("EUR");
    expect(s.transactions).toHaveLength(39);

    // Die Auszahlung steht nur im Titel („€69.75 an dein Bankkonto überwiesen“), ihre Betragsspalten sind leer
    expect(s.transactions.filter((t) => t.type === "Auszahlung").map((t) => [t.bookingDate, t.amount])).toEqual([["2026-11-02", -6975]]);
    const others = s.transactions.filter((t) => t.type !== "Auszahlung");
    expect(others.reduce(sum, 0)).toBe(5098); // Summe der Spalte „Netto“
    expect(others.filter((t) => t.amount > 0).reduce(sum, 0)).toBe(6695); // 6 Verkäufe
    expect(others.filter((t) => t.amount < 0).reduce(sum, 0)).toBe(-1597); // Gebühren und Werbung

    // Die Datei beginnt mit der neuesten Zeile, die Umsätze gehen aufsteigend nach Datum
    const dates = s.transactions.map((t) => t.bookingDate);
    expect(dates).toEqual([...dates].sort());
    expect([s.periodFrom, s.periodTo]).toEqual(["2026-11-01", "2026-11-05"]);
    expect(s.warnings).toEqual([]);
  });

  it("ordnet die Zeilenarten zu: Verkauf, Gebühr, Werbung, Auszahlung", () => {
    const s = parseStatement(
      german([
        `"05. November 2026",Sale,"Payment for Order #XXX-001",,EUR,€8.73,--,€8.73,--`,
        `"05. November 2026",Fee,"Processing fee","Order #XXX-001",EUR,--,-€0.65,-€0.65,--`,
        `"05. November 2026",Marketing,"Etsy Ads","Bill for click-throughs to your shop on Nov 4, 2026",EUR,--,-€0.46,-€0.46,--`,
        `"02. November 2026",Überweisung,"€69.75 an dein Bankkonto überwiesen",,EUR,--,--,--,--`,
      ]),
    );
    expect(brief(s)).toEqual([
      // „Auszahlung“ im Zweck, damit Haben im Konto des Dienstleisters den Geldtransit zur Bank vorschlägt (PAYOUT_PURPOSE)
      ["2026-11-02", -6975, "Etsy", "Auszahlung · €69.75 an dein Bankkonto überwiesen"],
      ["2026-11-05", 873, "Etsy", "Sale · Payment for Order #XXX-001"],
      // „Gebühr“ am Anfang wie bei den übrigen Dienstleistern: Darauf baut die Zuordnung zur Sammelrechnung (Server und Knopf)
      ["2026-11-05", -65, "Etsy", "Gebühr · Processing fee · Order #XXX-001"],
      ["2026-11-05", -46, "Etsy", "Marketing · Etsy Ads · Bill for click-throughs to your shop on Nov 4, 2026"],
    ]);
    expect(s.transactions.map((t) => t.type)).toEqual(["Auszahlung", "Verkauf", "Gebühr", "Werbung"]);
    expect(s.warnings).toEqual([]);
  });

  it("eine Zeile mit Betrag und Gebühren wird zu zwei Umsätzen: Bruttobetrag und Gebühr", () => {
    const s = parseStatement(german([`"05. November 2026",Sale,"Payment for Order #XXX-009",,EUR,€10.00,-€0.50,€9.50,--`]));
    expect(brief(s)).toEqual([
      ["2026-11-05", 1000, "Etsy", "Sale · Payment for Order #XXX-009"],
      ["2026-11-05", -50, "Etsy", "Gebühr · Sale · Payment for Order #XXX-009"],
    ]);
    expect(s.transactions.map((t) => t.type)).toEqual(["Verkauf", "Gebühr"]);
  });

  it("englische Abrechnung: Monatsnamen im Datum, Tausendertrenner, Tax- und Erstattungszeilen, Anführungszeichen im Titel; alles zusammen ergibt null", () => {
    const file = fixture("etsy-en.csv");
    expect(detectStatementFormat(file)).toBe("etsy-csv");
    const s = parseStatement(file, "etsy-en.csv");
    expect(s.transactions).toHaveLength(11);
    // Verkäufe, Gebühren, Steuer, Erstattung und Werbung mindern oder mehren das Guthaben; die Auszahlung holt es ab
    expect(s.transactions.reduce(sum, 0)).toBe(0);
    expect(brief(s)).toEqual([
      ["2025-03-08", -31, "Etsy", "Gebühr · Transaction fee: Shipping · Order #2500000001"],
      ["2025-03-08", -273, "Etsy", 'Gebühr · Transaction fee: Notebook, "handmade" cover · Order #2500000001'],
      ["2025-03-08", -336, "Etsy", "Tax · Sales tax paid by buyer · Order #2500000001"],
      ["2025-03-08", -162, "Etsy", "Gebühr · Processing fee · Order #2500000001"],
      ["2025-03-08", 125000, "Etsy", "Sale · Payment for Order #2500000001"],
      ["2025-03-09", -18, "Etsy", "Gebühr · Listing fee (€0.18) · Listing #1500000002"],
      ["2025-03-20", -1737, "Etsy", "Refund · Refund to buyer for Order #2500000002"],
      ["2025-03-20", 89, "Etsy", "Gebühr · Credit for processing fee · Order #2500000002"],
      ["2025-03-20", 130, "Etsy", "Tax · Refund to buyer for sales tax · Order #2500000002"],
      ["2025-03-28", -86, "Etsy", "Marketing · Etsy Ads · Bill for click-throughs to your shop on Mar 27, 2025"],
      ["2025-03-31", -122576, "Etsy", "Auszahlung · €1,225.76 sent to your bank account"],
    ]);
    expect(s.transactions.map((t) => t.type)).toEqual([
      "Gebühr",
      "Gebühr",
      "Umsatzsteuer",
      "Gebühr",
      "Verkauf",
      "Gebühr",
      "Erstattung",
      "Gebühr",
      "Umsatzsteuer",
      "Werbung",
      "Auszahlung",
    ]);
    expect(s.warnings).toEqual([]);
  });

  it("Tax-Zeilen (Umsatzsteuer, die Etsy für den Käufer abführt) sind keine Gebühr", () => {
    const s = parseStatement(english([`"March 8, 2025",Tax,"Sales tax paid by buyer","Order #1",EUR,--,-€3.36,-€3.36,--`]));
    expect(s.transactions.map((t) => [t.type, t.amount])).toEqual([["Umsatzsteuer", -336]]);
  });

  it("erkennt auch ältere Dateien ohne die Spalte Tax Details", () => {
    const file = bytes(
      [`Date,Type,Title,Info,Currency,Amount,"Fees & Taxes",Net`, `"March 8, 2025",Sale,"Payment for Order #1",,EUR,€5.00,--,€5.00`].join("\n"),
    );
    expect(detectStatementFormat(file)).toBe("etsy-csv");
    expect(brief(parseStatement(file))).toEqual([["2025-03-08", 500, "Etsy", "Sale · Payment for Order #1"]]);
  });

  it("liest Datei mit Windows-Zeilenenden und ohne BOM", () => {
    const file = bytes([englishHeader, `"March 8, 2025",Sale,"Payment for Order #1",,EUR,€5.00,--,€5.00,--`, ""].join("\r\n"));
    expect(brief(parseStatement(file))).toEqual([["2025-03-08", 500, "Etsy", "Sale · Payment for Order #1"]]);
  });

  it("liest die Monatsnamen deutsch und englisch", () => {
    const dates = [
      "01. März 2026",
      "2. Mai 2026",
      "05. Oktober 2026",
      "30. Dezember 2026",
      "March 31, 2025",
      "May 2, 2026",
      "October 5, 2026",
      "December 30, 2026",
    ];
    const s = parseStatement(english(dates.map((d) => `"${d}",Sale,"Payment for Order #1",,EUR,€1.00,--,€1.00,--`)));
    expect(s.transactions.map((t) => t.bookingDate).sort()).toEqual([
      "2025-03-31",
      "2026-03-01",
      "2026-05-02",
      "2026-05-02",
      "2026-10-05",
      "2026-10-05",
      "2026-12-30",
      "2026-12-30",
    ]);
  });

  it("überspringt Zeilen in fremder Währung und meldet sie", () => {
    const s = parseStatement(
      english([
        `"March 31, 2025",Sale,"Payment for Order #1",,USD,$10.00,--,$10.00,--`,
        `"March 31, 2025",Sale,"Payment for Order #2",,EUR,€10.00,--,€10.00,--`,
      ]),
    );
    expect(brief(s)).toEqual([["2025-03-31", 1000, "Etsy", "Sale · Payment for Order #2"]]);
    expect(s.warnings).toEqual(["1 Zeile übersprungen: nicht in Euro."]);
  });

  it("übernimmt eine unbekannte Zeilenart mit dem Nettobetrag und meldet sie", () => {
    const s = parseStatement(english([`"March 31, 2025","Shipping label","USPS label","Order #1",EUR,--,-€4.95,-€4.95,--`]));
    expect(brief(s)).toEqual([["2025-03-31", -495, "Etsy", "Shipping label · USPS label · Order #1"]]);
    expect(s.transactions[0]!.type).toBe("Shipping label");
    expect(s.warnings).toEqual(["1 Zeile mit unbekannter Art (Shipping label) mit dem Nettobetrag übernommen."]);
  });

  it("gleiche Zeilen am selben Tag bleiben erhalten und bekommen verschiedene Hashes", () => {
    const hashed = withDedupHashes(parseStatement(fixture("etsy-de.csv")).transactions);
    // Zwei gleiche Einstellgebühren für Artikel XXX-B am 03.11., zwei für Artikel XXX-A am 01.11.
    expect(hashed.filter((t) => t.bookingDate === "2026-11-03" && t.purpose.includes("Artikel Nr. XXX-B"))).toHaveLength(2);
    expect(hashed.filter((t) => t.bookingDate === "2026-11-01" && t.purpose.includes("Artikel Nr. XXX-A"))).toHaveLength(2);
    expect(new Set(hashed.map((t) => t.dedupHash)).size).toBe(hashed.length);
  });

  it("bricht bei ungültigem Datum oder Betrag mit Zeilenangabe ab", () => {
    expect(() => parseStatement(english([`"Sunday 99",Sale,"Payment for Order #1",,EUR,€1.00,--,€1.00,--`]))).toThrow(StatementParseError);
    expect(() => parseStatement(english([`"Sunday 99",Sale,"Payment for Order #1",,EUR,€1.00,--,€1.00,--`]))).toThrow(
      /Ungültiges Datum „Sunday 99“ \(Zeile 2\)/,
    );
    expect(() => parseStatement(english([`"March 31, 2025",Sale,"Payment for Order #1",,EUR,€abc,--,€abc,--`]))).toThrow(
      /Ungültiger Betrag „€abc“ \(Zeile 2\)/,
    );
  });

  it("bricht ab, wenn der Betrag der Auszahlung im Titel fehlt", () => {
    expect(() => parseStatement(english([`"March 31, 2025",Deposit,"Payout",,EUR,--,--,--,--`]))).toThrow(/Betrag der Auszahlung.*„Payout“.*\(Zeile 2\)/);
  });

  it("gilt als Zahlungsdienstleister: nur in ein Konto mit diesem Zweck importierbar", () => {
    expect(PSP_FORMATS).toContain("etsy-csv");
  });
});
