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
      // Etsy Ads stehen auf derselben Gebührenrechnung wie die übrigen Gebühren (Hinweis von Niruthan96 im PR #506)
      ["2026-11-05", -46, "Etsy", "Gebühr · Etsy Ads · Bill for click-throughs to your shop on Nov 4, 2026"],
    ]);
    expect(s.transactions.map((t) => t.type)).toEqual(["Auszahlung", "Verkauf", "Gebühr", "Werbung"]);
    expect(s.warnings).toEqual([]);
  });

  it("Werbung (Etsy Ads, Offsite Ads) beginnt wie jede Gebühr mit „Gebühr“, damit sie zur Sammelrechnung gehört; die Art bleibt Werbung", () => {
    const s = parseStatement(
      german([
        `"04. November 2026",Marketing,"Gebühr für Verkauf über Offsite Ads","Bestellnr. XXX-002",EUR,--,-€1.31,-€1.31,--`,
        `"04. November 2026",Marketing,"Etsy Ads","Bill for click-throughs to your shop on Nov 3, 2026",EUR,--,-€0.54,-€0.54,--`,
      ]),
    );
    expect(brief(s)).toEqual([
      ["2026-11-04", -131, "Etsy", "Gebühr · Gebühr für Verkauf über Offsite Ads · Bestellnr. XXX-002"],
      ["2026-11-04", -54, "Etsy", "Gebühr · Etsy Ads · Bill for click-throughs to your shop on Nov 3, 2026"],
    ]);
    expect(s.transactions.map((t) => t.type)).toEqual(["Werbung", "Werbung"]);
  });

  it("in der deutschen Abrechnung beginnt jede Gebühr und jede Werbung mit „Gebühr“, nur die übrigen Zeilen nicht", () => {
    const s = parseStatement(fixture("etsy-de.csv"));
    const fees = s.transactions.filter((t) => t.type === "Gebühr" || t.type === "Werbung");
    // 25 Gebührenzeilen (7 Einstellgebühren, 6 Abwicklungen, 12 Transaktionsgebühren) und 7 Werbezeilen (4 Etsy Ads, 3 Offsite Ads)
    expect(fees).toHaveLength(32);
    expect(fees.filter((t) => t.type === "Werbung")).toHaveLength(7);
    expect(fees.filter((t) => !t.purpose.startsWith("Gebühr"))).toEqual([]);
    expect(s.transactions.filter((t) => t.type !== "Gebühr" && t.type !== "Werbung" && t.purpose.startsWith("Gebühr"))).toEqual([]);
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
    // Die beiden Tax-Zeilen gehen im Verkauf und in der Erstattung derselben Bestellung auf
    expect(s.transactions).toHaveLength(9);
    // Verkäufe, Gebühren, Erstattung und Werbung mindern oder mehren das Guthaben; die Auszahlung holt es ab
    expect(s.transactions.reduce(sum, 0)).toBe(0);
    expect(brief(s)).toEqual([
      ["2025-03-08", -31, "Etsy", "Gebühr · Transaction fee: Shipping · Order #2500000001"],
      ["2025-03-08", -273, "Etsy", 'Gebühr · Transaction fee: Notebook, "handmade" cover · Order #2500000001'],
      ["2025-03-08", -162, "Etsy", "Gebühr · Processing fee · Order #2500000001"],
      // 1.250,00 € abzüglich 3,36 € Steuer des Käufers: der Betrag der Rechnung
      ["2025-03-08", 124664, "Etsy", "Sale · Payment for Order #2500000001"],
      ["2025-03-09", -18, "Etsy", "Gebühr · Listing fee (€0.18) · Listing #1500000002"],
      // 17,37 € erstattet, davon 1,30 € Steuer, die Etsy zurückgibt
      ["2025-03-20", -1607, "Etsy", "Refund · Refund to buyer for Order #2500000002"],
      ["2025-03-20", 89, "Etsy", "Gebühr · Credit for processing fee · Order #2500000002"],
      ["2025-03-28", -86, "Etsy", "Gebühr · Etsy Ads · Bill for click-throughs to your shop on Mar 27, 2025"],
      ["2025-03-31", -122576, "Etsy", "Auszahlung · €1,225.76 sent to your bank account"],
    ]);
    expect(s.transactions.map((t) => t.type)).toEqual(["Gebühr", "Gebühr", "Gebühr", "Verkauf", "Gebühr", "Erstattung", "Gebühr", "Werbung", "Auszahlung"]);
    expect(s.warnings).toEqual([]);
  });

  it("Gutschriften und Erstattungen tragen das Vorzeichen aus den Beträgen, nicht aus der Art (dylancaponi im Issue #296)", () => {
    // Fee und Tax kommen mit umgekehrtem Vorzeichen, wenn Etsy etwas zurückgibt; Teilerstattungen stehen wie Verkäufe in „Amount“
    const s = parseStatement(
      english([
        `"March 20, 2025",Refund,"Partial refund to buyer for Order #1",,EUR,-€5.00,--,-€5.00,--`,
        `"March 20, 2025",Fee,"Credit for processing fee","Order #1",EUR,--,€0.89,€0.89,--`,
        `"March 20, 2025",Fee,"Credit for transaction fee on Notebook","Order #1",EUR,--,€0.33,€0.33,--`,
        `"March 20, 2025",Fee,"Credit for listing fee ($0.20 USD)","Listing #2",EUR,--,€0.18,€0.18,--`,
        `"March 20, 2025",Tax,"Refund to buyer for sales tax","Order #1",EUR,--,€1.30,€1.30,--`,
      ]),
    );
    expect(s.transactions.map((t) => [t.type, t.amount, t.purpose])).toEqual([
      // 5,00 € erstattet, davon 1,30 € Steuer, die Etsy zurückgibt (Tax-Zeile derselben Bestellung)
      ["Erstattung", -370, "Refund · Partial refund to buyer for Order #1"],
      ["Gebühr", 89, "Gebühr · Credit for processing fee · Order #1"],
      ["Gebühr", 33, "Gebühr · Credit for transaction fee on Notebook · Order #1"],
      ["Gebühr", 18, "Gebühr · Credit for listing fee ($0.20 USD) · Listing #2"],
    ]);
    expect(s.warnings).toEqual([]);
  });

  describe("Tax-Zeilen: Steuer des Käufers, die Etsy abführt (Entscheidung des Maintainers im PR #506, wie bei eBay)", () => {
    const sale = (order: number, amount: string) => `"March 8, 2025",Sale,"Payment for Order #${order}",,EUR,${amount},--,${amount},--`;
    const tax = (order: number, amount: string) => `"March 8, 2025",Tax,"Sales tax paid by buyer","Order #${order}",EUR,--,${amount},${amount},--`;

    it("wird mit dem Verkauf derselben Bestellung verrechnet: der Verkauf kommt mit dem Rechnungsbetrag an", () => {
      const s = parseStatement(english([tax(2, "-€1.90"), tax(1, "-€3.36"), sale(1, "€100.00"), sale(2, "€10.00")]));
      expect(brief(s)).toEqual([
        ["2025-03-08", 9664, "Etsy", "Sale · Payment for Order #1"],
        ["2025-03-08", 810, "Etsy", "Sale · Payment for Order #2"],
      ]);
      expect(s.transactions.map((t) => t.type)).toEqual(["Verkauf", "Verkauf"]);
      expect(s.warnings).toEqual([]);
    });

    it("steht die Steuerzeile vor dem Verkauf in der Datei, ändert das nichts", () => {
      const s = parseStatement(english([sale(1, "€100.00"), tax(1, "-€3.36")]));
      expect(brief(s)).toEqual([["2025-03-08", 9664, "Etsy", "Sale · Payment for Order #1"]]);
    });

    it("bei einer Erstattung umgekehrt: „Refund to buyer for sales tax“ gegen die Erstattung derselben Bestellung", () => {
      const s = parseStatement(
        english([
          `"March 20, 2025",Refund,"Refund to buyer for Order #1",,EUR,-€17.37,--,-€17.37,--`,
          `"March 20, 2025",Tax,"Refund to buyer for sales tax","Order #1",EUR,--,€1.30,€1.30,--`,
        ]),
      );
      expect(brief(s)).toEqual([["2025-03-20", -1607, "Etsy", "Refund · Refund to buyer for Order #1"]]);
      expect(s.warnings).toEqual([]);
    });

    it("die Steuer eines Verkaufs wird nicht mit der Erstattung derselben Bestellung verrechnet, auch wenn sie am selben Tag steht", () => {
      const s = parseStatement(
        english([
          `"March 8, 2025",Refund,"Refund to buyer for Order #1",,EUR,-€5.00,--,-€5.00,--`,
          sale(1, "€100.00"),
          tax(1, "-€3.36"),
        ]),
      );
      expect(brief(s)).toEqual([
        ["2025-03-08", -500, "Etsy", "Refund · Refund to buyer for Order #1"],
        ["2025-03-08", 9664, "Etsy", "Sale · Payment for Order #1"],
      ]);
    });

    it("ohne Verkauf derselben Bestellung (etwa über die Monatsgrenze) bleibt die Zeile mit dem Nettobetrag und einer Warnung, nichts wird geraten", () => {
      const s = parseStatement(english([sale(1, "€100.00"), tax(7, "-€3.36")]));
      expect(brief(s)).toEqual([
        ["2025-03-08", 10000, "Etsy", "Sale · Payment for Order #1"],
        ["2025-03-08", -336, "Etsy", "Tax · Sales tax paid by buyer · Order #7"],
      ]);
      expect(s.warnings).toEqual(["1 Steuerzeile ohne Verkauf oder Erstattung derselben Bestellung mit dem Nettobetrag übernommen."]);
    });

    it("mehrere Teilerstattungen derselben Bestellung: die Steuer lässt sich nicht zuordnen und bleibt mit Warnung einzeln", () => {
      const s = parseStatement(
        english([
          `"March 20, 2025",Refund,"Partial refund to buyer for Order #1",,EUR,-€5.00,--,-€5.00,--`,
          `"March 21, 2025",Refund,"Partial refund to buyer for Order #1",,EUR,-€6.00,--,-€6.00,--`,
          `"March 21, 2025",Tax,"Refund to buyer for sales tax","Order #1",EUR,--,€0.90,€0.90,--`,
        ]),
      );
      expect(s.transactions.map((t) => t.amount)).toEqual([-500, -600, 90]);
      expect(s.warnings).toEqual(["1 Steuerzeile ohne Verkauf oder Erstattung derselben Bestellung mit dem Nettobetrag übernommen."]);
    });

    it("die Summe aller Umsätze bleibt der Nettobetrag der Datei", () => {
      const s = parseStatement(english([sale(1, "€100.00"), tax(1, "-€3.36"), tax(9, "-€1.00")]));
      expect(s.transactions.reduce(sum, 0)).toBe(10000 - 336 - 100);
    });

    // Annahme: Deutsche Dateien schreiben die Bestellung in der Info der Offsite-Ads-Zeilen als „Bestellnr. …“; eine deutsche
    // Tax-Zeile liegt uns nicht vor (der Shop von Lucifus01 hat keine), der Parser liest beide Schreibweisen
    it("die deutsche Bestellnummer „Bestellnr. …“ in der Info wird wie „Order #…“ gelesen", () => {
      const s = parseStatement(
        german([
          `"05. November 2026",Sale,"Payment for Order #XXX-001",,EUR,€8.73,--,€8.73,--`,
          `"05. November 2026",Tax,"Steuer","Bestellnr. XXX-001",EUR,--,-€0.50,-€0.50,--`,
        ]),
      );
      expect(brief(s)).toEqual([["2026-11-05", 823, "Etsy", "Sale · Payment for Order #XXX-001"]]);
    });
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
