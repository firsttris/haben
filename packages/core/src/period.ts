import { naechsterWerktag } from "./holidays.ts";
import type { Bundesland } from "./steuernummer.ts";
import { z } from "zod/mini";

export const vatPeriodSchema = z.object({
  year: z.int().check(z.minimum(2000), z.maximum(2100)),
  /** 1–12 für Monatszeiträume */
  month: z.int().check(z.minimum(1), z.maximum(12)),
});

export type VatPeriod = z.infer<typeof vatPeriodSchema>;

export const MONTHS = [
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
export function dueDate({ year, month }: VatPeriod, bundesland: Bundesland | null = null): string {
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  return naechsterWerktag(`${next}-10`, bundesland);
}
