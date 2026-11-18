import { csvDecimal } from "@haben/core";

/*
 * CSV des Jahresarchivs: UTF-8 mit BOM, Semikolon, Dezimalkomma, ISO-Daten, Quoting nach RFC 4180. Eigene Datei, damit
 * Teile des Archivs (etwa export-bankimporte.ts) sie nutzen, ohne export.ts zu importieren.
 */

export type CsvValue = string | number | boolean | null | undefined;

export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "boolean" ? (value ? "ja" : "nein") : String(value);
  // Text, den Tabellenprogramme als Formel lesen würden, entschärfen; negative Beträge bleiben Zahlen
  const text = typeof value === "string" && /^[=+@\t\r]|^-(?!\d+(,\d+)?$)/.test(raw) ? `'${raw}` : raw;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: CsvValue[]): string {
  return `${values.map(csvField).join(";")}\r\n`;
}

const encoder = new TextEncoder();
export const BOM = "﻿";

export function csv(header: string[], rows: CsvValue[][]): Uint8Array {
  return encoder.encode(BOM + csvLine(header) + rows.map(csvLine).join(""));
}

/** Cent als Dezimalzahl mit Komma, ohne Tausenderpunkt: 123456 → "1234,56" */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return csvDecimal(cents);
}

/** Zeitpunkt als ISO 8601 in UTC, leer ohne Wert */
export const iso = (value: Date | null | undefined) => (value ? value.toISOString() : "");

/** Wert als JSON, leer ohne Wert */
export const json = (value: unknown) => (value === null || value === undefined ? "" : JSON.stringify(value));
