/*
 * Instanzwechsel: Einstellungen und Stammdaten in eine neue Instanz übernehmen (#488), etwa von einer Testinstanz in
 * den Echtbetrieb. Liest die Tabellen anderer Module; Zugangsdaten und Gebuchtes bleiben draußen (felder.ts).
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { exportSettings, SETTINGS_EXPORT_FORMAT, SETTINGS_EXPORT_VERSION, settingsExportFilename, type SettingsExport } from "./export.ts";
