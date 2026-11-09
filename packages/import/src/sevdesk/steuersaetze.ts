/* Aufteilung eines sevDesk-Belegs nach Steuersatz; Sätze in Basispunkten, Beträge in Cent. */

type Bucket = { rate: number; net: number; tax: number };

/** Sätze, die der Kopf eines Belegs ohne Positionen tragen kann: 19 % und 7 %, dazu 16 % und 5 % aus dem zweiten Halbjahr 2020. */
export const SEV_HEAD_RATES = [1900, 700, 1600, 500] as const;

/** Satz aus Netto und Steuer des Kopfs, auf einen Cent genau, in ganzen Zahlen; passt keiner, bleibt 0. */
function rateFromHead(net: number, tax: number): number {
  if (tax === 0) return 0;
  return SEV_HEAD_RATES.find((rate) => Math.abs(net * rate - tax * 10_000) <= 10_000) ?? 0;
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
