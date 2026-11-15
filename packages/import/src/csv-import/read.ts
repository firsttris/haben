import { isBlankRow, parseCsv } from "../csv.ts";

/**
 * CSV-Datei für den Import von Kontakten, Artikeln und Anlagen lesen: Kodierung und Trennzeichen erkennen, Kopfzeile
 * und Datenzeilen trennen. Fehler kommen als Wert zurück, damit die Vorschau sie anzeigen kann.
 */

export type CsvEncoding = "utf-8-bom" | "utf-8" | "windows-1252" | "utf-16";
export type CsvEncodingChoice = "auto" | "utf-8" | "windows-1252";
export type CsvDelimiter = ";" | "," | "\t";
export type CsvDelimiterChoice = "auto" | CsvDelimiter;

export const CSV_DELIMITERS: readonly CsvDelimiter[] = [";", ",", "\t"];

export const CSV_ENCODING_LABEL: Record<CsvEncoding, string> = {
  "utf-8-bom": "UTF-8 mit BOM",
  "utf-8": "UTF-8",
  "windows-1252": "Windows-1252",
  "utf-16": "UTF-16",
};

export const CSV_DELIMITER_LABEL: Record<CsvDelimiter, string> = { ";": "Semikolon", ",": "Komma", "\t": "Tabulator" };

/** Mehr Zeilen braucht kein Kontakt- oder Artikelbestand eines Freiberuflers; schützt den Server vor Riesendateien */
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export interface CsvRow {
  /** Nummer des Datensatzes in der Datei, die Kopfzeile ist 1 */
  line: number;
  cells: string[];
}

export interface CsvTable {
  encoding: CsvEncoding;
  delimiter: CsvDelimiter;
  header: string[];
  rows: CsvRow[];
}

export type CsvReadResult = { ok: true; table: CsvTable } | { ok: false; error: string };

export function decodeCsvBytes(bytes: Uint8Array, choice: CsvEncodingChoice): { text: string; encoding: CsvEncoding } | { error: string } {
  const [b0, b1, b2] = bytes;
  // Ein BOM sagt die Kodierung sicher an, auch gegen eine falsche Auswahl
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8-bom" };
  if (b0 === 0xff && b1 === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16" };
  if (b0 === 0xfe && b1 === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16" };
  if (choice === "windows-1252") return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    if (choice === "utf-8") return { error: "Die Datei ist kein gültiges UTF-8. Wähle als Kodierung Windows-1252." };
    // Excel unter Windows speichert „CSV (Trennzeichen-getrennt)“ in Windows-1252
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

/**
 * Trennzeichen, bei dem die ersten Zeilen am gleichmäßigsten in mehrere Spalten zerfallen. Bei Gleichstand gewinnt das
 * Semikolon, das deutsche Excel und Lexware Office schreiben.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = text.slice(0, 64 * 1024);
  let best: { delimiter: CsvDelimiter; score: number } = { delimiter: ";", score: 0 };
  for (const delimiter of CSV_DELIMITERS) {
    const rows = parseCsv(sample, delimiter)
      .filter((r) => !isBlankRow(r))
      .slice(0, 50);
    const width = rows[0]?.length ?? 0;
    if (width < 2) continue;
    const score = rows.filter((r) => r.length === width).length * 1000 + width;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

export function readCsvTable(bytes: Uint8Array, options: { encoding: CsvEncodingChoice; delimiter: CsvDelimiterChoice }): CsvReadResult {
  if (bytes.length === 0) return { ok: false, error: "Die Datei ist leer." };
  if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, error: "Die Datei ist größer als 5 MB." };
  const decoded = decodeCsvBytes(bytes, options.encoding);
  if ("error" in decoded) return { ok: false, error: decoded.error };
  const delimiter = options.delimiter === "auto" ? detectDelimiter(decoded.text) : options.delimiter;
  const records = parseCsv(decoded.text, delimiter).map((cells, i) => ({ line: i + 1, cells }));
  const [head, ...rest] = records.filter((r) => !isBlankRow(r.cells));
  if (!head) return { ok: false, error: "Die Datei enthält keine Zeilen." };
  if (rest.length === 0) return { ok: false, error: "Die Datei enthält nur eine Kopfzeile, keine Daten." };
  if (rest.length > MAX_IMPORT_ROWS) return { ok: false, error: `Höchstens ${MAX_IMPORT_ROWS} Zeilen je Datei; teile die Datei auf.` };
  return { ok: true, table: { encoding: decoded.encoding, delimiter, header: head.cells.map((c) => c.trim()), rows: rest } };
}
