import type { Cents } from "@haben/core";
import { StatementParseError } from "./errors.ts";

/** Fasst Leerraum zusammen; Banken füllen Zeilenumbrüche im Verwendungszweck mit Leerzeichen auf. */
export function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeIban(value: string | undefined): string | undefined {
  const iban = (value ?? "").replace(/\s+/g, "").toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban) ? iban : undefined;
}

/** Spaltenname ohne Klammerzusatz, Gender-Stern und Satzzeichen: "Betrag (€)" → "betrag". */
export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9äöüß]/g, "");
}

function joinCents(negative: boolean, whole: string, fraction: string): Cents {
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return Number.NaN;
  return negative && cents !== 0 ? -cents : cents;
}

function stripAmount(input: string): { negative: boolean; body: string } {
  let body = input
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/€|EUR/gi, "")
    .replace(/[\u2212\u2013]/g, "-");
  let negative = false;
  if (body.startsWith("-")) {
    negative = true;
    body = body.slice(1);
  } else if (body.startsWith("+")) {
    body = body.slice(1);
  } else if (body.endsWith("-")) {
    negative = true;
    body = body.slice(0, -1);
  }
  return { negative, body };
}

/**
 * Liest einen deutsch geschriebenen Betrag in Cent: "1.234,56", "-3.000,00", "4.760,00 €",
 * "23.418,72 EUR", "12,5", "100". Gibt null zurück, wenn die Eingabe kein Betrag ist.
 */
export function parseGermanAmount(input: string): Cents | null {
  const { negative, body } = stripAmount(input);
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(body)) return null;
  const [whole = "0", fraction = ""] = body.replace(/\./g, "").split(",");
  const cents = joinCents(negative, whole, fraction);
  return Number.isNaN(cents) ? null : cents;
}

/** Liest einen Betrag mit Dezimalpunkt in Cent: "-12.5", "1234.56", "1,234.56". */
export function parseDotAmount(input: string): Cents | null {
  const { negative, body } = stripAmount(input);
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(body)) return null;
  const [whole = "0", fraction = ""] = body.replace(/,/g, "").split(".");
  const cents = joinCents(negative, whole, fraction);
  return Number.isNaN(cents) ? null : cents;
}

function isValidDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** "01.10.26", "01.10.2026" oder "2026-10-01" (auch mit Uhrzeit) → "2026-10-01"; sonst null. */
export function parseDate(input: string): string | null {
  const value = input.trim();
  let year: number;
  let month: number;
  let day: number;
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(value);
  if (german) {
    day = Number(german[1]);
    month = Number(german[2]);
    year = Number(german[3]);
    if (german[3]!.length === 2) year += 2000;
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    return null;
  }
  if (!isValidDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function requireDate(input: string | undefined, where: string): string {
  const date = parseDate(input ?? "");
  if (!date) throw new StatementParseError(`Ungültiges Datum „${input ?? ""}“ (${where}).`);
  return date;
}

export function minMaxDate(dates: string[]): { from?: string; to?: string } {
  if (dates.length === 0) return {};
  const sorted = [...dates].sort();
  return { from: sorted[0], to: sorted[sorted.length - 1] };
}
