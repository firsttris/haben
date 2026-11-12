import type { TaxShare } from "./posting.ts";
import type { TaxTreatment } from "./treatment.ts";

/** § 18b UStG: EU-Leistungen und innergemeinschaftliche Lieferungen behalten ihre gesonderten Meldezeitpunkte. */
export const advanceUsesPayments = (treatment: TaxTreatment) => ["regulaer", "steuerfrei", "ausfuhr"].includes(treatment);

export interface AdvanceVatEvent {
  date: string;
  /** Tatsächlicher Zufluss, Erstattung bzw. Gegenzeile, mit den gespeicherten Steueranteilen. */
  paid?: TaxShare[];
  /** Minderung einer Forderung, kein Zahlungseingang. */
  writtenOff?: TaxShare[];
  /** Festgeschriebene Korrektur der Anforderung. */
  correction?: TaxShare[];
  /** Schlussleistung bzw. deren Storno. */
  performance?: 1 | -1;
}

export interface AdvanceVatChange {
  date: string;
  shares: TaxShare[];
}

/** Differenz zweier mit advanceVatPlan berechneter Stände, ohne Rückrechnung aus Kontonummern. */
export function advanceVatDifference(before: readonly AdvanceVatChange[], after: readonly AdvanceVatChange[]): AdvanceVatChange[] {
  const days = new Map<string, Map<number, TaxShare>>();
  for (const [changes, sign] of [
    [before, -1],
    [after, 1],
  ] as const) {
    for (const { date, shares } of changes) {
      let rates = days.get(date);
      if (!rates) {
        rates = new Map();
        days.set(date, rates);
      }
      for (const share of shares) {
        const previous = rates.get(share.rate) ?? { rate: share.rate, base: 0, tax: 0 };
        rates.set(share.rate, { rate: share.rate, base: previous.base + sign * share.base, tax: previous.tax + sign * share.tax });
      }
    }
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rates]) => ({ date, shares: [...rates.values()].filter((s) => s.base || s.tax) }))
    .filter((d) => d.shares.length);
}

/**
 * Mindest-Istversteuerung bei Soll: bis zur Leistung nur die Zahlung, danach das gesamte Entgelt. Wird die
 * Schlussrechnung storniert, bleiben tatsächliche Zahlungen besteuert. Gleiche Tage werden zusammen gerechnet.
 * Die Anteile stammen aus den gespeicherten Belegen und Zahlungen, nicht aus neu gerundeten Prozentsätzen.
 * Quelle: § 13 Abs. 1 Nr. 1 a UStG, https://www.gesetze-im-internet.de/ustg_1980/__13.html
 */
export function advanceVatPlan(total: readonly TaxShare[], events: readonly AdvanceVatEvent[]): AdvanceVatChange[] {
  const byDate = new Map<string, AdvanceVatEvent[]>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
  const rates = [...new Set([...total, ...events.flatMap((e) => [...(e.paid ?? []), ...(e.writtenOff ?? []), ...(e.correction ?? [])])].map((s) => s.rate))];
  const sum = (shares: readonly TaxShare[], rate: number, key: "base" | "tax") => shares.filter((s) => s.rate === rate).reduce((n, s) => n + s[key], 0);
  const paid: TaxShare[] = [];
  const writtenOff: TaxShare[] = [];
  const amount = [...total];
  let performed = 0;
  let previous: TaxShare[] = [];
  const changes: AdvanceVatChange[] = [];
  for (const [date, day] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    for (const e of day) {
      paid.push(...(e.paid ?? []));
      writtenOff.push(...(e.writtenOff ?? []));
      amount.push(...(e.correction ?? []));
      performed += e.performance ?? 0;
    }
    const target = rates.map((rate) => ({
      rate,
      base: performed > 0 ? sum(amount, rate, "base") - sum(writtenOff, rate, "base") : sum(paid, rate, "base"),
      tax: performed > 0 ? sum(amount, rate, "tax") - sum(writtenOff, rate, "tax") : sum(paid, rate, "tax"),
    }));
    const shares = target
      .map((s) => ({ rate: s.rate, base: s.base - sum(previous, s.rate, "base"), tax: s.tax - sum(previous, s.rate, "tax") }))
      .filter((s) => s.base !== 0 || s.tax !== 0);
    if (shares.length) changes.push({ date, shares });
    previous = target;
  }
  return changes;
}
