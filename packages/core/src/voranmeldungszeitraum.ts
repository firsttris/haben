import type { Cents } from "./money.ts";
import { isQuarter, lastMonthOfPeriod, monthsOfPeriod, quarterOfMonth, type VatPeriod } from "./period.ts";

/**
 * Voranmeldungszeitraum nach § 18 Abs. 2 UStG: das Kalendervierteljahr, der Kalendermonat bei mehr als 9.000 € Steuer im
 * Vorjahr, Befreiung bei höchstens 2.000 €. Festgelegt wird er vom Finanzamt; Haben schlägt nur vor.
 */
export const VAT_FREQUENCIES = ["monatlich", "vierteljaehrlich", "keine"] as const;
export type VatFrequency = (typeof VAT_FREQUENCIES)[number];

export const VAT_FREQUENCY_LABEL: Record<VatFrequency, string> = {
  monatlich: "monatlich",
  vierteljaehrlich: "vierteljährlich",
  keine: "keine Voranmeldung (befreit)",
};

/** Ab diesem Monat eines Jahres gilt der Zeitraum; ein Wechsel im Jahr nur zum Beginn eines Quartals */
export const FREQUENCY_START_MONTHS = [1, 4, 7, 10] as const;

export interface VatFrequencySetting {
  year: number;
  fromMonth: number;
  frequency: VatFrequency;
}

/** Ohne Einstellung gilt die monatliche Abgabe, wie in Haben vor dieser Einstellung. */
export const DEFAULT_VAT_FREQUENCY: VatFrequency = "monatlich";

const order = (s: Pick<VatFrequencySetting, "year" | "fromMonth">) => s.year * 100 + s.fromMonth;

/**
 * Zeitraum, der in einem Monat gilt: die letzte Einstellung bis dahin. Ein Jahr ohne eigene Einstellung übernimmt die des
 * Vorjahres; das Finanzamt ändert den Zeitraum nur, wenn sich die Steuer des Vorjahres ändert.
 */
export function frequencyAt(settings: readonly VatFrequencySetting[], { year, month }: VatPeriod): VatFrequency {
  const at = year * 100 + month;
  let found: VatFrequencySetting | undefined;
  for (const setting of settings) {
    if (order(setting) <= at && (!found || order(setting) > order(found))) found = setting;
  }
  return found?.frequency ?? DEFAULT_VAT_FREQUENCY;
}

/** Der Voranmeldungszeitraum, zu dem ein Monat gehört; null ohne Voranmeldung */
export function filingPeriodOfMonth(month: VatPeriod, frequency: VatFrequency): VatPeriod | null {
  if (frequency === "keine") return null;
  return frequency === "vierteljaehrlich" ? { year: month.year, month: quarterOfMonth(month.month) } : month;
}

/** Passt der Zeitraum zur Einstellung, also gilt für jeden seiner Monate dieselbe Art (Monat oder Quartal)? */
export function periodMatchesFrequency(settings: readonly VatFrequencySetting[], period: VatPeriod): boolean {
  const expected: VatFrequency = isQuarter(period) ? "vierteljaehrlich" : "monatlich";
  return monthsOfPeriod(period).every((month) => frequencyAt(settings, month) === expected);
}

/** Alle Voranmeldungszeiträume eines Jahres nach der Einstellung, in zeitlicher Reihenfolge */
export function filingPeriodsOfYear(settings: readonly VatFrequencySetting[], year: number): VatPeriod[] {
  const periods: VatPeriod[] = [];
  for (let month = 1; month <= 12; month++) {
    const period = filingPeriodOfMonth({ year, month }, frequencyAt(settings, { year, month }));
    if (period && !periods.some((p) => p.month === period.month)) periods.push(period);
  }
  return periods;
}

/**
 * Der zuletzt abgelaufene Voranmeldungszeitraum vor dem Monat `today` (JJJJ-MM): bei monatlicher Abgabe der Vormonat,
 * bei vierteljährlicher das letzte volle Quartal. null, wenn in den zwei Jahren davor keiner abgelaufen ist (befreit).
 */
export function latestEndedPeriod(settings: readonly VatFrequencySetting[], today: VatPeriod): VatPeriod | null {
  let { year, month } = today;
  for (let i = 0; i < 24; i++) {
    month -= 1;
    if (month === 0) {
      year -= 1;
      month = 12;
    }
    const period = filingPeriodOfMonth({ year, month }, frequencyAt(settings, { year, month }));
    if (period && lastMonthOfPeriod(period).month === month) return period;
  }
  return null;
}

/** Die Zeiträume der letzten `months` Monate bis einschließlich `today`, neueste zuerst; befreite Monate fehlen */
export function recentFilingPeriods(settings: readonly VatFrequencySetting[], today: VatPeriod, months = 13): VatPeriod[] {
  const periods: VatPeriod[] = [];
  let { year, month } = today;
  for (let i = 0; i < months; i++) {
    const period = filingPeriodOfMonth({ year, month }, frequencyAt(settings, { year, month }));
    if (period && !periods.some((p) => p.year === period.year && p.month === period.month)) periods.push(period);
    month -= 1;
    if (month === 0) {
      year -= 1;
      month = 12;
    }
  }
  return periods;
}

export interface FrequencySuggestion {
  frequency: VatFrequency;
  /** Begründung mit Betrag und Vorschrift, für die Anzeige */
  reason: string;
}

export interface FrequencyBasis {
  /** Jahr, für das der Zeitraum gesucht ist */
  year: number;
  /** Steuer des Vorjahres (Summe der Vorauszahlungen bzw. Zahllast, negativ = Überschuss); null = unbekannt */
  previousYearTax: Cents | null;
  /** Erster Monat mit Tätigkeit (JJJJ-MM), etwa die erste Buchung; null = unbekannt */
  firstActivity: string | null;
}

const euro = (cents: Cents) => `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.trunc(cents / 100))} €`;

/**
 * Grenzen aus § 18 Abs. 2 Satz 2 und 3 UStG: 9.000 € und 2.000 € ab 2025 (Viertes Bürokratieentlastungsgesetz), bis 2024
 * 7.500 € und 1.000 €. Maßgeblich ist die Fassung im Jahr, für das der Zeitraum gilt.
 */
export const MONTHLY_ABOVE: Cents = 900_000;
export const EXEMPT_UP_TO: Cents = 200_000;
const MONTHLY_ABOVE_BIS_2024: Cents = 750_000;
const EXEMPT_UP_TO_BIS_2024: Cents = 100_000;

function limitsFor(year: number): { monthlyAbove: Cents; exemptUpTo: Cents } {
  return year <= 2024 ? { monthlyAbove: MONTHLY_ABOVE_BIS_2024, exemptUpTo: EXEMPT_UP_TO_BIS_2024 } : { monthlyAbove: MONTHLY_ABOVE, exemptUpTo: EXEMPT_UP_TO };
}

function byAmount(tax: Cents, what: string, year: number): FrequencySuggestion {
  const { monthlyAbove, exemptUpTo } = limitsFor(year);
  const monthly = euro(monthlyAbove);
  const exempt = euro(exemptUpTo);
  if (tax > monthlyAbove) return { frequency: "monatlich", reason: `${what} ${euro(tax)}, mehr als ${monthly}: monatlich (§ 18 Abs. 2 Satz 2 UStG).` };
  if (tax <= exemptUpTo) {
    const ueberschuss = tax < -monthlyAbove ? ` Bei einem Überschuss über ${monthly} kannst du auch monatlich wählen (§ 18 Abs. 2a UStG).` : "";
    return {
      frequency: "keine",
      reason: `${what} ${euro(tax)}, höchstens ${exempt}: Das Finanzamt kann dich von der Voranmeldung befreien (§ 18 Abs. 2 Satz 3 UStG); sonst vierteljährlich.${ueberschuss}`,
    };
  }
  return { frequency: "vierteljaehrlich", reason: `${what} ${euro(tax)}, zwischen ${exempt} und ${monthly}: vierteljährlich (§ 18 Abs. 2 Satz 1 UStG).` };
}

/**
 * Vorschlag für den Voranmeldungszeitraum eines Jahres nach § 18 Abs. 2 UStG in der geltenden Fassung. Wer die Tätigkeit im
 * laufenden oder im Vorjahr aufgenommen hat, gibt monatlich ab (Satz 4); für 2021 bis 2026 ist das ausgesetzt (Satz 6): Dann
 * zählt die auf ein Jahr hochgerechnete Steuer des Vorjahres, im Gründungsjahr die voraussichtliche, die Haben nicht kennt.
 */
export function suggestFrequency({ year, previousYearTax, firstActivity }: FrequencyBasis): FrequencySuggestion | null {
  const startYear = firstActivity ? Number(firstActivity.slice(0, 4)) : null;
  const founder = startYear !== null && startYear >= year - 1;
  const suspended = year >= 2021 && year <= 2026;
  if (founder && !suspended) {
    return { frequency: "monatlich", reason: `Tätigkeit ${startYear} aufgenommen: im Gründungsjahr und im Folgejahr monatlich (§ 18 Abs. 2 Satz 4 UStG).` };
  }
  if (startYear === year) return null;
  if (previousYearTax === null) return null;
  if (founder && firstActivity) {
    // Nur einen Teil des Vorjahres tätig: auf ein Jahr hochrechnen, angefangene Monate voll (§ 18 Abs. 2 Satz 6 UStG)
    const months = 13 - Number(firstActivity.slice(5, 7));
    if (months < 12) return byAmount(Math.trunc((previousYearTax * 12) / months), `Steuer ${year - 1} auf ein Jahr hochgerechnet (${months} Monate):`, year);
  }
  return byAmount(previousYearTax, `Steuer ${year - 1}:`, year);
}
