/*
 * Kennung und Version der Einstellungsdatei (#488), ohne Datenbank, damit felder.test.ts sie liest. Die Version steigt,
 * wenn eine ältere Instanz die neue Datei nicht mehr richtig übernähme, etwa weil ein Feld dazukommt, das sie still
 * verwürfe; der Import muss Dateien älterer Versionen weiter lesen.
 */
export const SETTINGS_EXPORT_FORMAT = "haben-einstellungen";
export const SETTINGS_EXPORT_VERSION = 1;
