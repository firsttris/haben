import { germanDay } from "@haben/core";
// Immer deutsche Zeit: Server und Browser formatieren sonst je nach Zeitzone unterschiedlich (Hydration-Fehler)
const timeZone = "Europe/Berlin";
const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone });
const longDateFormat = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone });
const dateTimeFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone });
const dayMonthFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone });

export const formatDate = (value: string | Date) => dateFormat.format(new Date(value));
export const formatLongDate = (value: string | Date) => longDateFormat.format(new Date(value));
export const formatDateTime = (value: string | Date) => dateTimeFormat.format(new Date(value));
/** „23.11.“, für die Auskunft unter einem Status, wo das Jahr aus dem Zusammenhang klar ist */
export const formatDayMonth = (value: string | Date) => dayMonthFormat.format(new Date(value));

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1).replace(".", ",")} GB`;
}

/** Tage bis zu einem Datum (negativ = vorbei), gezählt in Kalendertagen in Deutschland */
export function daysUntil(value: string | Date, today = new Date()): number {
  return Math.round((Date.parse(germanDay(new Date(value))) - Date.parse(germanDay(today))) / 86_400_000);
}

/** Abstand in Tagen als Wort: „heute“, „morgen“, „in 5 Tagen“, „seit 1 Tag“, „seit 40 Tagen“ */
export function relativeDays(days: number): string {
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  if (days < 0) return `seit ${-days} ${days === -1 ? "Tag" : "Tagen"}`;
  return `in ${days} Tagen`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unbekannter Fehler";
}

/** Nutzungsdauer „2,5“ oder „2.5“ Jahre in ganzen Monaten; null, wenn leer, nicht positiv oder kein ganzer Monat */
export function parseUsefulLifeMonths(years: string): number | null {
  const months = Number(years.trim().replace(",", ".")) * 12;
  return years.trim() !== "" && Number.isInteger(months) && months > 0 ? months : null;
}
