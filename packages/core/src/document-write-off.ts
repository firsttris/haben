import type { InvoiceTotals } from "./invoice.ts";
import type { BasisPoints, Cents } from "./money.ts";
import { abziehbareSteuer, buchungsAnteil } from "./vorsteuerabzug.ts";
import { ACCOUNTS, inputTaxCode, paidTaxShares, side, vatRate, type Kontenrahmen, type PostingLine, type TaxShare } from "./posting.ts";

/**
 * Erhaltenes Skonto auf einen Beleg, amount mit dem Vorzeichen einer Zahlung (Ausgang negativ):
 * Verbindlichkeiten an erhaltene Skonti und Vorsteuer, anteilig je Steuersatz. Ohne Vorsteuerabzug
 * (Kleinunternehmer) mindert das Skonto den Aufwand in voller Höhe.
 *
 * `zwischenkontoAnteile` (#786): Der Beleg ist eine Gutschrift, deren Vorsteuerminderung noch auf dem Zwischenkonto
 * steht. Der ausgebuchte Rest erstattet nichts mehr, seine Steuer wird also nicht gezogen, sondern vom Zwischenkonto
 * abgeschrieben — mit Steuerschlüssel und Bemessungsgrundlage, in der Richtung der bisherigen Steuerzeile. Die Anteile
 * kommen fertig herein statt aus `paidTaxShares` dieses Betrags: Sonst rechnete die Ausbuchung für sich, und zusammen mit
 * den vorherigen Teilerstattungen läge die Steuer einen Cent neben der des Belegs (etwa 5,80 € von 9,28 € erstattet und
 * 3,48 € als Skonto ausgebucht: 93 + 56 statt 93 + 55).
 */
export function documentWriteOffPosting(
  totals: InvoiceTotals,
  amount: Cents,
  kontenrahmen: Kontenrahmen,
  vorsteuerAbzug: boolean | BasisPoints,
  /** Anteile je Steuersatz, die vom Zwischenkonto abgeschrieben werden; null = Vorsteuer wie bisher */
  zwischenkontoAnteile: readonly TaxShare[] | null = null,
  /** Kumuliert gerundete abziehbare Steuer bei weiteren Skonto-Ausbuchungen. */
  abzugsAnteile: readonly TaxShare[] | null = null,
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [side(accounts.verbindlichkeiten, -amount, true, null)];
  for (const { rate, base: originalBase, tax: originalTax } of paidTaxShares(totals, -amount)) {
    const base = zwischenkontoAnteile?.find((s) => s.rate === rate)?.base ?? originalBase;
    const tax = originalBase + originalTax - base;
    const anteil = buchungsAnteil(vorsteuerAbzug, totals.taxes.find((t) => t.rate === rate)?.vorsteuerAnteil);
    const deductible = (zwischenkontoAnteile ?? abzugsAnteile)?.find((s) => s.rate === rate)?.tax ?? abziehbareSteuer(tax, anteil);
    if (anteil === 0 || rate === 0) {
      if (base + tax !== 0) lines.push(side(accounts.skontiErhalten, base + tax, false, anteil > 0 ? inputTaxCode(rate) : "keineVSt"));
      continue;
    }
    const code = inputTaxCode(rate);
    if (base !== 0) lines.push(side(accounts.skontiErhalten, base, false, code));
    if (tax - deductible !== 0) lines.push(side(accounts.skontiErhalten, tax - deductible, false, "keineVSt"));
    if (deductible !== 0) {
      if (!zwischenkontoAnteile) lines.push(side(accounts.vorsteuer[vatRate(rate)], deductible, false, code));
      // Auf dem Zwischenkonto mit der Bemessungsgrundlage, wie die Umbuchung beim Ausgleich (#786)
      else
        lines.push({
          ...side(accounts.vorsteuerNochNichtAbziehbar, deductible, false, code),
          basis: zwischenkontoAnteile.find((s) => s.rate === rate)?.base ?? base,
        });
    }
  }
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}
