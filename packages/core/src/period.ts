import { isNonWorkingDay } from "./holidays.ts";
import type { Bundesland } from "./steuernummer.ts";
import { z } from "zod";

export const vatPeriodSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  /** 1–12 für Monatszeiträume */
  month: z.number().int().min(1).max(12),
});

export type VatPeriod = z.infer<typeof vatPeriodSchema>;

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
] as const;

export function periodLabel({ year, month }: VatPeriod): string {
  return `${MONTHS[month - 1]} ${year}`;
}

/** "2026-10" */
export function periodKey({ year, month }: VatPeriod): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parsePeriodKey(key: string): VatPeriod | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;
  const parsed = vatPeriodSchema.safeParse({ year: Number(match[1]), month: Number(match[2]) });
  return parsed.success ? parsed.data : null;
}

export function previousPeriod({ year, month }: VatPeriod): VatPeriod {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** Der Zeitraum, der zu einem Datum gerade abzugeben ist (Vormonat). */
export function currentFilingPeriod(today: Date): VatPeriod {
  return previousPeriod({ year: today.getFullYear(), month: today.getMonth() + 1 });
}

/**
 * Fälligkeit ohne Dauerfristverlängerung: der 10. des Folgemonats,
 * fällt er auf ein Wochenende oder einen Feiertag, der nächste Werktag.
 */
export function dueDate({ year, month }: VatPeriod, bundesland: Bundesland | null = null): Date {
  const due = new Date(Date.UTC(month === 12 ? year + 1 : year, month % 12, 10));
  while (isNonWorkingDay(due.toISOString().slice(0, 10), bundesland)) due.setUTCDate(due.getUTCDate() + 1);
  return due;
}
