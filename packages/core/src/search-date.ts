function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Erkennt deutsche („14.11.2026“, „1.2.2026“) und ISO-Datumseingaben („2026-11-14“) für die Suche und gibt ein
 * gültiges ISO-Datum („YYYY-MM-DD“) zurück; ungültige Kalendertage oder Nicht-Daten liefern null.
 */
export function parseDateSearch(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (de) {
    const day = Number(de[1]);
    const month = Number(de[2]);
    const year = Number(de[3]);
    return isValidCalendarDate(year, month, day) ? formatIsoDate(year, month, day) : null;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return isValidCalendarDate(year, month, day) ? formatIsoDate(year, month, day) : null;
  }

  return null;
}
