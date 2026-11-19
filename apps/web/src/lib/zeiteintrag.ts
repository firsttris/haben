import { LEGACY_SOURCE } from "./altbestand.ts";

/** Hinweiszeile unter Kunde und Tätigkeit in der Liste der Zeiteinträge: Projekt · nicht abrechenbar */
export function serviceEntryNote(entry: { project: string; nonBillable: boolean }): string {
  return [entry.project, entry.nonBillable && "nicht abrechenbar"].filter(Boolean).join(" · ");
}

// Quellen, aus denen ein Umzug Zeiteinträge übernimmt (#1522). Nur sie bekommen den Namen des Programms: Über die API
// kann jeder Text als Quelle kommen, auch einer, der wie ein anderer Schlüssel aus dem Archiv heißt („import“).
const MIGRATED_TIME_SOURCES: Record<string, string> = { fastbill: LEGACY_SOURCE.fastbill.name };

/** Herkunft eines Eintrags beim Bearbeiten: Umzug mit dem Namen des Programms („fastbill“ → FastBill), API wie übergeben */
export function serviceEntrySource(source: string): string {
  return Object.hasOwn(MIGRATED_TIME_SOURCES, source) ? (MIGRATED_TIME_SOURCES[source] ?? source) : source;
}
