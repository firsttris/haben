/* Aufteilung eines sevDesk-Belegs nach Steuersatz; Sätze in Basispunkten, Beträge in Cent. */

type Bucket = { rate: number; net: number; tax: number };

/** Sätze, die der Kopf eines Belegs ohne Positionen tragen kann: 19 % und 7 %, dazu 16 % und 5 % aus dem zweiten Halbjahr 2020. */
export const SEV_HEAD_RATES = [1900, 700, 1600, 500] as const;

/**
 * Satz aus Netto und Steuer des Kopfs, in ganzen Zahlen; passt keiner auf einen Cent genau, bleibt 0. Von mehreren passenden
 * gilt der nächstliegende: Bei kleinen Beträgen liegen die Sätze innerhalb eines Cents. Der Cent bleibt als Grenze, denn vom
 * Brutto gerechnete Rechnungen weichen um mehr als einen halben Cent ab.
 */
function rateFromHead(net: number, tax: number): number {
  if (tax === 0) return 0;
  const distance = (rate: number) => Math.abs(net * rate - tax * 10_000);
  const matching = SEV_HEAD_RATES.filter((rate) => distance(rate) <= 10_000);
  return matching.reduce<number>((best, rate) => (distance(rate) < distance(best) ? rate : best), matching[0] ?? 0);
}

/**
 * Netto und Steuer je Steuersatz aus den Positionen. Maßgeblich sind die Summen des Belegs:
 * Rundungsdifferenzen zwischen Positionen und Kopf landen beim größten Satz, die der Steuer beim größten Satz mit Steuer.
 */
export function taxesFromPositions(positions: { rate: number; net: number; tax: number }[], net: number, tax: number): Bucket[] {
  const byRate = new Map<number, Bucket>();
  for (const p of positions) {
    const b = byRate.get(p.rate) ?? { rate: p.rate, net: 0, tax: 0 };
    b.net += p.net;
    b.tax += p.tax;
    byRate.set(p.rate, b);
  }
  const buckets = [...byRate.values()];
  if (buckets.length <= 1) {
    if (net === 0 && tax === 0 && buckets.length === 0) return [];
    // Ohne Positionen nennt nur der Kopf den Satz, etwa bei einer Rechnung, deren Positionen sevDesk nicht liefert (#472)
    return [{ rate: buckets[0]?.rate ?? rateFromHead(net, tax), net, tax }];
  }
  const largestOf = (list: Bucket[]) => list.reduce((a, b) => (Math.abs(b.net) > Math.abs(a.net) ? b : a));
  largestOf(buckets).net += net - buckets.reduce((s, b) => s + b.net, 0);
  // Steuerdifferenzen nur auf einen Satz mit Steuer, sonst stünde beim 0-%-Satz Steuer
  const taxed = buckets.filter((b) => b.rate !== 0);
  largestOf(taxed.length > 0 ? taxed : buckets).tax += tax - buckets.reduce((s, b) => s + b.tax, 0);
  return buckets;
}
