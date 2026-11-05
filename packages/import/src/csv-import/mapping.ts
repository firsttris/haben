import type { CsvRow } from "./read.ts";
import { formulaProblem } from "./values.ts";

/** Ein Feld in Haben, auf das eine Spalte der Datei gelegt werden kann */
export interface ImportField {
  key: string;
  label: string;
  /** Kurzer Hinweis unter der Auswahl, etwa zum Format */
  hint?: string;
  /** Spaltennamen, bei denen Haben die Spalte vorschlägt; verglichen mit normalizeColumnName */
  aliases: readonly string[];
}

/** Feld → Index der Spalte; null = nicht übernehmen */
export type ColumnMapping = Record<string, number | null>;

/**
 * Spaltenname für den Vergleich: klein, Umlaute als ae/oe/ue/ss, ohne Leerraum und Satzzeichen. Anders als bei den
 * Kontoauszügen bleibt ein Klammerzusatz stehen: „Nutzungsdauer (Monate)“ ist nicht „Nutzungsdauer (Jahre)“.
 */
export function normalizeColumnName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

/** Vorschlag nach Spaltennamen; jede Spalte geht an höchstens ein Feld, das erste in der Reihenfolge der Felder */
export function suggestMapping(header: readonly string[], fields: readonly ImportField[]): ColumnMapping {
  const names = header.map(normalizeColumnName);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const field of fields) {
    const aliases = field.aliases.map(normalizeColumnName);
    const index = names.findIndex((name, i) => !used.has(i) && aliases.includes(name));
    mapping[field.key] = index >= 0 ? index : null;
    if (index >= 0) used.add(index);
  }
  return mapping;
}

/** Nur bekannte Felder und vorhandene Spalten; eine Spalte zweimal zugeordnet ist ein Bedienfehler */
export function mappingProblem(mapping: ColumnMapping, header: readonly string[], fields: readonly ImportField[]): string | null {
  const seen = new Map<number, string>();
  for (const field of fields) {
    const index = mapping[field.key];
    if (index === null || index === undefined) continue;
    if (!Number.isInteger(index) || index < 0 || index >= header.length) return `${field.label}: Spalte gibt es nicht`;
    const other = seen.get(index);
    if (other) return `Die Spalte „${header[index]}“ ist ${other} und ${field.label} zugeordnet`;
    seen.set(index, field.label);
  }
  return null;
}

/**
 * Liest die Felder einer Zeile. `text` prüft auf Formeln (CSV-Injection) und sammelt die Meldung in `errors`, damit die
 * Umsetzung je Art nur noch die fachlichen Regeln enthält.
 */
export function rowReader(row: CsvRow, mapping: ColumnMapping, fields: readonly ImportField[]) {
  const errors: string[] = [];
  const label = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  const raw = (key: string): string => {
    const index = mapping[key];
    return index === null || index === undefined ? "" : (row.cells[index] ?? "").trim();
  };
  const text = (key: string): string => {
    const value = raw(key);
    const problem = formulaProblem(value, label(key));
    if (problem) errors.push(problem);
    return value;
  };
  return { raw, text, errors, label };
}
