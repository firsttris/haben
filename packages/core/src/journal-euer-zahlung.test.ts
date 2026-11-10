import { describe, expect, it } from "vitest";
import { ASSET_ACCOUNTS } from "./afa.ts";
import { darlehenPosting } from "./darlehen.ts";
import { computeEuer, type EuerPayment } from "./euer.ts";
import type { InvoiceTotals } from "./invoice.ts";
import { euerAusZeilen, euerZuordnung, leereEuerAusJournal, zahlungsAnteil, type EuerAusJournal } from "./journal-euer.ts";
import { ACCOUNTS, documentPosting, invoicePosting, settlementTaxShares, type Kontenrahmen, type PostingLine, type TaxShare } from "./posting.ts";

/*
 * EÜR aus dem Journal (#542, Schritt 5b): Eine Zahlung wird anteilig auf die Zeilen der Rechnung bzw. des Belegs verteilt,
 * die sie ausgleicht. Das Ergebnis ist dasselbe wie computeEuer mit den Anteilen der Nebenbücher, auch bei Teilzahlungen
 * auf mehrere Steuersätze; SKR03 und SKR04.
 */

const KONTENRAHMEN: Kontenrahmen[] = ["SKR03", "SKR04"];
const JAHR = 2026;
const DATUM = "2026-05-15";

function totals(...taxes: { rate: 1900 | 700 | 0; base: number }[]): InvoiceTotals {
  const rows = taxes.map(({ rate, base }) => ({ rate, base, tax: Math.round((base * rate) / 10_000) }));
  const net = rows.reduce((s, r) => s + r.base, 0);
  const tax = rows.reduce((s, r) => s + r.tax, 0);
  return { net, tax, gross: net + tax, taxes: rows };
}

function ausEuer(payments: EuerPayment[]): EuerAusJournal {
  const result = computeEuer(JAHR, payments);
  const zeilen = Object.fromEntries([...result.einnahmen, ...result.ausgaben].filter((l) => l.amount !== 0).map((l) => [l.key, l.amount]));
  return { zeilen, bewirtungNichtAbziehbar: result.bewirtungNichtAbziehbar, gewerbesteuerNichtAbziehbar: result.gewerbesteuerNichtAbziehbar };
}

/** Zeilen ohne offenen Posten und der offene Posten (Soll − Haben) einer Buchung */
function teile(kr: Kontenrahmen, lines: PostingLine[]) {
  const offen = (l: PostingLine) => l.account === ACCOUNTS[kr].forderungen || l.account === ACCOUNTS[kr].verbindlichkeiten;
  return { zeilen: lines.filter((l) => !offen(l)), gesamt: lines.filter(offen).reduce((s, l) => s + l.debit - l.credit, 0) };
}

/** Zahlungen nacheinander verteilt, wie die Schattenrechnung sie zählt */
function verteilt(kr: Kontenrahmen, lines: PostingLine[], betraege: number[], kumuliert: boolean): EuerAusJournal {
  const { zeilen, gesamt } = teile(kr, lines);
  const summe = leereEuerAusJournal();
  let bisher = 0;
  for (const betrag of betraege) {
    euerAusZeilen(kr, zahlungsAnteil(kr, zeilen, gesamt, betrag, kumuliert ? bisher : 0), "sonst", summe);
    bisher += betrag;
  }
  return summe;
}

describe.each(KONTENRAHMEN)("Zahlung anteilig auf die ausgeglichene Buchung (%s)", (kr) => {
  describe("Rechnungen: Teilzahlungen wie settlementTaxShares", () => {
    const faelle: [string, InvoiceTotals, number[]][] = [
      ["3 × 39,67 € auf 119 €", totals({ rate: 1900, base: 10_000 }), [3_967, 3_967, 3_966]],
      [
        "19 %, 7 % und 0 % in drei ungleichen Raten",
        totals({ rate: 1900, base: 33_333 }, { rate: 700, base: 12_345 }, { rate: 0, base: 999 }),
        [10_001, 20_003],
      ],
      ["Zahlung, aufgehoben, erneut gezahlt", totals({ rate: 1900, base: 10_001 }, { rate: 700, base: 4_999 }), [5_000, -5_000, 5_000, 7_212]],
    ];
    for (const versteuerung of ["soll", "ist"] as const) {
      it.each(faelle)(`%s (${versteuerung})`, (_name, t, raten) => {
        const betraege = [...raten, t.gross - raten.reduce((s, r) => s + r, 0)];
        const payments: EuerPayment[] = [];
        let bisher = 0;
        let erfasst: TaxShare[] = [];
        for (const betrag of betraege) {
          const shares = settlementTaxShares(t, bisher, erfasst, betrag);
          payments.push({ kind: "invoice", date: DATUM, paid: betrag, totals: t, shares });
          bisher += betrag;
          erfasst = [...erfasst, ...shares];
        }
        expect(verteilt(kr, invoicePosting(t, kr, versteuerung), betraege, true)).toEqual(ausEuer(payments));
      });
    }

    it("alle Zahlungen zusammen ergeben genau die Zeilen der Rechnung", () => {
      const t = totals({ rate: 1900, base: 33_333 }, { rate: 700, base: 12_345 });
      const { zeilen, gesamt } = teile(kr, invoicePosting(t, kr, "soll"));
      const raten = [1_111, 2_222, 3_333, gesamt - 6_666];
      let bisher = 0;
      const summe = zeilen.map(() => 0);
      for (const r of raten) {
        zahlungsAnteil(kr, zeilen, gesamt, r, bisher).forEach((z, i) => {
          summe[i]! += z.debit - z.credit;
        });
        bisher += r;
      }
      expect(summe).toEqual(zeilen.map((z) => z.debit - z.credit));
    });
  });

  describe("Belege: jede Zahlung für sich wie paidTaxShares", () => {
    it("Teilzahlung auf 19 % und 7 %", () => {
      const t = totals({ rate: 1900, base: 10_001 }, { rate: 700, base: 3_333 });
      const lines = documentPosting(t, "buero", kr, "einzelunternehmen", "bank");
      expect(verteilt(kr, lines, [-5_000], false)).toEqual(ausEuer([{ kind: "document", date: DATUM, paid: 5_000, totals: t, category: "buero" }]));
    });

    it("Teilzahlung mit Privatanteil", () => {
      const t = totals({ rate: 1900, base: 5_001 });
      const lines = documentPosting(t, "telefon", kr, "einzelunternehmen", "bank", true, undefined, 30);
      expect(verteilt(kr, lines, [-3_000], false)).toEqual(
        ausEuer([{ kind: "document", date: DATUM, paid: 3_000, totals: t, category: "telefon", privateShare: 30 }]),
      );
    });

    it("§ 13b, voll bezahlt: netto Ausgabe, die selbst geschuldete Steuer wirkt nicht", () => {
      const t = { ...totals({ rate: 1900, base: 20_000 }), gross: 20_000 };
      const ohneSteuer = { ...t, tax: 0, taxes: t.taxes.map((r) => ({ ...r, tax: 0 })) };
      const lines = documentPosting(t, "software", kr, "einzelunternehmen", "bank", true, undefined, 0, "eu");
      expect(verteilt(kr, lines, [-20_000], false)).toEqual(
        ausEuer([{ kind: "document", date: DATUM, paid: 20_000, totals: ohneSteuer, category: "software" }]),
      );
    });

    it("ohne offenen Posten nichts zu verteilen", () => {
      expect(zahlungsAnteil(kr, [], 0, 1_000)).toEqual([]);
    });
  });

  describe("Herkunft", () => {
    it("Anlage als GWG über den Beleg: das GWG-Konto ist Anlagevermögen, nur die Vorsteuer wirkt", () => {
      const t = totals({ rate: 1900, base: 70_000 });
      const lines = documentPosting(t, "anlage", kr, "einzelunternehmen", "bank", true, ASSET_ACCOUNTS[kr].gwg);
      const { zeilen, gesamt } = teile(kr, lines);
      expect(euerAusZeilen(kr, zahlungsAnteil(kr, zeilen, gesamt, gesamt), "anlage")).toEqual(
        ausEuer([{ kind: "document", date: DATUM, paid: t.gross, totals: t, category: "anlage" }]),
      );
      // Ein Beleg der Kategorie Hardware auf demselben Konto ist Ausgabe
      expect(euerZuordnung(kr, ASSET_ACCOUNTS[kr].gwg)).toBe("ausgabe:hardware");
    });

    it("Gebühren eines Darlehens nach dem Zweck", () => {
      for (const zweck of ["anlagevermoegen", "betrieb"] as const) {
        const lines = darlehenPosting({ geber: "bank", laufzeit: "bis1", zweck }, "gebuehr", -5_000, kr);
        const herkunft = zweck === "anlagevermoegen" ? "darlehenAnlagevermoegen" : "sonst";
        expect(euerAusZeilen(kr, lines, herkunft), zweck).toEqual(ausEuer([{ kind: "darlehen", date: DATUM, amount: -5_000, zweck, teil: "gebuehr" }]));
      }
    });
  });
});
