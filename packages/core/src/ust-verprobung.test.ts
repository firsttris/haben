import { describe, expect, it } from "vitest";
import { totalsFromTaxes } from "./invoice.ts";
import { documentPosting, invoicePaymentPosting, invoicePosting, settlementTaxShares, ACCOUNTS, type Kontenrahmen, type TaxShare } from "./posting.ts";
import { verprobeBuchung } from "./ust-verprobung.ts";

const rechnung = totalsFromTaxes([
  { rate: 1900, base: 100_00, tax: 19_00 },
  { rate: 700, base: 33_33, tax: 2_33 },
]);

describe.each(["SKR03", "SKR04"] as const)("Umsatzsteuer-Verprobung %s", (kr: Kontenrahmen) => {
  it("Rechnung bei Soll, Rechnung und Zahlung bei Ist stimmen", () => {
    expect(verprobeBuchung(kr, "soll", invoicePosting(rechnung, kr, "soll"))).toEqual([]);
    expect(verprobeBuchung(kr, "ist", invoicePosting(rechnung, kr, "ist"))).toEqual([]);
    // Teilzahlung: Anteil je Satz gerundet, innerhalb eines Cents
    expect(verprobeBuchung(kr, "ist", invoicePaymentPosting(rechnung, 50_00, kr, "ist"))).toEqual([]);
  });

  // § 15 Abs. 4 UStG (#926): Abziehbar ist nur der Anteil, der Rest steht mit „keineVSt“ auf dem Aufwand. Fall von
  // thomas-baumeister in #1144: 1.000 € zu 19 % mit 60 % Abzug, Vorsteuer 114 € statt 190 €
  it("Beleg mit anteiligem Vorsteuerabzug (§ 15 Abs. 4 UStG) stimmt, je Zeile und als Firmenvorgabe", () => {
    const beleg = totalsFromTaxes([{ rate: 1900, base: 1_000_00, tax: 190_00, vorsteuerAnteil: 6000 }]);
    expect(verprobeBuchung(kr, "soll", documentPosting(beleg, "buero", kr, "einzelunternehmen", "bank"))).toEqual([]);
    const ohneAnteil = totalsFromTaxes([{ rate: 1900, base: 1_000_00, tax: 190_00 }]);
    expect(verprobeBuchung(kr, "ist", documentPosting(ohneAnteil, "buero", kr, "einzelunternehmen", "bank", 6000))).toEqual([]);
    // Zwei Sätze, einer anteilig, einer voll
    const zwei = totalsFromTaxes([
      { rate: 1900, base: 1_000_00, tax: 190_00, vorsteuerAnteil: 6000 },
      { rate: 700, base: 200_00, tax: 14_00 },
    ]);
    expect(verprobeBuchung(kr, "soll", documentPosting(zwei, "buero", kr, "einzelunternehmen", "bank"))).toEqual([]);
    // Gutschrift dazu: alle Beträge negativ
    const gutschrift = totalsFromTaxes([{ rate: 1900, base: -1_000_00, tax: -190_00, vorsteuerAnteil: 6000 }]);
    expect(verprobeBuchung(kr, "soll", documentPosting(gutschrift, "buero", kr, "einzelunternehmen", "bank"))).toEqual([]);
  });

  it("anteiliger Vorsteuerabzug: mehr Vorsteuer als Bemessungsgrundlage mal Satz fällt weiter auf", () => {
    const beleg = totalsFromTaxes([{ rate: 1900, base: 1_000_00, tax: 190_00, vorsteuerAnteil: 6000 }]);
    const zeilen = documentPosting(beleg, "buero", kr, "einzelunternehmen", "bank").map((z) =>
      z.account === ACCOUNTS[kr].vorsteuer[1900] ? { ...z, debit: 200_00 } : z,
    );
    expect(verprobeBuchung(kr, "soll", zeilen)).toEqual([{ satz: 1900, art: "vorsteuer", bemessung: 1_000_00, steuer: 200_00, erwartet: 190_00 }]);
  });

  it("Teilzahlungen auf eine Rechnung mit zwei Sätzen: der Rundungsrest beider Sätze beim größten, kein Fehlalarm", () => {
    // Die dritte Zahlung bucht 435,68 € Steuer auf 2.292,97 € Bemessungsgrundlage (19 % wären 435,66 €): Der Anteil je Satz
    // wird gerundet, der Rest beider Sätze landet beim größten (paidTaxShares). Über die ganze Rechnung stimmt es auf den Cent.
    const zwei = totalsFromTaxes([
      { rate: 1900, base: 4_696_04, tax: 892_25 },
      { rate: 700, base: 453_48, tax: 31_74 },
    ]);
    let bezahlt = 0;
    const erfasst: TaxShare[] = [];
    for (const zahlung of [43_52, 2_915_99, 2_965_57, 148_43]) {
      const anteile = settlementTaxShares(zwei, bezahlt, erfasst, zahlung);
      expect(verprobeBuchung(kr, "ist", invoicePaymentPosting(zwei, zahlung, kr, "ist", anteile)), String(zahlung)).toEqual([]);
      bezahlt += zahlung;
      erfasst.push(...anteile);
    }
  });

  it("Beleg mit Vorsteuer und mit Privatanteil stimmt", () => {
    const beleg = totalsFromTaxes([{ rate: 1900, base: 1_000_00, tax: 190_00 }]);
    expect(verprobeBuchung(kr, "soll", documentPosting(beleg, "buero", kr, "einzelunternehmen", "bank"))).toEqual([]);
    expect(verprobeBuchung(kr, "ist", documentPosting(beleg, "telefon", kr, "einzelunternehmen", "bank", true, undefined, 33))).toEqual([]);
  });

  it("findet eine Steuer, die nicht zur Bemessungsgrundlage passt", () => {
    const zeilen = invoicePosting(rechnung, kr, "soll").map((z) =>
      z.account === ACCOUNTS[kr].ust[1900] ? { ...z, credit: z.credit + 5 } : z.account === ACCOUNTS[kr].forderungen ? { ...z, debit: z.debit + 5 } : z,
    );
    expect(verprobeBuchung(kr, "soll", zeilen)).toEqual([{ satz: 1900, art: "umsatzsteuer", bemessung: 100_00, steuer: 19_05, erwartet: 19_00 }]);
    const beleg = documentPosting(totalsFromTaxes([{ rate: 700, base: 10_00, tax: 70 }]), "buero", kr, "einzelunternehmen", "bank").map((z) =>
      z.account === ACCOUNTS[kr].vorsteuer[700] ? { ...z, debit: 1_70 } : z,
    );
    expect(verprobeBuchung(kr, "soll", beleg)).toEqual([{ satz: 700, art: "vorsteuer", bemessung: 10_00, steuer: 1_70, erwartet: 70 }]);
  });

  it("ein Cent Rundung je Satz der Buchung ist erlaubt, mehr nicht", () => {
    const um = (totals: typeof rechnung, konto: string, cent: number) =>
      invoicePosting(totals, kr, "soll").map((z) =>
        z.account === konto ? { ...z, credit: z.credit + cent } : z.account === ACCOUNTS[kr].forderungen ? { ...z, debit: z.debit + cent } : z,
      );
    const einSatz = totalsFromTaxes([{ rate: 1900, base: 100_00, tax: 19_00 }]);
    expect(verprobeBuchung(kr, "soll", um(einSatz, ACCOUNTS[kr].ust[1900], 1))).toEqual([]);
    expect(verprobeBuchung(kr, "soll", um(einSatz, ACCOUNTS[kr].ust[1900], 2))).toHaveLength(1);
    // Zwei Sätze: bis zwei Cent, wie der Rundungsrest einer Teilzahlung
    expect(verprobeBuchung(kr, "soll", um(rechnung, ACCOUNTS[kr].ust[700], 2))).toEqual([]);
    expect(verprobeBuchung(kr, "soll", um(rechnung, ACCOUNTS[kr].ust[700], 3))).toHaveLength(1);
  });
});
