import { DatevParseError, type DatevHeader } from "./datev.ts";

/* Daten im DATEV-Format: Kopfzeile (JJJJMMTT, Zeitstempel) und Belegdatum (TTMM bzw. TTMMJJJJ) */

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "YYYYMMDD" → "YYYY-MM-DD"; leer → null */
export function compactDate(value: string, label: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  const date = m ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  if (!date) throw new DatevParseError(`Kopfzeile: ungültiges Datum „${v}“ (${label}).`);
  return date;
}

/** "YYYYMMDDHHMMSSFFF" → "YYYY-MM-DDTHH:MM:SS.FFF"; leer oder unlesbar → null */
export function timestamp(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})?$/.exec(value.trim());
  if (!m || !isoDate(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7] ?? "000"}`;
}

/**
 * Belegdatum "DDMM" (führende Null darf fehlen) oder "DDMMYYYY". Das Jahr ergibt sich aus dem
 * Wirtschaftsjahr: Monate vor dem Beginnmonat gehören ins folgende Kalenderjahr. Liegt das Datum
 * außerhalb von Datum vom/bis, gilt das andere Kalenderjahr des Zeitraums, sonst Warnung.
 */
export function resolveDate(value: string, header: DatevHeader, where: string, warnings: string[]): string {
  const v = value.trim();
  const full = /^(\d{2})(\d{2})(\d{4})$/.exec(v);
  if (full) {
    const date = isoDate(Number(full[3]), Number(full[2]), Number(full[1]));
    if (!date) throw new DatevParseError(`${where}: ungültiges Belegdatum „${v}“.`);
    return date;
  }
  if (!/^\d{3,4}$/.test(v)) throw new DatevParseError(`${where}: ungültiges Belegdatum „${v}“.`);
  const ddmm = v.padStart(4, "0");
  const day = Number(ddmm.slice(0, 2));
  const month = Number(ddmm.slice(2));
  const startYear = Number(header.fiscalYearStart.slice(0, 4));
  const startMonth = Number(header.fiscalYearStart.slice(5, 7));
  const year = month < startMonth ? startYear + 1 : startYear;
  const date = isoDate(year, month, day);
  // 29.02. nur im Schaltjahr; ein unmögliches Datum ist ein Fehler
  if (!date && !isoDate(2024, month, day)) throw new DatevParseError(`${where}: ungültiges Belegdatum „${v}“.`);
  const { dateFrom, dateTo } = header;
  const inRange = (d: string) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  if (date && inRange(date)) return date;
  const years = [dateFrom, dateTo].filter((d) => d !== null).map((d) => Number(d.slice(0, 4)));
  for (const y of [...new Set(years)]) {
    const other = isoDate(y, month, day);
    if (other && inRange(other)) return other;
  }
  if (!date) throw new DatevParseError(`${where}: ungültiges Belegdatum „${v}“.`);
  warnings.push(`${where}: Belegdatum ${date} liegt außerhalb des Zeitraums ${dateFrom ?? "…"} bis ${dateTo ?? "…"}.`);
  return date;
}
