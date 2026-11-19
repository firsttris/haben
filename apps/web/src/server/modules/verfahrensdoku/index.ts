/*
 * Verfahrensdokumentation aus der eigenen Instanz (#860): Angaben zum Betrieb speichern, Dokument aus dem Stand der
 * Instanz erzeugen, als Markdown für Download und Jahresarchiv.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { loadProcedureDetails, procedureDetailsSchema, putProcedureDetails, saveProcedureDetails, type ProcedureDetails } from "./angaben.ts";
export { buildProcedureDocument, procedureDocument, procedureMarkdown } from "./dokument.ts";
export { readInstanzStand, type InstanzStand } from "./stand.ts";
