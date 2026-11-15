/*
 * Betrieb: Stand einer Instanz für Betreiber (Version, ERiC, letzte Sicherung), ausgegeben von `haben status`.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { betriebsStatus, statusAlsText, type BetriebsStatus, type BetriebsStatusOptions } from "./status.ts";
export { appVersionsForYear, listAppVersions, type AppVersionEntry } from "./versionen.ts";
