import { type BasisPoints, type Cents, UNITS, type UnitLabel } from "@haben/core";
import { parseDate, parseDotAmount, parseGermanAmount } from "../text.ts";

/**
 * Werte aus Zellen einer Import-Datei. Jede Funktion liefert den Wert oder eine Meldung für die Vorschau; leere Zellen
 * behandelt der Aufrufer.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error });

/**
 * Betrag in Cent, deutsch geschrieben („1.234,56“, „12,5“, „100 €“). Ein Punkt gilt nur als Dezimalpunkt, wenn er mit
 * ein oder zwei Nachkommastellen eindeutig ist („12.50“). „1.234“ ist deutsch 1.234 €, englisch 1,234 €; in einer Datei
 * mit Dezimalpunkt („1.500“ = 1,50 €) ergäbe das deutsche Lesen das Tausendfache, also lieber ablehnen.
 */
export function parseImportAmount(raw: string, label: string): Parsed<Cents> {
  if (/^[+-]?\d{1,3}\.\d{3}-?$/.test(raw.replace(/[\s  €]|EUR/gi, ""))) {
    return fail(`${label}: „${raw}“ ist mehrdeutig; bitte mit Dezimalkomma schreiben wie 1.234,00`);
  }
  const german = parseGermanAmount(raw);
  if (german !== null) return ok(german);
  const compact = raw.replace(/[\s €]|EUR/gi, "");
  if (/^-?\d+\.\d{1,2}$/.test(compact)) {
    const dot = parseDotAmount(compact);
    if (dot !== null) return ok(dot);
  }
  return fail(`${label}: „${raw}“ ist kein Betrag wie 1.234,56`);
}

/** Datum als TT.MM.JJJJ oder JJJJ-MM-TT; zweistellige Jahre sind bei Anschaffungen von 1999 oder 2099 nicht eindeutig */
export function parseImportDate(raw: string, label: string): Parsed<string> {
  const value = raw.trim();
  if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(value) && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail(`${label}: „${raw}“ ist kein Datum wie 31.12.2025`);
  const date = parseDate(value);
  return date ? ok(date) : fail(`${label}: den ${raw} gibt es nicht`);
}

/** Steuersatz in Basispunkten: „19“, „19 %“, „19,00“, „7%“, „0“ */
export function parseImportTaxRate(raw: string): Parsed<0 | 700 | 1900> {
  // „USt 19%“ ist die Steuerart der Artikelvorlage von Lexware Office
  // (https://help.lexware.de/de-form/articles/625906-fehlercodes-beim-artikel-import-csv-beheben)
  const match = /^(?:(?:USt|MwSt)\.?\s*)?(\d{1,2})(?:[,.]0{1,2})?\s*%?$/i.exec(raw.trim());
  const rate = match ? ((Number(match[1]) * 100) as BasisPoints) : null;
  if (rate === 1900 || rate === 700 || rate === 0) return ok(rate);
  return fail(`Steuersatz: „${raw}“; möglich sind 19 %, 7 % und 0 %`);
}

const UNIT_ALIASES: Record<string, UnitLabel> = {
  std: "Std.",
  stunde: "Std.",
  stunden: "Std.",
  h: "Std.",
  tag: "Tag",
  tage: "Tag",
  tg: "Tag",
  monat: "Monat",
  monate: "Monat",
  mon: "Monat",
  stk: "Stk.",
  stck: "Stk.",
  stueck: "Stk.",
  stück: "Stk.",
  st: "Stk.",
  psch: "Psch.",
  pauschal: "Psch.",
  pauschale: "Psch.",
  km: "km",
  kilometer: "km",
};

/** Einheit aus dem Katalog von Haben (UNITS) oder eine eigene (#748), an der Bezeichnung erkannt; leer = Stück wie in Lexware Office */
export function parseImportUnit(raw: string, own: readonly string[] = []): Parsed<string> {
  const value = raw.trim();
  if (!value) return ok("Stk.");
  if (value in UNITS) return ok(value as UnitLabel);
  const custom = own.find((label) => label.toLowerCase() === value.toLowerCase());
  if (custom) return ok(custom);
  const unit = UNIT_ALIASES[value.toLowerCase().replace(/\./g, "")];
  return unit
    ? ok(unit)
    : fail(`Einheit: „${raw}“; möglich sind ${[...Object.keys(UNITS), ...own].join(", ")} oder eine neue unter Einstellungen › Rechnungen › Einheiten`);
}

const COUNTRIES: Record<string, string> = {
  deutschland: "DE",
  germany: "DE",
  "276": "DE",
  oesterreich: "AT",
  österreich: "AT",
  austria: "AT",
  "040": "AT",
  "40": "AT",
  schweiz: "CH",
  switzerland: "CH",
  "756": "CH",
  niederlande: "NL",
  frankreich: "FR",
  belgien: "BE",
  luxemburg: "LU",
  italien: "IT",
  spanien: "ES",
  polen: "PL",
  daenemark: "DK",
  dänemark: "DK",
  tschechien: "CZ",
  irland: "IE",
  schweden: "SE",
  "vereinigtes königreich": "GB",
  grossbritannien: "GB",
  großbritannien: "GB",
  usa: "US",
};

/** Ländercode nach ISO 3166-1 (DE, auch 276 wie in Lexware Office oder „Deutschland“); leer = DE */
export function parseImportCountry(raw: string): Parsed<string> {
  const value = raw.trim();
  if (!value) return ok("DE");
  if (/^[A-Za-z]{2}$/.test(value)) return ok(value.toUpperCase());
  const code = COUNTRIES[value.toLowerCase()];
  return code ? ok(code) : fail(`Land: „${raw}“; bitte als Ländercode wie DE`);
}

/**
 * Sieht der Text wie eine Formel aus, die eine Tabellenkalkulation beim nächsten Export ausführen würde (CSV-Injection,
 * OWASP)? „=“ und „@“ am Anfang immer, „+“ und „-“ nur, wenn danach keine Zahl folgt (Telefonnummer, negativer Wert).
 */
export function formulaProblem(value: string, label: string): string | null {
  if (/^[=@]/.test(value) || /^[+-](?![\d\s.,/()]*$)/.test(value)) {
    return `${label}: beginnt mit „${value[0]}“ und sähe in Excel wie eine Formel aus; Zeichen am Anfang entfernen`;
  }
  return null;
}
