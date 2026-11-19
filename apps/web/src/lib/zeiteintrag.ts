import { LEGACY_SOURCE } from "./altbestand.ts";

/** Hinweiszeile unter Kunde und Tätigkeit in der Liste der Zeiteinträge: Projekt · nicht abrechenbar */
export function serviceEntryNote(entry: { project: string; nonBillable: boolean }): string {
  return [entry.project, entry.nonBillable && "nicht abrechenbar"].filter(Boolean).join(" · ");
}

/** Herkunft eines Eintrags beim Bearbeiten: Quellen aus dem Umzug tragen ihren Schlüssel („fastbill“), solche über die API den Namen des Programms */
export function serviceEntrySource(source: string): string {
  return Object.hasOwn(LEGACY_SOURCE, source) ? LEGACY_SOURCE[source as keyof typeof LEGACY_SOURCE].name : source;
}
