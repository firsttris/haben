/*
 * Datenimport: Kontakte, Artikel und Anlagen aus CSV. Setzt Lesen und Prüfen aus @haben/import mit den Modulen zusammen,
 * die die Tabellen besitzen (stammdaten, buchhaltung); schreibt keine eigenen Tabellen.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { CsvImportError, csvImportOptionsSchema, previewCsvImport, runCsvImport, type CsvImportOptions, type CsvImportPreview } from "./csv-import.ts";
