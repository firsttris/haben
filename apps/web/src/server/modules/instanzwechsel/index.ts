/*
 * Instanzwechsel: Einstellungen und Stammdaten in eine neue Instanz übernehmen (#488), etwa von einer Testinstanz in
 * den Echtbetrieb. Der Export liest die Tabellen anderer Module, der Import schreibt über deren Funktionen in einer
 * Transaktion und nur in eine neue Instanz (neu.ts); Zugangsdaten und Gebuchtes bleiben draußen (felder.ts).
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { exportSettings, SETTINGS_EXPORT_FORMAT, SETTINGS_EXPORT_VERSION, settingsExportFilename, type SettingsExport } from "./export.ts";
export { importSettings, InstanzwechselError, type SettingsImportResult } from "./import.ts";
export { MAX_SETTINGS_FILE_BYTES, SettingsFileError } from "./lesen.ts";
export { schonAngelegt } from "./neu.ts";
