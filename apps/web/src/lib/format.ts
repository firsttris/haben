// Immer deutsche Zeit: Server und Browser formatieren sonst je nach Zeitzone unterschiedlich (Hydration-Fehler)
const timeZone = "Europe/Berlin";
const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone });
const longDateFormat = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone });
const dateTimeFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone });

export const formatDate = (value: string | Date) => dateFormat.format(new Date(value));
export const formatLongDate = (value: string | Date) => longDateFormat.format(new Date(value));
export const formatDateTime = (value: string | Date) => dateTimeFormat.format(new Date(value));

/** Tage bis zu einem Datum (negativ = vorbei) */
export function daysUntil(value: string | Date, today = new Date()): number {
  const target = new Date(value);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const end = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((end - start) / 86_400_000);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unbekannter Fehler";
}

/** Nutzungsdauer „2,5“ oder „2.5“ Jahre in ganzen Monaten; null, wenn leer, nicht positiv oder kein ganzer Monat */
export function parseUsefulLifeMonths(years: string): number | null {
  const months = Number(years.trim().replace(",", ".")) * 12;
  return years.trim() !== "" && Number.isInteger(months) && months > 0 ? months : null;
}
