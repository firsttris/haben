import { roundHalfAwayFromZero, type BasisPoints, type Cents } from "./money.ts";
import type { InvoiceTotals } from "./invoice.ts";

/* Anteile von Netto und Steuer je Satz, die auf Zahlungen und Ausbuchungen einer Rechnung entfallen. Teil von posting.ts. */

/** Netto und Steuer je Satz, die auf eine Zahlung oder Ausbuchung entfallen */
export interface TaxShare {
  rate: BasisPoints;
  base: Cents;
  tax: Cents;
}

/**
 * Anteil der Steuer je Satz, der auf eine (Teil-)Zahlung entfällt. Rundung so verteilt,
 * dass die Summe dem gerundeten Gesamtanteil entspricht.
 */
export function paidTaxShares(totals: InvoiceTotals, paid: Cents): TaxShare[] {
  if (totals.gross === 0) return [];
  const share = (value: Cents) => roundHalfAwayFromZero((value * paid) / totals.gross);
  const totalTax = share(totals.tax);
  const totalNet = paid - totalTax;
  const rows = totals.taxes.map((t) => ({ rate: t.rate, base: share(t.base), tax: share(t.tax) }));
  // Rundungsrest dem größten Posten zuschlagen
  const largest = rows.reduce((best, row, i) => (Math.abs(row.base) > Math.abs(rows[best]!.base) ? i : best), 0);
  if (rows[largest]) {
    rows[largest]!.tax += totalTax - rows.reduce((s, r) => s + r.tax, 0);
    rows[largest]!.base += totalNet - rows.reduce((s, r) => s + r.base, 0);
  }
  return rows;
}

/**
 * Anteil einer weiteren Zahlung bzw. Ausbuchung auf eine Rechnung: der Anteil am dann Erledigten abzüglich dessen, was
 * die bisherigen schon erfasst haben. Einzeln gerundet ergäben 3 × 39,67 € auf 119 € nur 18,99 € Steuer; so ergeben alle
 * zusammen genau die Steuer der Rechnung, auch nach einer aufgehobenen Zahlung dazwischen.
 */
export function settlementTaxShares(totals: InvoiceTotals, settledBefore: Cents, recordedBefore: TaxShare[], amount: Cents): TaxShare[] {
  const targets = paidTaxShares(totals, settledBefore + amount);
  // Ein schon erfasster Satz, den der Mix nach einer Verrechnung nicht mehr hat, wird mit dieser Zahlung auf null berichtigt (#877)
  const entfallen = [...new Set(recordedBefore.map((r) => r.rate))]
    .filter((rate) => !targets.some((t) => t.rate === rate))
    .map((rate) => ({ rate, base: 0, tax: 0 }));
  return [...targets, ...entfallen].map((target) => {
    const recorded = recordedBefore.filter((r) => r.rate === target.rate);
    return {
      rate: target.rate,
      base: target.base - recorded.reduce((sum, r) => sum + r.base, 0),
      tax: target.tax - recorded.reduce((sum, r) => sum + r.tax, 0),
    };
  });
}

/**
 * Der Mix einer Rechnung nach Verrechnungen: Eine Verrechnung nimmt das Entgelt der Gegenrechnung weg, also genau deren
 * Steueranteile. Was übrig bleibt, ist der Mix, über den die Zahlungen verteilt werden. Ohne diesen Schritt trüge bei zwei
 * Steuersätzen der falsche Satz die Steuer (Befund aus dem Review zu #877): Die Zahlung verteilte sich anteilig auf die
 * ursprüngliche Rechnung, auch auf die Position, die die Korrektur zurückgenommen hat.
 */
export function ohneSteueranteile(totals: InvoiceTotals, weggenommen: readonly TaxShare[]): InvoiceTotals {
  const weg = (rate: BasisPoints, feld: "base" | "tax") => weggenommen.filter((s) => s.rate === rate).reduce((sum, s) => sum + s[feld], 0);
  const taxes = totals.taxes
    .map((t) => ({ rate: t.rate, base: t.base - weg(t.rate, "base"), tax: t.tax - weg(t.rate, "tax") }))
    .filter((t) => t.base !== 0 || t.tax !== 0);
  const tax = taxes.reduce((sum, t) => sum + t.tax, 0);
  const gross = taxes.reduce((sum, t) => sum + t.base + t.tax, 0);
  return { net: gross - tax, tax, gross, taxes };
}

/**
 * Gespeicherter Anteil einer Zahlung bzw. Ausbuchung, wenn er zur Rechnung passt: dieselben Steuersätze und zusammen der
 * Betrag; sonst aus dem Betrag gerechnet (ältere Zeilen ohne Anteil, wie gebucht). Für welche Rechnung er gerechnet ist,
 * prüft der Aufrufer (tax_shares_invoice_id), damit der Abgleich eine umgehängte Zahlung weiter als Abweichung meldet.
 * `rest` ist der Mix nach Verrechnungen (#877): Ein Anteil passt zum vollen Mix (vor der Verrechnung gebucht) oder zum
 * Rest; neu gerechnet wird über den Rest. Als Liste der aktuelle Rest und danach die früheren Stände: Ein Anteil, der vor
 * der Aufhebung einer Verrechnung zum damaligen Rest gebucht wurde, gilt weiter.
 */
export function recordedTaxShares(
  totals: InvoiceTotals,
  amount: Cents,
  stored: TaxShare[] | null | undefined,
  rest: InvoiceTotals | readonly InvoiceTotals[] = totals,
): TaxShare[] {
  const mixe = Array.isArray(rest) ? (rest as readonly InvoiceTotals[]) : [rest as InvoiceTotals];
  const computed = paidTaxShares(mixe[0] ?? totals, amount);
  if (!stored) return computed;
  const fits = (mix: InvoiceTotals) => {
    const rates = paidTaxShares(mix, amount);
    return (
      stored.length === rates.length &&
      rates.every((c) => stored.some((s) => s.rate === c.rate)) &&
      stored.reduce((sum, s) => sum + s.base + s.tax, 0) === amount
    );
  };
  return fits(totals) || mixe.some(fits) ? stored : computed;
}
