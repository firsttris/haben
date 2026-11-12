import { describe, expect, it } from "vitest";
import { allocateSplitTax, documentSplitPosting, splitIssues, type DocumentSplitLine } from "./document-split.ts";
import { computeEuer } from "./euer.ts";
import { totalsFromTaxes } from "./invoice.ts";
import { documentPosting, paidTaxShares } from "./posting.ts";

/*
 * Aufteilung eines Eingangsbelegs (#271). Beispiel aus dem Issue, je 19 %: 100 € Handelsware, 50 € Software, 20 €
 * Bürobedarf ergeben 170 € netto, 32,30 € Vorsteuer und 202,30 € Zahlbetrag.
 */

const issueAmounts = [{ taxRate: 1900, net: 17_000, tax: 3_230 }];
const issueLines: DocumentSplitLine[] = [
  { category: "wareneinkauf", taxRate: 1900, net: 10_000 },
  { category: "software", taxRate: 1900, net: 5_000 },
  { category: "buero", taxRate: 1900, net: 2_000 },
];
const issueTotals = totalsFromTaxes([{ rate: 1900, base: 17_000, tax: 3_230 }]);

const KONTEN = {
  SKR03: { ware: "3200", software: "4964", buero: "4930", vorsteuer19: "1576", vorsteuer7: "1571", verbindlichkeiten: "1600", privat: "1890", kasse: "1000" },
  SKR04: { ware: "5200", software: "6837", buero: "6815", vorsteuer19: "1406", vorsteuer7: "1401", verbindlichkeiten: "3300", privat: "2180", kasse: "1600" },
} as const;

const sumOf = (values: number[]) => values.reduce((s, v) => s + v, 0);

describe("allocateSplitTax", () => {
  it("verteilt die Vorsteuer des Satzes anteilig nach Netto (Beispiel aus #271)", () => {
    expect(allocateSplitTax(issueLines, issueAmounts).map((l) => l.tax)).toEqual([1_900, 950, 380]);
  });

  it("Rundungsrest an die betragsmäßig größte Zeile; die Summe ist die Steuer laut Beleg", () => {
    // 3 × 33,33 € zu 19 %: Beleg 99,99 € netto, 19,00 € Vorsteuer (auf die Summe gerechnet), je Zeile 6,33 €
    const lines: DocumentSplitLine[] = [
      { category: "software", taxRate: 1900, net: 3_333 },
      { category: "buero", taxRate: 1900, net: 3_333 },
      { category: "software", taxRate: 1900, net: 3_333 },
    ];
    const allocated = allocateSplitTax(lines, [{ taxRate: 1900, net: 9_999, tax: 1_900 }]);
    expect(allocated.map((l) => l.tax)).toEqual([634, 633, 633]);
    expect(sumOf(allocated.map((l) => l.tax))).toBe(1_900);
  });

  it("die Vorsteuer laut Rechnung bleibt maßgeblich, auch wenn sie vom gerechneten Betrag abweicht", () => {
    const allocated = allocateSplitTax(issueLines, [{ taxRate: 1900, net: 17_000, tax: 3_231 }]);
    expect(allocated.map((l) => l.tax)).toEqual([1_901, 950, 380]);
  });

  it("je Steuersatz getrennt; 0 % bleibt ohne Steuer", () => {
    const allocated = allocateSplitTax(
      [
        { category: "literatur", taxRate: 700, net: 3_000 },
        { category: "buero", taxRate: 1900, net: 2_000 },
        { category: "porto", taxRate: 0, net: 85 },
        { category: "literatur", taxRate: 700, net: 1_000 },
      ],
      [
        { taxRate: 1900, net: 2_000, tax: 380 },
        { taxRate: 700, net: 4_000, tax: 280 },
        { taxRate: 0, net: 85, tax: 0 },
      ],
    );
    expect(allocated.map((l) => l.tax)).toEqual([210, 380, 0, 70]);
  });

  it("Gutschrift: negative Zeilen bekommen negative Steuer, exakt gespiegelt", () => {
    const negated = issueLines.map((l) => ({ ...l, net: -l.net }));
    expect(allocateSplitTax(negated, [{ taxRate: 1900, net: -17_000, tax: -3_230 }]).map((l) => l.tax)).toEqual([-1_900, -950, -380]);
  });
});

describe("splitIssues", () => {
  it("nichts zu melden, wenn Netto und Vorsteuer je Satz stimmen", () => {
    expect(splitIssues(allocateSplitTax(issueLines, issueAmounts), issueAmounts)).toEqual([]);
  });

  it("meldet abweichendes Netto je Satz mit beiden Beträgen", () => {
    const lines = allocateSplitTax(issueLines.slice(0, 2), issueAmounts);
    expect(splitIssues(lines, issueAmounts)).toEqual(["Aufteilung 19 %: Zeilen zusammen 150,00\u00a0€ netto, Beleg 170,00\u00a0€"]);
  });

  it("meldet einen Satz, den der Beleg nicht hat, und einen Satz ohne Zeilen", () => {
    const lines = allocateSplitTax(
      [
        { category: "software", taxRate: 1900, net: 17_000 },
        { category: "literatur", taxRate: 700, net: 1_000 },
      ],
      [...issueAmounts, { taxRate: 0, net: 500, tax: 0 }],
    );
    expect(splitIssues(lines, [...issueAmounts, { taxRate: 0, net: 500, tax: 0 }])).toEqual([
      "Aufteilung 7 %: Zeilen zusammen 10,00\u00a0€ netto, Beleg 0,00\u00a0€",
      "Aufteilung 0 %: Zeilen zusammen 0,00\u00a0€ netto, Beleg 5,00\u00a0€",
    ]);
  });

  it("meldet eine verteilte Vorsteuer, die nicht zum Beleg passt (gespeichert vor einer Änderung)", () => {
    const stale = allocateSplitTax(issueLines, issueAmounts);
    expect(splitIssues(stale, [{ taxRate: 1900, net: 17_000, tax: 3_200 }])).toEqual([
      "Aufteilung 19 %: Vorsteuer der Zeilen 32,30\u00a0€, Beleg 32,00\u00a0€",
    ]);
  });

  it("verlangt zwei Zeilen, Netto in jeder Zeile, kein Anlagegut und keine gemischten Vorzeichen", () => {
    const amounts = [{ taxRate: 1900, net: 10_000, tax: 1_900 }];
    expect(splitIssues(allocateSplitTax([{ category: "software", taxRate: 1900, net: 10_000 }], amounts), amounts)).toEqual([
      "Eine Aufteilung braucht mindestens zwei Zeilen; für eine Kategorie wähle sie direkt",
    ]);
    const withAsset: DocumentSplitLine[] = [
      { category: "anlage", taxRate: 1900, net: 9_000 },
      { category: "software", taxRate: 1900, net: 1_000 },
      { category: "buero", taxRate: 1900, net: 0 },
    ];
    expect(splitIssues(allocateSplitTax(withAsset, amounts), amounts)).toEqual([
      "Anlagegüter lassen sich nicht aufteilen; erfasse sie als eigenen Beleg",
      "Jede Zeile der Aufteilung braucht einen Nettobetrag",
    ]);
    const mixed: DocumentSplitLine[] = [
      { category: "software", taxRate: 1900, net: 12_000 },
      { category: "buero", taxRate: 1900, net: -2_000 },
    ];
    expect(splitIssues(allocateSplitTax(mixed, amounts), amounts)).toEqual([
      "Aufteilung 19 %: Zeilen mit Plus und Minus gemischt; eine Gutschrift hat nur negative Zeilen",
    ]);
  });

  it("Plus und Minus auch in einem Satz, den der Beleg nicht hat (Zeilen heben sich auf)", () => {
    // +50 € und −50 € zu 7 % ergeben das Netto 0 des fehlenden Satzes; sonst wanderte Aufwand ohne Beleg zwischen Kategorien
    const lines = allocateSplitTax(
      [
        { category: "software", taxRate: 1900, net: 17_000 },
        { category: "literatur", taxRate: 700, net: 5_000 },
        { category: "buero", taxRate: 700, net: -5_000 },
      ],
      issueAmounts,
    );
    expect(splitIssues(lines, issueAmounts)).toEqual(["Aufteilung 7 %: Zeilen mit Plus und Minus gemischt; eine Gutschrift hat nur negative Zeilen"]);
  });
});

describe("documentSplitPosting", () => {
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    const k = KONTEN[kontenrahmen];

    it(`${kontenrahmen}: eine Buchung mit einer Aufwandszeile je Kategorie, Vorsteuer laut Beleg, Verbindlichkeit über alles`, () => {
      const lines = documentSplitPosting(issueTotals, allocateSplitTax(issueLines, issueAmounts), kontenrahmen, "einzelunternehmen", "bank");
      expect(lines).toEqual([
        { account: k.ware, debit: 10_000, credit: 0, taxCode: "VSt19" },
        { account: k.software, debit: 5_000, credit: 0, taxCode: "VSt19" },
        { account: k.buero, debit: 2_000, credit: 0, taxCode: "VSt19" },
        { account: k.vorsteuer19, debit: 3_230, credit: 0, taxCode: "VSt19" },
        { account: k.verbindlichkeiten, debit: 0, credit: 20_230, taxCode: null },
      ]);
      expect(sumOf(lines.map((l) => l.debit))).toBe(sumOf(lines.map((l) => l.credit)));
    });

    it(`${kontenrahmen}: gleiche Kategorie und gleicher Satz werden zusammengefasst, verschiedene Sätze nicht`, () => {
      const split: DocumentSplitLine[] = [
        { category: "software", taxRate: 1900, net: 3_000 },
        { category: "buero", taxRate: 1900, net: 1_000 },
        { category: "software", taxRate: 1900, net: 2_000 },
        { category: "software", taxRate: 700, net: 1_000 },
      ];
      const amounts = [
        { taxRate: 1900, net: 6_000, tax: 1_140 },
        { taxRate: 700, net: 1_000, tax: 70 },
      ];
      const totals = totalsFromTaxes(amounts.map((a) => ({ rate: a.taxRate, base: a.net, tax: a.tax })));
      expect(documentSplitPosting(totals, allocateSplitTax(split, amounts), kontenrahmen, "einzelunternehmen", "privat")).toEqual([
        { account: k.software, debit: 5_000, credit: 0, taxCode: "VSt19" },
        { account: k.buero, debit: 1_000, credit: 0, taxCode: "VSt19" },
        { account: k.software, debit: 1_000, credit: 0, taxCode: "VSt7" },
        { account: k.vorsteuer19, debit: 1_140, credit: 0, taxCode: "VSt19" },
        { account: k.vorsteuer7, debit: 70, credit: 0, taxCode: "VSt7" },
        { account: k.privat, debit: 0, credit: 8_210, taxCode: null },
      ]);
    });

    it(`${kontenrahmen}: Kleinunternehmer: der Steueranteil jeder Zeile gehört zu ihrem Aufwand`, () => {
      const lines = documentSplitPosting(issueTotals, allocateSplitTax(issueLines, issueAmounts), kontenrahmen, "einzelunternehmen", "kasse", false);
      expect(lines).toEqual([
        { account: k.ware, debit: 11_900, credit: 0, taxCode: "keineVSt" },
        { account: k.software, debit: 5_950, credit: 0, taxCode: "keineVSt" },
        { account: k.buero, debit: 2_380, credit: 0, taxCode: "keineVSt" },
        { account: k.kasse, debit: 0, credit: 20_230, taxCode: null },
      ]);
    });

    it(`${kontenrahmen}: Gutschrift dreht die Seiten`, () => {
      const negated = issueLines.map((l) => ({ ...l, net: -l.net }));
      const amounts = [{ taxRate: 1900, net: -17_000, tax: -3_230 }];
      const totals = totalsFromTaxes([{ rate: 1900, base: -17_000, tax: -3_230 }]);
      const lines = documentSplitPosting(totals, allocateSplitTax(negated, amounts), kontenrahmen, "einzelunternehmen", "bank");
      expect(lines.at(-1)).toEqual({ account: k.verbindlichkeiten, debit: 20_230, credit: 0, taxCode: null });
      expect(lines[0]).toEqual({ account: k.ware, debit: 0, credit: 10_000, taxCode: "VSt19" });
    });

    it(`${kontenrahmen}: GmbH, vom Gesellschafter ausgelegt: Gegenkonto Gesellschafter wie ohne Aufteilung`, () => {
      const split = documentSplitPosting(issueTotals, allocateSplitTax(issueLines, issueAmounts), kontenrahmen, "gmbh", "privat");
      const single = documentPosting(issueTotals, "software", kontenrahmen, "gmbh", "privat");
      expect(split.at(-1)).toEqual(single.at(-1));
    });
  }

  it("dieselbe Vorsteuer und Gegenbuchung wie ohne Aufteilung; nur das Aufwandskonto unterscheidet sich", () => {
    const split = documentSplitPosting(issueTotals, allocateSplitTax(issueLines, issueAmounts), "SKR03", "einzelunternehmen", "bank");
    const single = documentPosting(issueTotals, "software", "SKR03", "einzelunternehmen", "bank");
    expect(split.slice(-2)).toEqual(single.slice(-2));
    expect(sumOf(split.slice(0, 3).map((l) => l.debit))).toBe(single[0]!.debit);
  });
});

describe("EÜR mit aufgeteiltem Beleg", () => {
  const splits = allocateSplitTax(issueLines, issueAmounts);
  const amount = (euer: ReturnType<typeof computeEuer>, key: string) => euer.ausgaben.find((l) => l.key === key)?.amount ?? 0;

  it("vollständige Zahlung: jede Kategorie mit ihrem Netto, Vorsteuer laut Beleg", () => {
    const euer = computeEuer(2026, [{ kind: "document", date: "2026-03-10", paid: 20_230, totals: issueTotals, category: "sonstiges", splits }]);
    expect(amount(euer, "ausgabe:wareneinkauf")).toBe(10_000);
    expect(amount(euer, "ausgabe:software")).toBe(5_000);
    expect(amount(euer, "ausgabe:buero")).toBe(2_000);
    expect(amount(euer, "ausgabe:sonstiges")).toBe(0);
    expect(amount(euer, "vorsteuer")).toBe(3_230);
    expect(euer.totalAusgaben).toBe(20_230);
  });

  it("Teilzahlungen: zusammen genau der Beleg, die Vorsteuer je Zahlung wie ohne Aufteilung (keine doppelte Steuer)", () => {
    const first = computeEuer(2026, [{ kind: "document", date: "2026-03-10", paid: 10_000, totals: issueTotals, category: "sonstiges", splits }]);
    const unsplit = computeEuer(2026, [{ kind: "document", date: "2026-03-10", paid: 10_000, totals: issueTotals, category: "sonstiges" }]);
    expect(amount(first, "vorsteuer")).toBe(amount(unsplit, "vorsteuer"));
    expect(amount(first, "vorsteuer")).toBe(paidTaxShares(issueTotals, 10_000)[0]!.tax);
    expect(first.totalAusgaben).toBe(10_000);

    const both = computeEuer(2026, [
      { kind: "document", date: "2026-03-10", paid: 10_000, totals: issueTotals, category: "sonstiges", splits },
      { kind: "document", date: "2026-04-10", paid: 10_230, totals: issueTotals, category: "sonstiges", splits },
    ]);
    expect(both.totalAusgaben).toBe(20_230);
    const categories = amount(both, "ausgabe:wareneinkauf") + amount(both, "ausgabe:software") + amount(both, "ausgabe:buero");
    expect(categories + amount(both, "vorsteuer")).toBe(20_230);
  });

  it("Bewirtung in einer Zeile: nur diese Zeile zu 70 % abziehbar", () => {
    const lines = allocateSplitTax(
      [
        { category: "bewirtung", taxRate: 1900, net: 10_000 },
        { category: "buero", taxRate: 1900, net: 2_000 },
      ],
      [{ taxRate: 1900, net: 12_000, tax: 2_280 }],
    );
    const totals = totalsFromTaxes([{ rate: 1900, base: 12_000, tax: 2_280 }]);
    const euer = computeEuer(2026, [{ kind: "document", date: "2026-05-02", paid: 14_280, totals, category: "sonstiges", splits: lines }]);
    expect(amount(euer, "ausgabe:bewirtung")).toBe(7_000);
    expect(amount(euer, "ausgabe:buero")).toBe(2_000);
    expect(euer.bewirtungNichtAbziehbar).toBe(3_000);
  });

  it("Kleinunternehmer: Steueranteil der Zeile ist Teil ihrer Ausgabe", () => {
    const euer = computeEuer(2026, [
      { kind: "document", date: "2026-03-10", paid: 20_230, totals: issueTotals, category: "sonstiges", vorsteuerAbzug: false, splits },
    ]);
    expect(amount(euer, "ausgabe:wareneinkauf")).toBe(11_900);
    expect(amount(euer, "ausgabe:software")).toBe(5_950);
    expect(amount(euer, "ausgabe:buero")).toBe(2_380);
    expect(amount(euer, "vorsteuer")).toBe(0);
  });

  it("ohne Aufteilung unverändert über die Kategorie", () => {
    const euer = computeEuer(2026, [{ kind: "document", date: "2026-03-10", paid: 20_230, totals: issueTotals, category: "software" }]);
    expect(amount(euer, "ausgabe:software")).toBe(17_000);
    expect(amount(euer, "vorsteuer")).toBe(3_230);
  });
});

describe("documentSplitPosting mit eigenem Konto (#270)", () => {
  const eigenesKonto = { SKR03: "4999", SKR04: "6999" } as const;

  describe.each(["SKR03", "SKR04"] as const)("%s", (kontenrahmen) => {
    const k = KONTEN[kontenrahmen];
    const mitKonto: DocumentSplitLine[] = [
      { category: "wareneinkauf", taxRate: 1900, net: 10_000 },
      { category: "software", taxRate: 1900, net: 5_000, account: eigenesKonto[kontenrahmen] },
      { category: "buero", taxRate: 1900, net: 2_000 },
    ];

    it("bucht die Zeile mit eigenem Konto auf dessen Nummer, die übrigen wie bisher; Beträge und Vorsteuer bleiben", () => {
      const eigen = documentSplitPosting(issueTotals, allocateSplitTax(mitKonto, issueAmounts), kontenrahmen, "einzelunternehmen", "bank");
      const ohne = documentSplitPosting(issueTotals, allocateSplitTax(issueLines, issueAmounts), kontenrahmen, "einzelunternehmen", "bank");
      const betrag = (lines: typeof eigen, account: string) => lines.filter((l) => l.account === account).reduce((s, l) => s + l.debit, 0);
      expect(betrag(eigen, eigenesKonto[kontenrahmen])).toBe(5_000);
      expect(betrag(eigen, k.software)).toBe(0);
      expect(betrag(eigen, k.ware)).toBe(betrag(ohne, k.ware));
      expect(betrag(eigen, k.buero)).toBe(betrag(ohne, k.buero));
      expect(betrag(eigen, k.vorsteuer19)).toBe(betrag(ohne, k.vorsteuer19));
      // dieselbe Summe Soll und Haben wie ohne eigenes Konto
      expect(sumOf(eigen.map((l) => l.debit))).toBe(sumOf(ohne.map((l) => l.debit)));
      expect(sumOf(eigen.map((l) => l.credit))).toBe(sumOf(ohne.map((l) => l.credit)));
    });

    it("zwei Zeilen derselben Kategorie, eine mit und eine ohne eigenes Konto, bleiben getrennte Aufwandszeilen", () => {
      const lines: DocumentSplitLine[] = [
        { category: "software", taxRate: 1900, net: 5_000, account: eigenesKonto[kontenrahmen] },
        { category: "software", taxRate: 1900, net: 3_000 },
      ];
      const amounts = [{ taxRate: 1900, net: 8_000, tax: 1_520 }];
      const result = documentSplitPosting(
        totalsFromTaxes([{ rate: 1900, base: 8_000, tax: 1_520 }]),
        allocateSplitTax(lines, amounts),
        kontenrahmen,
        "einzelunternehmen",
        "bank",
      );
      const gesucht: string[] = [eigenesKonto[kontenrahmen], k.software];
      expect(result.filter((l) => l.debit > 0 && gesucht.includes(l.account)).map((l) => [l.account, l.debit])).toEqual(
        expect.arrayContaining([
          [eigenesKonto[kontenrahmen], 5_000],
          [k.software, 3_000],
        ]),
      );
    });
  });
});
