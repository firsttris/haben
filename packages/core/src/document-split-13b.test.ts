import { describe, expect, it } from "vitest";
import { allocateSplitTax, documentSplitPosting, type DocumentSplitLine } from "./document-split.ts";
import { totalsFromTaxes } from "./invoice.ts";
import { documentPosting, type PostingLine, type ReverseChargeIn, type SelfAssessedTax } from "./posting.ts";

/*
 * § 13b mit Aufteilung (#508). Erfundene Sammelrechnung eines Zahlungsdienstleisters aus dem EU-Ausland, alles zu 19 %:
 * 120 € Transaktionsgebühren, 60 € Zahlungsabwicklung, 20 € Einstellgebühren, 50 € Werbung = 250 € netto, 47,50 € Steuer
 * nach § 13b, gezahlt werden nur die 250 €. Mit Vorsteuerabzug trägt jede Aufwandszeile ihr Netto und die Steuer steht je
 * Satz einmal als Umsatzsteuer und Vorsteuer; ohne Vorsteuerabzug trägt jede Zeile Netto plus ihren Anteil an der Steuer.
 */

const lines: DocumentSplitLine[] = [
  { category: "geldverkehr", taxRate: 1900, net: 12_000 },
  { category: "fremdleistung", taxRate: 1900, net: 6_000 },
  { category: "sonstiges", taxRate: 1900, net: 2_000 },
  { category: "werbung", taxRate: 1900, net: 5_000 },
];
const amounts = [{ taxRate: 1900, net: 25_000, tax: 4_750 }];
/** § 13b: gezahlt wird nur netto (wie totalsOf in belege/documents.ts) */
const rcTotals = (taxes: { rate: number; base: number; tax: number }[]) => {
  const totals = totalsFromTaxes(taxes);
  return { ...totals, gross: totals.net };
};
const totals = rcTotals([{ rate: 1900, base: 25_000, tax: 4_750 }]);

const KONTEN = {
  SKR03: { geld: "4970", fremd: "3100", sonstiges: "4900", werbung: "4600", ustRc: "1787", vorsteuerRc: "1577", verbindlichkeiten: "1600", privat: "1890" },
  SKR04: { geld: "6855", fremd: "5900", sonstiges: "6300", werbung: "6600", ustRc: "3837", vorsteuerRc: "1407", verbindlichkeiten: "3300", privat: "2180" },
} as const;

const CODE = { eu: "RC13bEU", drittland: "RC13bDrittland" } as const;

const sumOf = (values: number[]) => values.reduce((s, v) => s + v, 0);
/** Saldo je Konto (Soll − Haben) */
const balances = (posting: PostingLine[]) => {
  const result = new Map<string, number>();
  for (const l of posting) result.set(l.account, (result.get(l.account) ?? 0) + l.debit - l.credit);
  return result;
};

describe("documentSplitPosting mit § 13b", () => {
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    const k = KONTEN[kontenrahmen];
    for (const rc of ["eu", "drittland"] as const satisfies readonly ReverseChargeIn[]) {
      const code = CODE[rc];

      it(`${kontenrahmen}, ${rc}: Aufwand je Zeile netto mit ${code}, Umsatzsteuer und Vorsteuer einmal je Satz, Verbindlichkeit netto`, () => {
        expect(documentSplitPosting(totals, allocateSplitTax(lines, amounts), kontenrahmen, "einzelunternehmen", "bank", true, rc)).toEqual([
          { account: k.geld, debit: 12_000, credit: 0, taxCode: code },
          { account: k.fremd, debit: 6_000, credit: 0, taxCode: code },
          { account: k.sonstiges, debit: 2_000, credit: 0, taxCode: code },
          { account: k.werbung, debit: 5_000, credit: 0, taxCode: code },
          { account: k.vorsteuerRc, debit: 4_750, credit: 0, taxCode: "VSt13b" },
          { account: k.ustRc, debit: 0, credit: 4_750, taxCode: code },
          { account: k.verbindlichkeiten, debit: 0, credit: 25_000, taxCode: null },
        ]);
      });

      it(`${kontenrahmen}, ${rc}: ohne Vorsteuerabzug Netto plus Steueranteil je Zeile, keine Vorsteuer, Umsatzsteuer einmal`, () => {
        expect(documentSplitPosting(totals, allocateSplitTax(lines, amounts), kontenrahmen, "einzelunternehmen", "privat", false, rc)).toEqual([
          { account: k.geld, debit: 14_280, credit: 0, taxCode: code },
          { account: k.fremd, debit: 7_140, credit: 0, taxCode: code },
          { account: k.sonstiges, debit: 2_380, credit: 0, taxCode: code },
          { account: k.werbung, debit: 5_950, credit: 0, taxCode: code },
          { account: k.ustRc, debit: 0, credit: 4_750, taxCode: code },
          { account: k.privat, debit: 0, credit: 25_000, taxCode: null },
        ]);
      });

      it(`${kontenrahmen}, ${rc}: dieselben Salden wie ohne Aufteilung, nur das Aufwandskonto unterscheidet sich`, () => {
        for (const vorsteuerAbzug of [true, false]) {
          const split = balances(documentSplitPosting(totals, allocateSplitTax(lines, amounts), kontenrahmen, "einzelunternehmen", "bank", vorsteuerAbzug, rc));
          const single = balances(documentPosting(totals, "sonstiges", kontenrahmen, "einzelunternehmen", "bank", vorsteuerAbzug, undefined, 0, rc));
          for (const account of [k.ustRc, k.vorsteuerRc, k.verbindlichkeiten]) expect(split.get(account) ?? 0).toBe(single.get(account) ?? 0);
          const expense = (b: Map<string, number>) => sumOf([k.geld, k.fremd, k.sonstiges, k.werbung].map((a) => b.get(a) ?? 0));
          expect(expense(split)).toBe(expense(single));
        }
      });

      it(`${kontenrahmen}, ${rc}: Gutschrift dreht die Seiten`, () => {
        const credit = rcTotals([{ rate: 1900, base: -25_000, tax: -4_750 }]);
        const negative = lines.map((l) => ({ ...l, net: -l.net }));
        const posting = documentSplitPosting(
          credit,
          allocateSplitTax(negative, [{ taxRate: 1900, net: -25_000, tax: -4_750 }]),
          kontenrahmen,
          "einzelunternehmen",
          "bank",
          true,
          rc,
        );
        expect(posting).toEqual([
          { account: k.geld, debit: 0, credit: 12_000, taxCode: code },
          { account: k.fremd, debit: 0, credit: 6_000, taxCode: code },
          { account: k.sonstiges, debit: 0, credit: 2_000, taxCode: code },
          { account: k.werbung, debit: 0, credit: 5_000, taxCode: code },
          { account: k.vorsteuerRc, debit: 0, credit: 4_750, taxCode: "VSt13b" },
          { account: k.ustRc, debit: 4_750, credit: 0, taxCode: code },
          { account: k.verbindlichkeiten, debit: 25_000, credit: 0, taxCode: null },
        ]);
      });
    }
  }

  it("19 % und 7 %: Umsatzsteuer und Vorsteuer je Satz genau einmal, nicht je Zeile", () => {
    const mixed: DocumentSplitLine[] = [
      { category: "werbung", taxRate: 1900, net: 3_000 },
      { category: "edv", taxRate: 1900, net: 1_000 },
      { category: "literatur", taxRate: 700, net: 2_000 },
      { category: "fortbildung", taxRate: 700, net: 1_000 },
    ];
    const mixedTotals = rcTotals([
      { rate: 1900, base: 4_000, tax: 760 },
      { rate: 700, base: 3_000, tax: 210 },
    ]);
    const allocated = allocateSplitTax(mixed, [
      { taxRate: 1900, net: 4_000, tax: 760 },
      { taxRate: 700, net: 3_000, tax: 210 },
    ]);
    const posting = documentSplitPosting(mixedTotals, allocated, "SKR03", "einzelunternehmen", "bank", true, "eu");
    expect(posting.filter((l) => l.taxCode === "VSt13b")).toEqual([
      { account: "1577", debit: 760, credit: 0, taxCode: "VSt13b" },
      { account: "1577", debit: 210, credit: 0, taxCode: "VSt13b" },
    ]);
    expect(posting.filter((l) => l.account === "1787")).toEqual([
      { account: "1787", debit: 0, credit: 760, taxCode: "RC13bEU" },
      { account: "1787", debit: 0, credit: 210, taxCode: "RC13bEU" },
    ]);
    expect(posting.at(-1)).toEqual({ account: "1600", debit: 0, credit: 7_000, taxCode: null });
  });

  it("ohne Vorsteuerabzug centgenau: der Rundungsrest der Steuer bleibt im Aufwand, die Summe ist Netto plus Steuer des Belegs", () => {
    const odd: DocumentSplitLine[] = [
      { category: "werbung", taxRate: 1900, net: 3_333 },
      { category: "geldverkehr", taxRate: 1900, net: 3_333 },
      { category: "sonstiges", taxRate: 1900, net: 3_333 },
    ];
    // 99,99 € zu 19 % = 19,00 € (gerundet); je Zeile 6,33 €, der Cent Rest an die erste Zeile
    const oddTotals = rcTotals([{ rate: 1900, base: 9_999, tax: 1_900 }]);
    const posting = documentSplitPosting(
      oddTotals,
      allocateSplitTax(odd, [{ taxRate: 1900, net: 9_999, tax: 1_900 }]),
      "SKR04",
      "einzelunternehmen",
      "bank",
      false,
      "drittland",
    );
    expect(posting.slice(0, 3).map((l) => l.debit)).toEqual([3_967, 3_966, 3_966]);
    expect(sumOf(posting.slice(0, 3).map((l) => l.debit))).toBe(9_999 + 1_900);
    expect(posting.slice(0, 3).map((l) => l.taxCode)).toEqual(["RC13bDrittland", "RC13bDrittland", "RC13bDrittland"]);
    expect(posting.some((l) => l.taxCode === "VSt13b")).toBe(false);
    expect(posting.find((l) => l.account === "3837")).toEqual({ account: "3837", debit: 0, credit: 1_900, taxCode: "RC13bDrittland" });
  });

  it("§ 13b verlangt 19 % oder 7 %; innergemeinschaftlicher Erwerb bleibt ohne Aufteilung", () => {
    const zero = rcTotals([{ rate: 0, base: 1_000, tax: 0 }]);
    const zeroLines = allocateSplitTax(
      [
        { category: "werbung", taxRate: 0, net: 500 },
        { category: "edv", taxRate: 0, net: 500 },
      ],
      [{ taxRate: 0, net: 1_000, tax: 0 }],
    );
    expect(() => documentSplitPosting(zero, zeroLines, "SKR03", "einzelunternehmen", "bank", true, "eu")).toThrow(/§ 13b: Steuersatz muss 19 % oder 7 % sein/);
    const igErwerb = "ig_erwerb" as SelfAssessedTax as ReverseChargeIn;
    expect(() => documentSplitPosting(totals, allocateSplitTax(lines, amounts), "SKR03", "einzelunternehmen", "bank", true, igErwerb)).toThrow(RangeError);
  });
});
