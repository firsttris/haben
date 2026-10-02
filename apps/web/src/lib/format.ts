const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const longDateFormat = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

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
