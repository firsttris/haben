import { describe, expect, it } from "vitest";
import { zahlungMitBemessungWieHeute } from "./alte-zahlung.ts";
import type { InvoiceTotals } from "./invoice.ts";
import { kennzahlenAusJournal, type JournalZeile } from "./journal-kennzahlen.ts";
import { ACCOUNTS, invoiceCashPaymentPosting, invoicePaymentPosting, paymentProviderAccount, type Kontenrahmen, type PostingLine } from "./posting.ts";
import { verprobeBuchung } from "./ust-verprobung.ts";

/*
 * Zahlungen auf Ausgangsrechnungen bei Ist aus Versionen vor #552 (bis v0.6, #1502): Die Umbuchung der Umsatzsteuer stand
 * schon da, die Bemessungsgrundlage (`basis`) und der Steuerschlüssel des Anteils zu 0 % an der Forderung noch nicht.
 * `wieVor552` macht aus den heutigen Zeilen die damaligen. Die Salden je Konto sind dieselben.
 */

function totals(...taxes: { rate: 1900 | 700 | 0; base: number }[]): InvoiceTotals {
  const rows = taxes.map(({ rate, base }) => ({ rate, base, tax: Math.round((base * rate) / 10_000) }));
  const net = rows.reduce((s, r) => s + r.base, 0);
  const tax = rows.reduce((s, r) => s + r.tax, 0);
  return { net, tax, gross: net + tax, taxes: rows };
}

/** So buchte Haben eine Zahlung bei Ist vor #552: ohne Bemessungsgrundlage, die Forderung ohne Steuerschlüssel */
function wieVor552(kontenrahmen: Kontenrahmen, heute: readonly PostingLine[]): JournalZeile[] {
  const { forderungen } = ACCOUNTS[kontenrahmen];
  return heute.filter((z) => z.debit !== 0 || z.credit !== 0).map(({ basis: _basis, ...z }) => (z.account === forderungen ? { ...z, taxCode: null } : z));
}

const ohneGeld = (kr: Kontenrahmen, zeilen: readonly JournalZeile[]) => {
  const { bank, kasse } = ACCOUNTS[kr];
  return zeilen.filter((z) => z.account !== bank && z.account !== kasse && !/^1[34]6\d$/.test(z.account));
};

describe("zahlungMitBemessungWieHeute", () => {
  for (const kr of ["SKR03", "SKR04"] as const) {
    const rechnung = totals({ rate: 1900, base: 100_000 }, { rate: 700, base: 10_000 }, { rate: 0, base: 5_000 });

    it(`Zahlung vor #552: meldet mit den Zeilen von heute dieselben Kennzahlen, die Verprobung findet nichts (${kr})`, () => {
      const heute = invoicePaymentPosting(rechnung, rechnung.gross, kr, "ist");
      const alt = wieVor552(kr, heute);
      expect(kennzahlenAusJournal(kr, "ist", [alt]).kz81).toBe(0);
      expect(verprobeBuchung(kr, "ist", alt)).not.toEqual([]);
      const gedeutet = zahlungMitBemessungWieHeute(kr, alt, heute);
      expect(kennzahlenAusJournal(kr, "ist", [gedeutet])).toEqual(kennzahlenAusJournal(kr, "ist", [heute]));
      expect(kennzahlenAusJournal(kr, "ist", [gedeutet])).toMatchObject({ kz81: 100_000, kz86: 10_000 });
      expect(verprobeBuchung(kr, "ist", gedeutet)).toEqual([]);
    });

    it(`Teilzahlung, Rücklastschrift und Bareinnahme ebenso (${kr})`, () => {
      for (const heute of [
        invoicePaymentPosting(rechnung, 50_000, kr, "ist"),
        invoicePaymentPosting(rechnung, -50_000, kr, "ist"),
        invoiceCashPaymentPosting(rechnung, 20_000, kr, "ist"),
      ]) {
        const gedeutet = zahlungMitBemessungWieHeute(kr, wieVor552(kr, heute), heute);
        expect(kennzahlenAusJournal(kr, "ist", [gedeutet])).toEqual(kennzahlenAusJournal(kr, "ist", [heute]));
      }
    });

    it(`Geld auf einem anderen Konto als der Bank (Zahlungsdienstleister): die gebuchte Geldzeile bleibt (${kr})`, () => {
      const heute = invoicePaymentPosting(rechnung, rechnung.gross, kr, "ist");
      const alt = wieVor552(kr, heute).map((z) => (z.account === ACCOUNTS[kr].bank ? { ...z, account: paymentProviderAccount(kr, 2) } : z));
      const gedeutet = zahlungMitBemessungWieHeute(kr, alt, heute);
      expect(gedeutet).toContainEqual(alt.find((z) => z.account === paymentProviderAccount(kr, 2)));
      expect(gedeutet.some((z) => z.account === ACCOUNTS[kr].bank)).toBe(false);
      expect(ohneGeld(kr, gedeutet)).toEqual(ohneGeld(kr, heute));
    });

    it(`passt die gebuchte Steuer nicht zu heute, bleiben die Zeilen, wie gebucht (${kr})`, () => {
      const heute = invoicePaymentPosting(rechnung, rechnung.gross, kr, "ist");
      const ust19 = ACCOUNTS[kr].ust[1900];
      const nichtFaellig19 = ACCOUNTS[kr].ustNichtFaellig[1900];
      const alt = wieVor552(kr, heute).map((z) =>
        z.account === ust19 ? { ...z, credit: z.credit - 1 } : z.account === nichtFaellig19 ? { ...z, debit: z.debit - 1 } : z,
      );
      expect(zahlungMitBemessungWieHeute(kr, alt, heute)).toEqual(alt);
    });

    it(`eine Zahlung, die schon eine Bemessungsgrundlage trägt, bleibt, wie gebucht (${kr})`, () => {
      const heute = invoicePaymentPosting(rechnung, rechnung.gross, kr, "ist");
      const gebucht = heute.map((z) => (z.basis != null ? { ...z, basis: z.basis + 100 } : z));
      expect(zahlungMitBemessungWieHeute(kr, gebucht, heute)).toEqual(gebucht);
    });
  }
});
