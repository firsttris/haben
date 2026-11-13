import { lineAmount, type Millis } from "./invoice.ts";
import { roundHalfAwayFromZero, type Cents } from "./money.ts";

/*
 * Abrechenbare Leistungen (#417): Dauer in Minuten lesen und zeigen, Betrag eines Eintrags. Die Dauer eines Eintrags
 * liegt zwischen einer Minute und einem Tag.
 */

const MAX_MINUTES = 24 * 60;

/**
 * Liest eine Dauer in ganzen Minuten: "1:30", "1,5" bzw. "1.5" (Stunden), "2", "1h 30min", "45 min". Null, wenn es keine
 * Dauer ist, null Minuten oder mehr als 24 Stunden herauskommen.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  let minutes: number | null = null;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  const decimal = /^(\d{1,2})(?:[.,](\d{1,2}))?\s*(?:h|std\.?)?$/.exec(text);
  const split = /^(?:(\d{1,2})\s*(?:h|std\.?))?\s*(?:(\d{1,4})\s*(?:min\.?|m))?$/.exec(text);
  if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2]);
  else if (decimal) minutes = Math.round(Number(`${decimal[1]}.${decimal[2] ?? "0"}`) * 60);
  else if (split && (split[1] !== undefined || split[2] !== undefined)) {
    // neben Stunden nur Minuten unter 60; "90 min" allein ist erlaubt
    if (split[1] === undefined || Number(split[2] ?? 0) <= 59) minutes = Number(split[1] ?? 0) * 60 + Number(split[2] ?? 0);
  }
  return minutes !== null && minutes >= 1 && minutes <= MAX_MINUTES ? minutes : null;
}

/** Stunden und Minuten, z. B. 90 → "1:30" */
export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Minuten mal Stundensatz (Cent je Stunde) auf ganze Cent; ein halber Cent rundet weg von null */
export function serviceAmount(minutes: number, hourlyRateCents: Cents): Cents {
  return roundHalfAwayFromZero((minutes * hourlyRateCents) / 60);
}

/** Was ein Eintrag für die Rechnung hergibt: Dauer, abrechenbare Dauer und Kennzeichen (Stundensatz fehlt = Betrag 0, der Satz wird beim Abrechnen verlangt) */
export interface Abrechenbar {
  minutes: number;
  /** Abrechenbare Dauer; null = die erfasste */
  billableMinutes: number | null;
  nonBillable: boolean;
}

/** Abrechenbare Minuten: 0 bei einem nicht abrechenbaren Eintrag, sonst die abrechenbare Dauer oder die erfasste */
export function billableMinutes(entry: Abrechenbar): number {
  return entry.nonBillable ? 0 : (entry.billableMinutes ?? entry.minutes);
}

/** Abrechenbarer Betrag in Cent; ohne Stundensatz 0 */
export function billableAmount(entry: Abrechenbar & { hourlyRateCents: Cents | null }): Cents {
  return entry.hourlyRateCents === null ? 0 : serviceAmount(billableMinutes(entry), entry.hourlyRateCents);
}

/** Offener Eintrag, wie ihn „Abrechnen“ zu Positionen zusammenfasst */
export interface OffeneLeistung extends Abrechenbar {
  workedOn: string;
  hourlyRateCents: Cents | null;
  project: string;
}

/** Position je Stundensatz */
export interface BillingLine {
  rateCents: Cents;
  /** Abrechenbare Minuten */
  minutes: number;
  /** Menge der Position in Tausendstel Stunden */
  quantity: Millis;
  net: Cents;
  projects: string[];
}

export interface BillingPreview {
  entries: number;
  minutes: number;
  net: Cents;
  /** Offene abrechenbare Einträge ohne Stundensatz: ohne ihn lässt sich nicht abrechnen */
  withoutRate: number;
  lines: BillingLine[];
  from: string | null;
  to: string | null;
}

/**
 * Fasst offene Einträge (nach Arbeitstag sortiert) je Stundensatz zu einer Position in Std. zusammen: Menge die Summe der
 * abrechenbaren Minuten, einmal je Position auf Tausendstel gerundet (100 Minuten sind 1,667 Std.), Netto wie jede
 * Rechnungszeile (lineAmount). Zeitraum ist der erste bis letzte Arbeitstag, auch von Einträgen ohne Stundensatz.
 */
export function billingPreview(entries: OffeneLeistung[]): BillingPreview {
  const byRate = new Map<Cents, OffeneLeistung[]>();
  for (const entry of entries) {
    if (entry.hourlyRateCents !== null) byRate.set(entry.hourlyRateCents, [...(byRate.get(entry.hourlyRateCents) ?? []), entry]);
  }
  const lines = [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rateCents, group]): BillingLine => {
      const minutes = group.reduce((sum, e) => sum + billableMinutes(e), 0);
      const quantity = roundHalfAwayFromZero((minutes * 1000) / 60);
      return {
        rateCents,
        minutes,
        quantity,
        net: lineAmount(quantity, rateCents),
        projects: [...new Set(group.map((e) => e.project).filter((p) => p !== ""))],
      };
    });
  const withRate = entries.filter((e) => e.hourlyRateCents !== null).length;
  return {
    entries: withRate,
    minutes: lines.reduce((sum, l) => sum + l.minutes, 0),
    net: lines.reduce((sum, l) => sum + l.net, 0),
    withoutRate: entries.length - withRate,
    lines,
    from: entries[0]?.workedOn ?? null,
    to: entries.at(-1)?.workedOn ?? null,
  };
}
