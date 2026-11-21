import type { ManualKind } from "@haben/core";
import { formatDate } from "../../../lib/format.ts";

/**
 * Fehler am Tag einer manuellen Buchung (neu.tsx): fehlt, liegt in der Zukunft oder ist bei einer Eröffnungsbuchung nicht der 1. Januar.
 * Ohne vollständiges Datum fehlt es: Die Wahl der Eröffnungsbuchung macht aus einem leeren Feld „-01-01“, das Feld zeigt dann nichts.
 */
export function buchungsdatumFehler(date: string, today: string, kind: ManualKind): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Wähle das Datum.";
  if (date > today) return `Wähle einen Tag bis ${formatDate(today)}.`;
  return kind === "eroeffnung" && !date.endsWith("-01-01") ? "Eine Eröffnungsbuchung steht am 1. Januar; wähle den 1. Januar des Jahres." : null;
}
