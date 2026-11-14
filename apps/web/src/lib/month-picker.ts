import { MONTHS } from "@haben/core";

/** Dreistellige deutsche Monatskürzel für das 3×4-Raster */
export const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3));

/** Liest einen Monatswert im Format `JJJJ-MM`; gibt bei ungültigem Text `null` zurück. */
export function parseMonth(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** Formatiert Jahr und Monat (1–12) als `JJJJ-MM`. */
export function formatMonthValue(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Formatiert `JJJJ-MM` für das Feld als deutschen Monatsnamen mit Jahr, z. B. „November 2026“. */
export function formatMonthLabel(value: string): string {
  const parsed = parseMonth(value);
  if (!parsed) return "";
  return `${MONTHS[parsed.month - 1]} ${parsed.year}`;
}

/** Prüft, ob ein Monat außerhalb der Grenzen `min` / `max` liegt. */
export function isMonthDisabled(ym: string, min?: string, max?: string): boolean {
  if (min && ym < min) return true;
  if (max && ym > max) return true;
  return false;
}

/** Bestimmt das erste angezeigte Jahr beim Öffnen der Monatsauswahl. */
export function initialViewYear(value: string, min?: string, max?: string, fallbackYear = new Date().getFullYear()): number {
  const current = parseMonth(value);
  if (current) return current.year;
  const maxYear = max ? parseMonth(max)?.year : undefined;
  const minYear = min ? parseMonth(min)?.year : undefined;
  if (maxYear !== undefined && fallbackYear > maxYear) return maxYear;
  if (minYear !== undefined && fallbackYear < minYear) return minYear;
  return fallbackYear;
}

/** Liest die Jahresgrenzen aus `min` und `max` für die Jahres-Navigation. */
export function yearBounds(min?: string, max?: string): { minYear: number | undefined; maxYear: number | undefined } {
  return {
    minYear: min ? parseMonth(min)?.year : undefined,
    maxYear: max ? parseMonth(max)?.year : undefined,
  };
}
