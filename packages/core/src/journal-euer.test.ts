import { describe, expect, it } from "vitest";
import { ASSET_ACCOUNTS } from "./afa.ts";
import { DARLEHEN_ZWECKE, darlehenPosting, type Darlehen } from "./darlehen.ts";
import { kategoriePosting } from "./direkt-kategorie.ts";
import { computeEuer, type EuerDepreciation, type EuerPayment, type EuerResult, type EuerWithdrawals } from "./euer.ts";
import type { InvoiceTotals } from "./invoice.ts";
import { euerAusZeilen, euerZuordnung, type EuerAusJournal, type EuerHerkunft } from "./journal-euer.ts";
import { PAUSCHALE_KONTEN, type PauschaleArt } from "./pauschalen.ts";
import {
  ACCOUNTS,
  directPosting,
  documentPosting,
  exchangeDifferencePosting,
  EXPENSE_CATEGORY_KEYS,
  invoicePosting,
  type Kontenrahmen,
  type PostingLine,
} from "./posting.ts";
import { privateUsePosting } from "./private-use.ts";
import { STEUER_POSTEN_KEYS, STEUERART_KEYS, steuerEuerWirkung, steuerKontierung, steuerzahlungPosting } from "./steuerzahlung.ts";

/*
 * EÜR-Zeilen aus dem Journal (#542, Schritt 5a): Für jede Buchungsart ergibt die Zuordnung der Journalzeilen dieselben
 * Zeilen wie computeEuer für denselben Vorgang, voll bezahlt. Die Buchungssätze kommen aus den Funktionen, mit denen
 * Haben bucht; SKR03 und SKR04.
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

/** Die Zeilen der EÜR ungleich null, dazu die nachrichtlichen Beträge, wie euerAusZeilen sie liefert */
function ausEuer(result: EuerResult): EuerAusJournal {
  const zeilen = Object.fromEntries([...result.einnahmen, ...result.ausgaben].filter((l) => l.amount !== 0).map((l) => [l.key, l.amount]));
  return { zeilen, bewirtungNichtAbziehbar: result.bewirtungNichtAbziehbar, gewerbesteuerNichtAbziehbar: result.gewerbesteuerNichtAbziehbar };
}

const erwartet = (payments: EuerPayment[], depreciation?: EuerDepreciation, withdrawals?: EuerWithdrawals) =>
  ausEuer(computeEuer(JAHR, payments, depreciation, withdrawals));
const ausJournal = (kr: Kontenrahmen, lines: PostingLine[], herkunft?: EuerHerkunft) => euerAusZeilen(kr, lines, herkunft);

describe.each(KONTENRAHMEN)("EÜR-Zeilen aus dem Journal wie computeEuer (%s)", (kr) => {
  describe("Ausgangsrechnungen, voll bezahlt", () => {
    it.each(["soll", "ist"] as const)("19 %, 7 % und 0 % (%s): Einnahmen netto je Art und vereinnahmte Umsatzsteuer", (versteuerung) => {
      const t = totals({ rate: 1900, base: 100_000 }, { rate: 700, base: 50_000 }, { rate: 0, base: 20_000 });
      expect(ausJournal(kr, invoicePosting(t, kr, versteuerung))).toEqual(erwartet([{ kind: "invoice", date: DATUM, paid: t.gross, totals: t }]));
    });

    it.each(["reverse_charge", "drittland", "steuerfrei", "ig_lieferung", "ausfuhr", "kleinunternehmer"] as const)("%s", (treatment) => {
      const t = totals({ rate: 0, base: 500_000 });
      expect(ausJournal(kr, invoicePosting(t, kr, "soll", treatment))).toEqual(
        erwartet([{ kind: "invoice", date: DATUM, paid: t.gross, totals: t, treatment }]),
      );
    });

    it("Gutschrift (negativ) mindert die Einnahmen", () => {
      const t = totals({ rate: 1900, base: -10_000 });
      expect(ausJournal(kr, invoicePosting(t, kr, "soll"))).toEqual(erwartet([{ kind: "invoice", date: DATUM, paid: t.gross, totals: t }]));
    });
  });

  describe("Belege, voll bezahlt", () => {
    const KATEGORIEN = EXPENSE_CATEGORY_KEYS.filter((k) => k !== "anlage" && k !== "einfuhrumsatzsteuer");

    it.each(KATEGORIEN)("%s mit Vorsteuer", (category) => {
      const t = totals({ rate: 1900, base: 10_000 }, { rate: 700, base: 2_000 });
      expect(ausJournal(kr, documentPosting(t, category, kr, "einzelunternehmen", "bank"))).toEqual(
        erwartet([{ kind: "document", date: DATUM, paid: t.gross, totals: t, category }]),
      );
    });

    it.each(KATEGORIEN)("%s ohne Vorsteuerabzug (Kleinunternehmer)", (category) => {
      const t = totals({ rate: 1900, base: 10_000 });
      expect(ausJournal(kr, documentPosting(t, category, kr, "einzelunternehmen", "bank", false))).toEqual(
        erwartet([{ kind: "document", date: DATUM, paid: t.gross, totals: t, category, vorsteuerAbzug: false }]),
      );
    });

    it("Privatanteil: nur der betriebliche Teil ist Ausgabe und Vorsteuer", () => {
      const t = totals({ rate: 1900, base: 5_001 });
      expect(ausJournal(kr, documentPosting(t, "telefon", kr, "einzelunternehmen", "bank", true, undefined, 30))).toEqual(
        erwartet([{ kind: "document", date: DATUM, paid: t.gross, totals: t, category: "telefon", privateShare: 30 }]),
      );
    });

    it.each(["eu", "drittland", "ig_erwerb"] as const)("§ 13b bzw. Erwerb (%s): netto Ausgabe, die selbst geschuldete Steuer wirkt nicht", (rc) => {
      const t = { ...totals({ rate: 1900, base: 20_000 }), gross: 20_000 };
      const category = rc === "ig_erwerb" ? "wareneinkauf" : "software";
      // computeEuer bekommt Belege mit selbst geschuldeter Steuer ohne Steuer (reports.ts, documentTotalsById)
      const ohneSteuer = { ...t, tax: 0, taxes: t.taxes.map((r) => ({ ...r, tax: 0 })) };
      expect(ausJournal(kr, documentPosting(t, category, kr, "einzelunternehmen", "bank", true, undefined, 25, rc))).toEqual(
        erwartet([{ kind: "document", date: DATUM, paid: ohneSteuer.gross, totals: ohneSteuer, category, privateShare: 25 }]),
      );
    });

    it("Einfuhrumsatzsteuer ist Vorsteuer", () => {
      const t = totals({ rate: 0, base: 1_900 });
      expect(ausJournal(kr, documentPosting(t, "einfuhrumsatzsteuer", kr, "einzelunternehmen", "bank"))).toEqual(
        erwartet([{ kind: "document", date: DATUM, paid: t.gross, totals: t, category: "einfuhrumsatzsteuer" }]),
      );
    });

    it("Anlagegut: nur die Vorsteuer, die Anschaffung wirkt über die AfA", () => {
      const t = totals({ rate: 1900, base: 150_000 });
      const lines = documentPosting(t, "anlage", kr, "einzelunternehmen", "bank", true, ASSET_ACCOUNTS[kr].anlage.edv);
      expect(ausJournal(kr, lines)).toEqual(erwartet([{ kind: "document", date: DATUM, paid: t.gross, totals: t, category: "anlage" }]));
    });

    it("Bewirtung: 70 % abziehbar, 30 % nachrichtlich", () => {
      const t = totals({ rate: 1900, base: 10_001 });
      expect(ausJournal(kr, documentPosting(t, "bewirtung", kr, "einzelunternehmen", "bank"))).toEqual(
        erwartet([{ kind: "document", date: DATUM, paid: t.gross, totals: t, category: "bewirtung" }]),
      );
    });
  });

  describe("Buchungen direkt über die Bank", () => {
    it.each([
      ["erloese", 1900, 11_900],
      ["erloese", 0, 5_000],
      ["software", 0, -11_900],
      ["telefon", 0, -2_000],
    ] as const)("Direktbuchung %s %i (%i)", (kategorie, steuersatz, amount) => {
      expect(ausJournal(kr, kategoriePosting({ kategorie, steuersatz }, amount, kr))).toEqual(
        erwartet([{ kind: "kategorie", date: DATUM, amount, kategorie, steuersatz }]),
      );
    });

    it.each([
      ["gebuehren", -1_234],
      ["mahnerloes", 500],
      ["zinsertrag", 321],
      ["ustVorauszahlung", -123_456],
      ["ustVorauszahlung", 50_000],
      ["sondervorauszahlung", -10_000],
    ] as const)("%s (%i)", (kind, amount) => {
      expect(ausJournal(kr, directPosting(kind, amount, kr, "einzelunternehmen"))).toEqual(erwartet([{ kind, date: DATUM, amount }]));
    });

    it.each(["lohn", "lohnsteuer", "sozialversicherung"] as const)("Zahlung aus der Lohnabrechnung (%s) ist Personal", (kind) => {
      expect(ausJournal(kr, directPosting(kind, -100_000, kr, "einzelunternehmen"))).toEqual(erwartet([{ kind: "lohn", date: DATUM, amount: -100_000 }]));
    });

    it("Kursdifferenz: Aufwand und Ertrag", () => {
      const t = totals({ rate: 0, base: 100_000 });
      const verlust = exchangeDifferencePosting({ kind: "invoice", totals: t, versteuerung: "soll", treatment: "ausfuhr" }, 1_234, kr);
      expect(ausJournal(kr, verlust)).toEqual(erwartet([{ kind: "kursdifferenz", date: DATUM, amount: -1_234 }]));
      const gewinn = exchangeDifferencePosting({ kind: "invoice", totals: t, versteuerung: "soll", treatment: "ausfuhr" }, -567, kr);
      expect(ausJournal(kr, gewinn)).toEqual(erwartet([{ kind: "kursdifferenz", date: DATUM, amount: 567 }]));
    });
  });

  describe("Steuerzahlungen, je Steuerart und Teil (Einzelunternehmen)", () => {
    for (const art of STEUERART_KEYS) {
      for (const posten of STEUER_POSTEN_KEYS) {
        for (const amount of [-10_000, 10_000]) {
          const kontierung = steuerKontierung({ art, jahr: 2025, posten }, amount, DATUM, kr, "einzelunternehmen");
          if (!kontierung.ok) continue;
          it(`${art} · ${posten} (${amount})`, () => {
            const lines = steuerzahlungPosting(kontierung, amount, 0, kr);
            expect(ausJournal(kr, lines)).toEqual(erwartet([{ kind: "steuer", date: DATUM, amount, art, posten }]));
            // Gegenprobe: die Wirkung aus dem Konto stimmt mit steuerEuerWirkung überein
            const zuordnung = euerZuordnung(kr, kontierung.konto);
            const wirkung = steuerEuerWirkung(art, posten, amount);
            if (wirkung === "privat") expect(zuordnung).toBeNull();
            if (wirkung === "umsatzsteuer") expect(zuordnung).toBe("ustZahlung");
            if (wirkung === "nichtAbziehbar") expect(zuordnung).toBe("nichtAbziehbar");
          });
        }
      }
    }
  });

  describe("Darlehen", () => {
    for (const zweck of Object.keys(DARLEHEN_ZWECKE) as (keyof typeof DARLEHEN_ZWECKE)[]) {
      const darlehen: Darlehen = { geber: "bank", laufzeit: "bis1", zweck };
      it(`Zinsen (${zweck}), Auszahlung und Tilgung`, () => {
        for (const teil of ["auszahlung", "tilgung", "zins"] as const) {
          const amount = teil === "auszahlung" ? 1_000_000 : -10_000;
          expect(ausJournal(kr, darlehenPosting(darlehen, teil, amount, kr)), teil).toEqual(erwartet([{ kind: "darlehen", date: DATUM, amount, zweck, teil }]));
        }
      });
    }
  });

  describe("Ohne Zahlung: Pauschalen, Privatnutzung, AfA", () => {
    it.each(Object.keys(PAUSCHALE_KONTEN) as PauschaleArt[])("Pauschale %s (Herkunft Pauschale)", (art) => {
      const lines: PostingLine[] = [
        { account: PAUSCHALE_KONTEN[art][kr].konto, debit: 4_560, credit: 0, taxCode: null },
        { account: ACCOUNTS[kr].privateinlagen, debit: 0, credit: 4_560, taxCode: null },
      ];
      expect(ausJournal(kr, lines, "pauschale")).toEqual(erwartet([{ kind: "pauschale", date: DATUM, amount: 4_560, art }]));
    });

    it("Privatnutzung eines Firmenwagens mit Umsatzsteuer (Herkunft Anlage)", () => {
      const lines = privateUsePosting({ withdrawal: 50_000, vatBase: 40_000, vat: 7_600 }, kr);
      expect(ausJournal(kr, lines, "asset")).toEqual(erwartet([], undefined, { privateKfz: 50_000, ustEntnahmen: 7_600 }));
    });

    it("AfA, GWG, Sammelposten und Restbuchwert", () => {
      const a = ASSET_ACCOUNTS[kr];
      const lines: PostingLine[] = [
        { account: a.afa, debit: 30_000, credit: 0, taxCode: null },
        { account: a.afaKfz, debit: 20_000, credit: 0, taxCode: null },
        { account: a.afaGwg, debit: 700, credit: 0, taxCode: null },
        { account: a.afaSammelposten, debit: 400, credit: 0, taxCode: null },
        { account: a.restbuchwert, debit: 1_000, credit: 0, taxCode: null },
        { account: a.anlage.edv, debit: 0, credit: 52_100, taxCode: null },
      ];
      expect(ausJournal(kr, lines, "asset")).toEqual(erwartet([], { afa: 50_000, gwg: 700, sammelposten: 400, restbuchwert: 1_000 }));
    });
  });

  it("Konten ohne Wirkung: Bank, Kasse, Forderungen, Verbindlichkeiten, Privat, § 13b, Erwerb, nicht fällige Steuer bleibt", () => {
    const a = ACCOUNTS[kr];
    for (const account of [a.bank, a.kasse, a.forderungen, a.verbindlichkeiten, a.privatentnahmen, a.privateinlagen, a.ustRc, a.vorsteuerRc])
      expect(euerZuordnung(kr, account), account).toBeNull();
    for (const account of [...Object.values(a.ustIge), ...Object.values(a.vorsteuerIge)]) expect(euerZuordnung(kr, account), account).toBeNull();
  });
});
