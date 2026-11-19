import { isBlankRow, parseCsv } from "../csv.ts";
import { type ColumnMapping, suggestMapping } from "../csv-import/mapping.ts";
import { CSV_DELIMITERS, type CsvDelimiter, type CsvEncoding, type CsvRow, decodeCsvBytes } from "../csv-import/read.ts";
import { parseDate, parseDotAmount, parseGermanAmount } from "../text.ts";
import { type AmountFormat, BANK_CSV_FIELDS, type BankCsvMapping } from "./felder.ts";

/** Bis hierhin sucht Haben die Kopfzeile, wie die Erkennung der bekannten Banken (findHeaderRow) */
const HEADER_SEARCH = 40;

export interface BankCsvFile {
  encoding: CsvEncoding;
  delimiter: CsvDelimiter;
  /** Nicht leere Datensätze; `line` zählt wie die Datei, die erste Zeile ist 1 */
  records: CsvRow[];
}

/**
 * Trennzeichen, bei dem die meisten der ersten Zeilen in mehrere Spalten zerfallen. Anders als beim CSV-Import für
 * Kontakte zählt nicht die erste Zeile: Viele Banken schreiben vor die Tabelle einen Kopfblock mit einer Spalte.
 */
function detectDelimiter(text: string): CsvDelimiter {
  const sample = text.slice(0, 64 * 1024);
  let best: { delimiter: CsvDelimiter; score: number } = { delimiter: ";", score: 0 };
  for (const delimiter of CSV_DELIMITERS) {
    const rows = parseCsv(sample, delimiter)
      .filter((r) => !isBlankRow(r))
      .slice(0, 50);
    const split = rows.filter((r) => r.length >= 2);
    const score = split.length * 1000 + Math.max(0, ...split.map((r) => r.length));
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

export function readBankCsv(bytes: Uint8Array): BankCsvFile | { error: string } {
  const decoded = decodeCsvBytes(bytes, "auto");
  if ("error" in decoded) return decoded;
  if (decoded.text.trimStart().startsWith("<")) return { error: "Die Datei ist XML, keine CSV." };
  // PDF, XLSX (ZIP) und andere Binärdateien: sonst böte der Bankimport für sie die Spaltenzuordnung an
  const binary = ["%PDF", "PK\u0003\u0004"].some((magic) => decoded.text.startsWith(magic)) || decoded.text.includes("\u0000");
  if (binary) return { error: "Die Datei ist keine CSV." };
  const delimiter = detectDelimiter(decoded.text);
  const records = parseCsv(decoded.text, delimiter)
    .map((cells, i) => ({ line: i + 1, cells }))
    .filter((r) => !isBlankRow(r.cells));
  if (records.length < 2) return { error: "Die Datei enthält keine Tabelle mit Kopfzeile und Umsätzen." };
  return { encoding: decoded.encoding, delimiter, records };
}

const filledCells = (cells: string[]) => cells.filter((c) => c.trim() !== "").length;

/** Kopfzeile ohne Leerraum an den Rändern und ohne leere Spalten am Ende */
export function headerOf(cells: string[]): string[] {
  const header = cells.map((c) => c.trim());
  while (header.length > 0 && header[header.length - 1] === "") header.pop();
  return header;
}

/**
 * Vorschlag für die Kopfzeile: die erste der ersten Zeilen ohne Datum, die so viele gefüllte Zellen hat wie keine
 * andere ohne Datum. Ein Kopfblock davor („Umsätze Girokonto“, „Zeitraum: …“) hat weniger Zellen, die Umsätze darunter
 * haben ein Datum.
 */
export function guessHeaderRow(records: CsvRow[]): number {
  const candidates = records
    .slice(0, HEADER_SEARCH)
    .map((r, index) => ({ index, filled: filledCells(r.cells), dated: r.cells.some((c) => parseDate(c) !== null) }));
  const undated = candidates.filter((c) => !c.dated);
  const widest = Math.max(0, ...undated.map((c) => c.filled));
  return undated.find((c) => c.filled === widest && widest >= 2)?.index ?? 0;
}

/** Gleiche Kopfzeile: dieselben Namen in derselben Reihenfolge */
export function sameHeader(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/** Zeile mit genau der gespeicherten Kopfzeile, oder -1 */
export function findSavedHeader(records: CsvRow[], header: readonly string[]): number {
  return records.slice(0, HEADER_SEARCH).findIndex((r) => sameHeader(headerOf(r.cells), header));
}

/** Datenzeilen unter der Kopfzeile, bis zu `limit` */
const sampleCells = (records: CsvRow[], headerRow: number, index: number | null | undefined, limit = 200) =>
  index === null || index === undefined
    ? []
    : records
        .slice(headerRow + 1, headerRow + 1 + limit)
        .map((r) => (r.cells[index] ?? "").trim())
        .filter((c) => c !== "");

/**
 * Zahlenformat aus den Beträgen: „12.50“ oder „1,234.56“ lesen nur als englisch, „12,50“ und „1.234,56“ nur als deutsch.
 * Ohne eindeutigen Wert bleibt es deutsch.
 */
export function guessAmountFormat(values: string[]): AmountFormat {
  const onlyEnglish = values.some((v) => parseDotAmount(v) !== null && parseGermanAmount(v) === null);
  const onlyGerman = values.some((v) => parseGermanAmount(v) !== null && parseDotAmount(v) === null);
  return onlyEnglish && !onlyGerman ? "en" : "de";
}

/**
 * Zuordnung nach den Spaltennamen. Manche Banken haben eine Spalte „Betrag“ und daneben „Soll“ und „Haben“, von denen
 * nur eine Seite gefüllt ist; dann gilt die Seite mit Werten.
 */
export function suggestBankMapping(records: CsvRow[], headerRow: number): BankCsvMapping {
  const header = headerOf(records[headerRow]?.cells ?? []);
  const columns: ColumnMapping = suggestMapping(header, BANK_CSV_FIELDS);
  const hasValues = (key: string) => sampleCells(records, headerRow, columns[key]).length > 0;
  if (columns.amount !== null && (columns.debit !== null || columns.credit !== null)) {
    if (hasValues("amount")) {
      columns.debit = null;
      columns.credit = null;
    } else {
      columns.amount = null;
    }
  }
  const amounts = ["amount", "debit", "credit"].flatMap((key) => sampleCells(records, headerRow, columns[key]));
  return { header, columns, amountFormat: guessAmountFormat(amounts) };
}

/**
 * Kopfzeile und Zuordnung, mit denen der Dialog beginnt: die am Konto gespeicherte, wenn ihre Kopfzeile in der Datei
 * steht, sonst ein Vorschlag. `chosen` ist eine von Hand gewählte Kopfzeile.
 */
export function initialMapping(
  records: CsvRow[],
  stored: BankCsvMapping | null,
  chosen?: number,
): { headerRow: number; mapping: BankCsvMapping; saved: boolean } {
  const storedRow = stored ? findSavedHeader(records, stored.header) : -1;
  const headerRow = Math.max(0, Math.min(chosen ?? (storedRow >= 0 ? storedRow : guessHeaderRow(records)), records.length - 2));
  if (stored && storedRow === headerRow) return { headerRow, mapping: stored, saved: true };
  return { headerRow, mapping: suggestBankMapping(records, headerRow), saved: false };
}

/** Erster Wert der Spalte unter der Kopfzeile, als Beispiel in der Auswahl */
export function sampleValue(records: CsvRow[], headerRow: number, index: number): string {
  return sampleCells(records, headerRow, index, 20)[0] ?? "";
}
