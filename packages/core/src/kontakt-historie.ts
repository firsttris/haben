import type { Cents } from "./money.ts";

/**
 * Ein Eintrag in der Übersicht eines Kontakts (#587): Rechnung, Beleg oder archivierter Beleg aus dem Altbestand.
 * Das Jahr ist das Rechnungs- bzw. Belegdatum; die Übersicht ist keine EÜR und kennt weder Zahlungsdatum noch Ist und Soll.
 */
export interface ContactHistoryEntry {
  id: string;
  /** Rechnungs- bzw. Belegdatum, JJJJ-MM-TT */
  date: string;
  number: string;
  /** Aus dem Archiv des Umzugs statt aus Haben */
  archive: boolean;
  /** Storno, Korrektur und Gutschrift negativ */
  net: Cents;
  gross: Cents;
  /** false: steht in der Liste, zählt aber nicht, etwa ein stornierter Beleg */
  counts: boolean;
}

export interface ContactYearTotal {
  year: number;
  /** Zahl der Einträge, die zählen */
  count: number;
  net: Cents;
  gross: Cents;
  /** Davon aus dem Altbestand */
  archiveNet: Cents;
  archiveGross: Cents;
}

const yearOf = (date: string) => Number(date.slice(0, 4));

/** Summen je Jahr, das neueste zuerst; ein Jahr nur mit nicht zählenden Einträgen steht mit 0 da */
export function contactYearTotals(entries: readonly ContactHistoryEntry[]): ContactYearTotal[] {
  const byYear = new Map<number, ContactYearTotal>();
  for (const entry of entries) {
    const year = yearOf(entry.date);
    const total = byYear.get(year) ?? { year, count: 0, net: 0, gross: 0, archiveNet: 0, archiveGross: 0 };
    byYear.set(year, total);
    if (!entry.counts) continue;
    total.count += 1;
    total.net += entry.net;
    total.gross += entry.gross;
    if (entry.archive) {
      total.archiveNet += entry.net;
      total.archiveGross += entry.gross;
    }
  }
  return [...byYear.values()].sort((a, b) => b.year - a.year);
}

/** Einträge eines Jahres, das neueste Datum zuerst, am selben Tag die höhere Nummer */
export function contactEntriesOfYear<T extends ContactHistoryEntry>(entries: readonly T[], year: number): T[] {
  return entries
    .filter((entry) => yearOf(entry.date) === year)
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number, "de", { numeric: true }));
}

/** Das gezeigte Jahr: das gewählte, sonst das neueste mit Einträgen, ohne beides keines */
export function contactHistoryYear(totals: readonly ContactYearTotal[], requested?: number): number | null {
  return requested ?? totals[0]?.year ?? null;
}
