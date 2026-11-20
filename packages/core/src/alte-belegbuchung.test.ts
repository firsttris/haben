import { describe, expect, it } from "vitest";
import { mitBemessungWieHeute, privatJeErwerbssatz } from "./alte-belegbuchung.ts";
import { documentSplitPosting } from "./document-split.ts";
import type { InvoiceTotals } from "./invoice.ts";
import { kennzahlenAusJournal, type JournalKennzahlen, type JournalZeile } from "./journal-kennzahlen.ts";
import { ACCOUNTS, documentPosting, type Kontenrahmen, type PostingLine, type SelfAssessedTax } from "./posting.ts";
import { verprobeBuchung } from "./ust-verprobung.ts";

/*
 * Belegbuchungen mit § 13b oder Erwerb von vor #551 (#1396): Die Zeilen von heute kommen aus documentPosting bzw.
 * documentSplitPosting; `wieVor551` fasst sie so zusammen, wie Haben bis v0.6 buchte (git show 0c2bab5e): die Steuer ohne
 * Abzug in die Aufwandszeile mit dem Steuerschlüssel, das private Netto zur privaten Steuer ohne Steuerschlüssel. Salden je
 * Konto bleiben gleich. Aus beiden Formen müssen dieselben Kennzahlen herauskommen.
 */

function totals(...taxes: { rate: 1900 | 700; base: number }[]): InvoiceTotals {
  const rows = taxes.map(({ rate, base }) => ({ rate, base, tax: Math.round((base * rate) / 10_000) }));
  const net = rows.reduce((s, r) => s + r.base, 0);
  return { net, tax: rows.reduce((s, r) => s + r.tax, 0), gross: net, taxes: rows };
}

/** Saldo Soll − Haben je Konto */
function salden(zeilen: readonly PostingLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const z of zeilen) m.set(z.account, (m.get(z.account) ?? 0) + z.debit - z.credit);
  return m;
}

const alsZeile = (account: string, saldo: number, taxCode: PostingLine["taxCode"]): PostingLine => ({
  account,
  debit: Math.max(saldo, 0),
  credit: Math.max(-saldo, 0),
  taxCode,
});

const SELBST_GESCHULDET: readonly string[] = ["RC13bEU", "RC13bDrittland", "IGE19", "IGE7"];

/**
 * Die Zeilen so, wie Haben sie vor #551 buchte: Die Steuer ohne Abzug („keineVSt“) kommt in die Zeile mit dem Steuerschlüssel
 * davor auf demselben Konto (documentPosting und documentSplitPosting buchen sie direkt danach), das private Netto zur
 * privaten Steuer ohne Steuerschlüssel.
 */
function wieVor551(kr: Kontenrahmen, zeilen: readonly PostingLine[]): PostingLine[] {
  const privatentnahmen = ACCOUNTS[kr].privatentnahmen;
  const result: PostingLine[] = [];
  let privat = 0;
  for (const z of zeilen) {
    if (z.account === privatentnahmen) {
      privat += z.debit - z.credit;
      continue;
    }
    const davor = result.at(-1);
    if (z.taxCode === "keineVSt" && davor?.account === z.account && davor.taxCode && SELBST_GESCHULDET.includes(davor.taxCode))
      result[result.length - 1] = alsZeile(z.account, davor.debit - davor.credit + z.debit - z.credit, davor.taxCode);
    else result.push(z);
  }
  if (privat !== 0) result.push(alsZeile(privatentnahmen, privat, null));
  return result;
}

/** Erwerb ohne Vorsteuerabzug je Satz: Netto + Steuer in einer Zeile mit dem Schlüssel des Satzes, wie vor #551 */
function erwerbOhneAbzugVor551(kr: Kontenrahmen, t: InvoiceTotals, konto: string): PostingLine[] {
  const a = ACCOUNTS[kr];
  return [
    ...t.taxes.map((r) => alsZeile(konto, r.base + r.tax, r.rate === 1900 ? "IGE19" : "IGE7")),
    ...t.taxes.map((r) => alsZeile(a.ustIge[r.rate === 1900 ? 1900 : 700], -r.tax, r.rate === 1900 ? "IGE19" : "IGE7")),
    alsZeile(a.verbindlichkeiten, -t.gross, null),
  ];
}

const ohneNull = (k: JournalKennzahlen) => Object.fromEntries(Object.entries(k).filter(([, v]) => v !== 0));
const kennzahlen = (kr: Kontenrahmen, zeilen: readonly JournalZeile[]) => ohneNull(kennzahlenAusJournal(kr, "soll", [mitBemessungWieHeute(kr, zeilen)]));
const negiert = (zeilen: readonly PostingLine[]) => zeilen.map((z) => ({ ...z, debit: z.credit, credit: z.debit }));

describe.each(["SKR03", "SKR04"] as const)("Belegbuchung von vor #551 mit der Bemessungsgrundlage wie heute (%s)", (kr) => {
  const rc = (t: InvoiceTotals, vorsteuerAbzug: boolean, privateShare: number, art: SelfAssessedTax) =>
    documentPosting(t, art === "ig_erwerb" ? "wareneinkauf" : "software", kr, "einzelunternehmen", "privat", vorsteuerAbzug, undefined, privateShare, art);

  it("§ 13b EU ohne Vorsteuerabzug (Fall aus #1396): Kz 46 ist das Netto, nicht Netto plus Steuer", () => {
    const heute = rc(totals({ rate: 1900, base: 10_000 }), false, 0, "eu");
    const alt = wieVor551(kr, heute);
    expect(salden(alt)).toEqual(salden(heute));
    expect(alt.filter((z) => z.taxCode === "RC13bEU" && z.debit > 0)).toEqual([alsZeile(heute[0]!.account, 11_900, "RC13bEU")]);
    expect(ohneNull(kennzahlenAusJournal(kr, "soll", [alt]))).toEqual({ kz46: 11_900, kz47: 1_900 });
    expect(kennzahlen(kr, alt)).toEqual({ kz46: 10_000, kz47: 1_900 });
  });

  it.each([
    ["eu", 0, false],
    ["drittland", 0, false],
    ["eu", 25, true],
    ["drittland", 40, true],
    ["eu", 30, false],
    ["ig_erwerb", 30, true],
    ["ig_erwerb", 0, false],
  ] as const)("%s, Privatanteil %i Prozent, Vorsteuerabzug %s: alte und heutige Buchung ergeben dieselben Kennzahlen", (art, anteil, abzug) => {
    const heute = rc(totals({ rate: 1900, base: 20_000 }), abzug, anteil, art);
    const alt = wieVor551(kr, heute);
    expect(salden(alt)).toEqual(salden(heute));
    expect(alt).not.toEqual(heute);
    expect(kennzahlen(kr, alt)).toEqual(kennzahlen(kr, heute));
    // Storno mit den gebuchten Zeilen (cancellation.ts, wenn zeilenWieHeute nicht passt)
    expect(kennzahlen(kr, negiert(alt))).toEqual(kennzahlen(kr, negiert(heute)));
  });

  it("Erwerb zu 19 % und 7 % ohne Vorsteuerabzug: Kz 89 und 93 je Satz netto, die Verprobung stimmt", () => {
    const t = totals({ rate: 1900, base: 10_000 }, { rate: 700, base: 5_000 });
    const konto = documentPosting(t, "wareneinkauf", kr, "einzelunternehmen", "bank", false, undefined, 0, "ig_erwerb")[0]!.account;
    const alt = erwerbOhneAbzugVor551(kr, t, konto);
    expect(kennzahlen(kr, alt)).toEqual({ kz89: 10_000, tax89: 1_900, kz93: 5_000, tax93: 350 });
    expect(verprobeBuchung(kr, "soll", alt)).not.toEqual([]);
    expect(verprobeBuchung(kr, "soll", mitBemessungWieHeute(kr, alt))).toEqual([]);
  });

  it.each([true, false])("Erwerb zu 19 %% und 7 %% mit Privatanteil, Vorsteuerabzug %s: bleibt, wie gebucht", (abzug) => {
    // Der Privatanteil lässt sich aus dem Journal nicht centgenau auf die Sätze aufteilen; dann auch die Steuer nicht abziehen
    const t = totals({ rate: 1900, base: 10_000 }, { rate: 700, base: 5_000 });
    const heute = documentPosting(t, "wareneinkauf", kr, "einzelunternehmen", "privat", abzug, undefined, 30, "ig_erwerb");
    const alt = wieVor551(kr, heute);
    expect(salden(alt)).toEqual(salden(heute));
    expect(alt.filter((z) => z.taxCode === "keineVSt")).toEqual([]);
    expect(mitBemessungWieHeute(kr, alt)).toEqual(alt);
  });

  it.each([
    [true, 30],
    [false, 30],
    [true, 10],
    [false, 33],
  ])(
    "Erwerb zu 19 %% und 7 %% mit Privatanteil, Vorsteuerabzug %s, %i Prozent: mit der Aufteilung aus dem Beleg wie heute, auch storniert",
    (abzug, anteil) => {
      // Gerade Beträge und solche mit Rundung je Satz (splitPrivateShare)
      const t = totals({ rate: 1900, base: 10_001 }, { rate: 700, base: 4_999 });
      const heute = documentPosting(t, "wareneinkauf", kr, "einzelunternehmen", "privat", abzug, undefined, anteil, "ig_erwerb");
      const alt = wieVor551(kr, heute);
      const privat = privatJeErwerbssatz(
        t.taxes.map((r) => ({ taxRate: r.rate, net: r.base, tax: r.tax })),
        anteil,
      );
      expect(kennzahlen(kr, mitBemessungWieHeute(kr, alt, privat))).toEqual(kennzahlen(kr, heute));
      expect(kennzahlen(kr, mitBemessungWieHeute(kr, alt, privat))).toMatchObject({ kz89: 10_001, kz93: 4_999 });
      expect(verprobeBuchung(kr, "soll", mitBemessungWieHeute(kr, alt, privat))).toEqual([]);
      expect(kennzahlen(kr, mitBemessungWieHeute(kr, negiert(alt), privat))).toEqual(kennzahlen(kr, negiert(heute)));
    },
  );

  it("Erwerb zu 19 % und 7 % mit Privatanteil: passt die Aufteilung aus dem Beleg nicht zum gebuchten privaten Teil, bleibt er, wie gebucht", () => {
    const t = totals({ rate: 1900, base: 10_000 }, { rate: 700, base: 5_000 });
    const alt = wieVor551(kr, documentPosting(t, "wareneinkauf", kr, "einzelunternehmen", "privat", true, undefined, 30, "ig_erwerb"));
    const privat = privatJeErwerbssatz(
      t.taxes.map((r) => ({ taxRate: r.rate, net: r.base, tax: r.tax })),
      20,
    );
    expect(mitBemessungWieHeute(kr, alt, privat)).toEqual(alt);
  });

  it("Aufgeteilter Beleg mit § 13b ohne Vorsteuerabzug auf zwei Konten: Kz 46 ist die Summe der Netto", () => {
    const t = totals({ rate: 1900, base: 30_000 });
    const lines = [
      { category: "software" as const, taxRate: 1900 as const, net: 10_000, tax: 1_900 },
      { category: "edv" as const, taxRate: 1900 as const, net: 20_000, tax: 3_800 },
    ];
    const heute = documentSplitPosting(t, lines, kr, "einzelunternehmen", "bank", false, "eu");
    const alt = wieVor551(kr, heute);
    expect(alt.filter((z) => z.taxCode === "RC13bEU" && z.debit > 0)).toHaveLength(2);
    expect(kennzahlen(kr, alt)).toEqual({ kz46: 30_000, kz47: 5_700 });
  });

  it.each([
    ["eu", 0, false],
    ["eu", 0, true],
    ["drittland", 25, true],
    ["eu", 30, false],
    ["ig_erwerb", 0, false],
    ["ig_erwerb", 30, true],
  ] as const)("heutige Buchung (%s, Privatanteil %i Prozent, Vorsteuerabzug %s) bleibt unverändert", (art, anteil, abzug) => {
    const heute = rc(totals({ rate: 1900, base: 20_000 }), abzug, anteil, art);
    expect(mitBemessungWieHeute(kr, heute)).toEqual(heute);
  });

  it("Beleg ohne § 13b und Erwerb bleibt unverändert", () => {
    const t = { ...totals({ rate: 1900, base: 10_000 }), gross: 11_900 };
    const zeilen = documentPosting(t, "software", kr, "einzelunternehmen", "privat", false, undefined, 50);
    expect(mitBemessungWieHeute(kr, zeilen)).toEqual(zeilen);
  });
});
