/**
 * Wiederkehrende Rechnungen: Intervall, nächstes Datum, Leistungszeitraum und Platzhalter im Text.
 */
export const RECURRING_INTERVALS = {
  1: "monatlich",
  3: "vierteljährlich",
  6: "halbjährlich",
  12: "jährlich",
} as const;

export type RecurringInterval = 1 | 3 | 6 | 12;

/**
 * Leistungszeitraum der Rechnung, in ganzen Kalendermonaten:
 * laufend = ab dem Monat des Rechnungsdatums (Vorauszahlung), vorher = die Monate davor (Abrechnung), keiner = ohne.
 */
export const SERVICE_PERIOD_MODES = {
  laufend: "Laufender Zeitraum (ab dem Rechnungsmonat)",
  vorher: "Vergangener Zeitraum (die Monate vor dem Rechnungsmonat)",
  keiner: "Kein Leistungszeitraum",
} as const;

export type ServicePeriodMode = keyof typeof SERVICE_PERIOD_MODES;

const iso = (year: number, monthIndex: number, day: number) => {
  const date = new Date(Date.UTC(year, monthIndex, day));
  return date.toISOString().slice(0, 10);
};

const daysInMonth = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/**
 * Datum plus Monate, am Ankertag: Tag 31 wird im Februar zum 28. (bzw. 29.) und im März wieder zum 31.
 */
export function addMonthsAnchored(date: string, months: number, anchorDay: number): string {
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  return iso(targetYear, targetMonth, Math.min(anchorDay, daysInMonth(targetYear, targetMonth)));
}

export function servicePeriodFor(issueDate: string, interval: RecurringInterval, mode: ServicePeriodMode): { from: string; to: string } | null {
  if (mode === "keiner") return null;
  const year = Number(issueDate.slice(0, 4));
  const month = Number(issueDate.slice(5, 7)) - 1;
  const startMonth = mode === "laufend" ? month : month - interval;
  const startYear = year + Math.floor(startMonth / 12);
  const start = ((startMonth % 12) + 12) % 12;
  const endMonth = start + interval - 1;
  const endYear = startYear + Math.floor(endMonth / 12);
  const end = endMonth % 12;
  return { from: iso(startYear, start, 1), to: iso(endYear, end, daysInMonth(endYear, end)) };
}

const monthName = (date: string) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

/** Platzhalter für Beschreibungen und Hinweis */
export const RECURRING_PLACEHOLDERS = {
  "{monat}": "Monat, z. B. November",
  "{jahr}": "Jahr, z. B. 2026",
  "{quartal}": "Quartal, z. B. Q4",
  "{zeitraum}": "Zeitraum, z. B. November 2026 oder Oktober – Dezember 2026",
} as const;

/**
 * Ersetzt die Platzhalter. Bezug ist der Leistungszeitraum, ohne Leistungszeitraum das Rechnungsdatum.
 */
export function fillPlaceholders(text: string, reference: { from: string; to: string }): string {
  const fromYear = reference.from.slice(0, 4);
  const toYear = reference.to.slice(0, 4);
  const sameMonth = reference.from.slice(0, 7) === reference.to.slice(0, 7);
  const zeitraum = sameMonth
    ? `${monthName(reference.from)} ${fromYear}`
    : fromYear === toYear
      ? `${monthName(reference.from)} – ${monthName(reference.to)} ${toYear}`
      : `${monthName(reference.from)} ${fromYear} – ${monthName(reference.to)} ${toYear}`;
  const quartal = `Q${Math.floor((Number(reference.from.slice(5, 7)) - 1) / 3) + 1}`;
  return text
    .replaceAll("{monat}", monthName(reference.from))
    .replaceAll("{jahr}", fromYear)
    .replaceAll("{quartal}", quartal)
    .replaceAll("{zeitraum}", zeitraum);
}

/** Alle fälligen Termine bis einschließlich heute, höchstens bis zum Enddatum */
export function dueDates(nextDate: string, interval: RecurringInterval, anchorDay: number, today: string, endDate: string | null): string[] {
  const dates: string[] = [];
  let date = nextDate;
  while (date <= today && (!endDate || date <= endDate) && dates.length < 120) {
    dates.push(date);
    date = addMonthsAnchored(date, interval, anchorDay);
  }
  return dates;
}
