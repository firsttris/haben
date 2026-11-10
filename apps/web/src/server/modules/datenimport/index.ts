/*
 * Datenimport: Stammdaten aus CSV und geprüfte Belegbestände über die Betreiber-CLI. Nutzt die Geschäftslogik der
 * besitzenden Module (stammdaten, archiv, buchhaltung) und speichert unveränderliche Herkunftsnachweise.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { CsvImportError, csvImportOptionsSchema, previewCsvImport, runCsvImport, type CsvImportOptions, type CsvImportPreview } from "./csv-import.ts";
export { runExternalImport, type ExternalImportResult } from "./external-import.ts";
export { ExternalImportError, validateExternalImport } from "./external-validation.ts";
export { externalImportSchema, type ExternalImport } from "./external-schema.ts";
