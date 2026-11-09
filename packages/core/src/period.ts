import { naechsterWerktag } from "./holidays.ts";
import type { Bundesland } from "./steuernummer.ts";
import { z } from "zod/mini";

export const vatPeriodSchema = z.object({
  year: z.int().check(z.minimum(2000), z.maximum(2100)),
  /** 1–12 für Monatszeiträume */
  month: z.int().check(z.minimum(1), z.maximum(12)),
});

export type VatPeriod = z.infer<typeof vatPeriodSchema>;

/**
 * Voranmeldungszeitraum mit dem Schlüssel, den ELSTER im Feld Zeitraum der Voranmeldung erwartet: 01–12 für die Monate,
 * 41–44 für die Kalendervierteljahre. Haben speichert ihn so in vat_returns.month.
 */
export const filingPeriodSchema = z.object({
  year: z.int().check(z.minimum(2000), z.maximum(2100)),
  month: z.int().check(z.refine((m) => (m >= 1 && m <= 12) || (m >= 41 && m <= 44), "Monat 1–12 oder Quartal 41–44")),
});

/** Kalendervierteljahr (Zeitraum 41–44)? */
export function isQuarter({ month }: VatPeriod): boolean {
  return month >= 41 && month <= 44;
}

/** Quartal eines Monats als Zeitraum-Schlüssel: März → 41, Oktober → 44 */
export function quarterOfMonth(month: number): number {
  return 40 + Math.ceil(month / 3);
}

/** Die Monate eines Voranmeldungszeitraums: ein Monat oder die drei eines Quartals */
export function monthsOfPeriod(period: VatPeriod): VatPeriod[] {
  if (!isQuarter(period)) return [period];
  const first = (period.month - 41) * 3 + 1;
  return [first, first + 1, first + 2].map((month) => ({ year: period.year, month }));
}

/** Letzter Monat des Zeitraums, nach dem sich die Frist richtet */
export function lastMonthOfPeriod(period: VatPeriod): VatPeriod {
  return monthsOfPeriod(period).at(-1)!;
}

/** Erster Tag des Zeitraums und erster Tag danach (ausschließlich), JJJJ-MM-TT */
export function periodRange(period: VatPeriod): { start: string; end: string } {
  const first = monthsOfPeriod(period)[0]!;
  const last = lastMonthOfPeriod(period);
  const start = `${first.year}-${String(first.month).padStart(2, "0")}-01`;
  const end = last.month === 12 ? `${last.year + 1}-01-01` : `${last.year}-${String(last.month + 1).padStart(2, "0")}-01`;
  return { start, end };
}

export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"] as const;

/** „Oktober 2026“, für Quartale „4. Quartal 2026“ */
export function periodLabel({ year, month }: VatPeriod): string {
  return month >= 41 ? `${month - 40}. Quartal ${year}` : `${MONTHS[month - 1]} ${year}`;
}

/** "2026-10", für Quartale "2026-Q4" */
export function periodKey({ year, month }: VatPeriod): string {
  return month >= 41 ? `${year}-Q${month - 40}` : `${year}-${String(month).padStart(2, "0")}`;
}

/** Liest Monat ("2026-10") und Quartal ("2026-Q4") */
export function parsePeriodKey(key: string): VatPeriod | null {
  const match = /^(\d{4})-(?:(\d{2})|Q([1-4]))$/.exec(key);
  if (!match) return null;
  const month = match[3] ? 40 + Number(match[3]) : Number(match[2]);
  if (!match[3] && month > 12) return null;
  const parsed = filingPeriodSchema.safeParse({ year: Number(match[1]), month });
  return parsed.success ? parsed.data : null;
}

export function previousPeriod({ year, month }: VatPeriod): VatPeriod {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

const berlinMonth = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" });
const berlinDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });

/** Der Kalendertag in Deutschland als YYYY-MM-DD: Der Server läuft im Container in UTC, dort wäre es bis 1 Uhr (Sommerzeit 2 Uhr) noch der Vortag */
export function germanDay(now: Date = new Date()): string {
  return berlinDay.format(now);
}

/**
 * Der Zeitraum, der zu einem Zeitpunkt gerade abzugeben ist (Vormonat). Maßgeblich ist der Monat in Deutschland, nicht
 * die Zeitzone des Servers (im Container UTC) oder des Browsers.
 */
export function currentFilingPeriod(now: Date): VatPeriod {
  return previousPeriod(currentMonth(now));
}

/** Der laufende Monat in Deutschland */
export function currentMonth(now: Date = new Date()): VatPeriod {
  const [year, month] = berlinMonth.format(now).split("-").map(Number) as [number, number];
  return { year, month };
}

/** Das laufende Jahr in Deutschland */
export function currentYear(now: Date = new Date()): number {
  return currentMonth(now).year;
}

/**
 * Fälligkeit: der 10. Tag nach Ablauf des Zeitraums (§ 18 Abs. 1 UStG), also der 10. des Monats nach dem Monat bzw.
 * Quartal; mit Dauerfristverlängerung einen Monat später (§ 46 UStDV). Fällt er auf ein Wochenende oder einen Feiertag,
 * gilt der nächste Werktag (§ 108 Abs. 3 AO).
 */
export function dueDate(period: VatPeriod, bundesland: Bundesland | null = null, dauerfrist = false): string {
  const { year, month } = lastMonthOfPeriod(period);
  const offset = month + (dauerfrist ? 2 : 1);
  const dueYear = year + Math.floor((offset - 1) / 12);
  const dueMonth = ((offset - 1) % 12) + 1;
  return naechsterWerktag(`${dueYear}-${String(dueMonth).padStart(2, "0")}-10`, bundesland);
}
