import { LEGACY_SOURCE } from "./altbestand.ts";

/** Hinweiszeile unter Kunde und Tätigkeit in der Liste der Zeiteinträge: Projekt · nicht abrechenbar · Quelle */
export function serviceEntryNote(entry: { project: string; nonBillable: boolean; source: string | null }): string {
  return [entry.project, entry.nonBillable && "nicht abrechenbar", entry.source && `aus ${sourceName(entry.source)}`].filter(Boolean).join(" · ");
}

// Einträge aus dem Umzug tragen den Schlüssel der Quelle („fastbill“), solche über die API den Namen des Programms
function sourceName(source: string): string {
  return Object.hasOwn(LEGACY_SOURCE, source) ? LEGACY_SOURCE[source as keyof typeof LEGACY_SOURCE].name : source;
}
