import { decodeText } from "./decode.ts";
import { parseGermanAmount } from "./text.ts";

/** Die Datei ist kein DATEV-Buchungsstapel oder ist beschädigt. */
export class DatevParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatevParseError";
  }
}

export interface DatevHeader {
  formatVersion: number;
  category: number;
  formatName: string;
  categoryVersion: number;
  /** Erzeugt am, lokale Zeit ohne Zeitzone: "2026-01-02T12:00:00.000" */
  createdAt: string | null;
  beraterNr: string;
  mandantNr: string;
  fiscalYearStart: string;
  accountLength: number;
  dateFrom: string | null;
  dateTo: string | null;
  description: string;
  currency: string;
  /** "SKR03", "SKR04" oder "" (unbekannt bzw. andere Kontenrahmen) */
  kontenrahmen: string;
}

export interface DatevBooking {
  /** Zeilennummer in der Datei (1-basiert), für Verweise auf das Original */
  row: number;
  /** Cent, immer positiv; die Richtung steht in side */
  amount: number;
  side: "S" | "H";
  currency: string;
  account: string;
  contraAccount: string;
  buKey: string;
  date: string;
  voucherField1: string;
  voucherField2: string;
  text: string;
  documentLink: string;
  costCenter1: string;
  costCenter2: string;
  euVatId: string;
  /** Basispunkte: 19 % → 1900 */
  euTaxRate: number | null;
  /** Alle nicht leeren Spalten nach Spaltenname, unverändert */
  raw: Record<string, string>;
}

export interface DatevStack {
  header: DatevHeader;
  bookings: DatevBooking[];
  warnings: string[];
}

/** Formatkategorien laut DATEV-Schnittstellenbeschreibung */
const CATEGORIES: Record<number, string> = {
  16: "Debitoren/Kreditoren",
  20: "Kontenbeschriftungen",
  21: "Buchungsstapel",
  46: "Zahlungsbedingungen",
  47: "Diverse Adressen",
  48: "Wiederkehrende Buchungen",
  65: "Buchungstextkonstanten",
};

/** Zeile mit ihrer Startzeile in der Datei; Felder in Anführungszeichen dürfen Zeilenumbrüche enthalten. */
interface Line {
  line: number;
  fields: string[];
}

/** CSV mit ";" und "" als Escape, wie parseCsv, aber mit Zeilennummern. */
function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStart = true;
  let line = 1;
  let start = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const atStart = fieldStart;
    fieldStart = !quoted && (c === ";" || c === "\n" || c === "\r");
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"' && atStart) {
      quoted = true;
    } else if (c === ";") {
      fields.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      fields.push(field);
      lines.push({ line: start, fields });
      fields = [];
      field = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
      line++;
      start = line;
    } else {
      field += c;
    }
  }
  if (field !== "" || fields.length > 0) {
    fields.push(field);
    lines.push({ line: start, fields });
  }
  return lines;
}

/** Spaltenname für den Vergleich: getrimmt, Leerraum zusammengefasst, Kleinschreibung */
function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

const pad = (n: number) => String(n).padStart(2, "0");

function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "YYYYMMDD" → "YYYY-MM-DD"; leer → null */
function compactDate(value: string, label: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  const date = m ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  if (!date) throw new DatevParseError(`Kopfzeile: ungültiges Datum „${v}“ (${label}).`);
  return date;
}

/** "YYYYMMDDHHMMSSFFF" → "YYYY-MM-DDTHH:MM:SS.FFF"; leer oder unlesbar → null */
function timestamp(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})?$/.exec(value.trim());
  if (!m || !isoDate(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7] ?? "000"}`;
}

function integer(value: string | undefined, label: string): number {
  const v = (value ?? "").trim();
  if (!/^\d+$/.test(v)) throw new DatevParseError(`Kopfzeile: ungültiger Wert „${v}“ (${label}).`);
  return Number(v);
}

function stripBom(text: string): string {
  return text.startsWith("﻿") ? text.slice(1) : text;
}

/** Schneller Test: beginnt die erste Zeile mit EXTF oder DTVF? */
export function isDatevFile(bytes: Uint8Array): boolean {
  const head = stripBom(decodeText(bytes.subarray(0, 16)));
  return /^"?(EXTF|DTVF)"?;/.test(head);
}

function parseHeader(fields: string[]): DatevHeader {
  const f = (n: number) => (fields[n - 1] ?? "").trim();
  if (f(1) !== "EXTF" && f(1) !== "DTVF") {
    throw new DatevParseError("Keine DATEV-Datei: Kopfzeile beginnt nicht mit EXTF");
  }
  const category = integer(f(3), "Formatkategorie");
  if (category !== 21) {
    const name = CATEGORIES[category] || f(4) || `Kategorie ${category}`;
    throw new DatevParseError(`Das ist ein DATEV-Export „${name}“, kein Buchungsstapel.`);
  }
  const fiscalYearStart = compactDate(f(13), "Wirtschaftsjahresbeginn");
  if (!fiscalYearStart) throw new DatevParseError("Kopfzeile: Wirtschaftsjahresbeginn fehlt.");
  // Feld 27 laut Schnittstellenbeschreibung; "03"/"04" bzw. "3"/"4"
  const skr = f(27).replace(/^0+/, "");
  return {
    formatVersion: integer(f(2), "Versionsnummer"),
    category,
    formatName: f(4),
    categoryVersion: integer(f(5), "Formatversion"),
    createdAt: timestamp(f(6)),
    beraterNr: f(11),
    mandantNr: f(12),
    fiscalYearStart,
    accountLength: f(14) === "" ? 0 : integer(f(14), "Sachkontenlänge"),
    dateFrom: compactDate(f(15), "Datum vom"),
    dateTo: compactDate(f(16), "Datum bis"),
    description: f(17),
    currency: f(22) || "EUR",
    kontenrahmen: skr === "3" ? "SKR03" : skr === "4" ? "SKR04" : "",
  };
}

/**
 * Belegdatum "DDMM" (führende Null darf fehlen) oder "DDMMYYYY". Das Jahr ergibt sich aus dem
 * Wirtschaftsjahr: Monate vor dem Beginnmonat gehören ins folgende Kalenderjahr. Liegt das Datum
 * außerhalb von Datum vom/bis, gilt das andere Kalenderjahr des Zeitraums, sonst Warnung.
 */
function resolveDate(value: string, header: DatevHeader, where: string, warnings: string[]): string {
  const v = value.trim();
  const full = /^(\d{2})(\d{2})(\d{4})$/.exec(v);
  if (full) {
    const date = isoDate(Number(full[3]), Number(full[2]), Number(full[1]));
    if (!date) throw new DatevParseError(`${where}: ungültiges Belegdatum „${v}“.`);
    return date;
  }
  if (!/^\d{3,4}$/.test(v)) throw new DatevParseError(`${where}: ungültiges Belegdatum „${v}“.`);
  const ddmm = v.padStart(4, "0");
  const day = Number(ddmm.slice(0, 2));
  const month = Number(ddmm.slice(2));
  const startYear = Number(header.fiscalYearStart.slice(0, 4));
  const startMonth = Number(header.fiscalYearStart.slice(5, 7));
  const year = month < startMonth ? startYear + 1 : startYear;
  const date = isoDate(year, month, day);
  // 29.02. nur im Schaltjahr; ein unmögliches Datum ist ein Fehler
  if (!date && !isoDate(2024, month, day)) throw new DatevParseError(`${where}: ungültiges Belegdatum „${v}“.`);
  const { dateFrom, dateTo } = header;
  const inRange = (d: string) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  if (date && inRange(date)) return date;
  const years = [dateFrom, dateTo].filter((d) => d !== null).map((d) => Number(d.slice(0, 4)));
  for (const y of [...new Set(years)]) {
    const other = isoDate(y, month, day);
    if (other && inRange(other)) return other;
  }
  if (!date) throw new DatevParseError(`${where}: ungültiges Belegdatum „${v}“.`);
  warnings.push(`${where}: Belegdatum ${date} liegt außerhalb des Zeitraums ${dateFrom ?? "…"} bis ${dateTo ?? "…"}.`);
  return date;
}

/** Spaltenzugriff über den Namen; Versionen unterscheiden sich in Reihenfolge und Umfang. */
function columnIndex(names: string[], ...candidates: string[]): number {
  for (const candidate of candidates) {
    const i = names.indexOf(normalizeName(candidate));
    if (i >= 0) return i;
  }
  return -1;
}

const REQUIRED = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "Belegdatum",
] as const;

/** Liest einen DATEV-Buchungsstapel (EXTF, Formatkategorie 21, Version 7xx), etwa aus Lexoffice. */
export function parseDatevBuchungsstapel(bytes: Uint8Array): DatevStack {
  const lines = splitLines(stripBom(decodeText(bytes)));
  const first = lines[0];
  if (!first || !/^(EXTF|DTVF)$/.test((first.fields[0] ?? "").trim())) {
    throw new DatevParseError("Keine DATEV-Datei: Kopfzeile beginnt nicht mit EXTF");
  }
  const header = parseHeader(first.fields);
  const warnings: string[] = [];
  if (header.formatVersion < 700 || header.formatVersion > 799) {
    warnings.push(`Unerwartete DATEV-Versionsnummer ${header.formatVersion} (erwartet 7xx).`);
  }

  const columnRow = lines[1];
  if (!columnRow) throw new DatevParseError("Zeile 2: Spaltenüberschriften fehlen.");
  const titles = columnRow.fields.map((t) => t.replace(/\s+/g, " ").trim());
  const names = titles.map(normalizeName);
  for (const required of REQUIRED) {
    if (columnIndex(names, required) < 0) {
      throw new DatevParseError(`Zeile 2: Spalte „${required}“ fehlt.`);
    }
  }
  const col = (...candidates: string[]) => {
    const i = columnIndex(names, ...candidates);
    return (fields: string[]) => (i < 0 ? "" : (fields[i] ?? "").trim());
  };
  const amountOf = col("Umsatz (ohne Soll/Haben-Kz)");
  const sideOf = col("Soll/Haben-Kennzeichen");
  const currencyOf = col("WKZ Umsatz");
  const accountOf = col("Konto");
  const contraOf = col("Gegenkonto (ohne BU-Schlüssel)");
  const buKeyOf = col("BU-Schlüssel");
  const dateOf = col("Belegdatum");
  const voucher1Of = col("Belegfeld 1");
  const voucher2Of = col("Belegfeld 2");
  const textOf = col("Buchungstext");
  const linkOf = col("Beleglink");
  const kost1Of = col("KOST1 - Kostenstelle");
  const kost2Of = col("KOST2 - Kostenstelle");
  const vatIdOf = col("EU-Land u. UStID", "EU-Mitgliedstaat u. UStID (Bestimmung)", "EU-Land u. UStID (Bestimmung)");
  const taxRateOf = col("EU-Steuersatz", "EU-Steuersatz (Bestimmung)");

  const bookings: DatevBooking[] = [];
  for (const { line, fields } of lines.slice(2)) {
    if (fields.every((f) => f.trim() === "")) continue;
    const where = `Zeile ${line}`;
    if (fields.length > titles.length) {
      warnings.push(`${where}: ${fields.length} Felder, aber nur ${titles.length} Spaltenüberschriften.`);
    }

    const amountText = amountOf(fields);
    const amount = parseGermanAmount(amountText);
    if (amount === null) throw new DatevParseError(`${where}: ungültiger Umsatz „${amountText}“.`);
    if (amount < 0 || /^-|-$/.test(amountText)) {
      throw new DatevParseError(`${where}: negativer Umsatz „${amountText}“; DATEV erwartet positive Beträge.`);
    }
    if (amount === 0) warnings.push(`${where}: Umsatz ist 0,00.`);

    const side = sideOf(fields).toUpperCase();
    if (side !== "S" && side !== "H") {
      throw new DatevParseError(`${where}: Soll/Haben-Kennzeichen „${sideOf(fields)}“ ist weder S noch H.`);
    }
    const account = accountOf(fields);
    if (account === "") throw new DatevParseError(`${where}: Konto fehlt.`);
    const contraAccount = contraOf(fields);
    if (contraAccount === "") throw new DatevParseError(`${where}: Gegenkonto fehlt.`);

    const taxRateText = taxRateOf(fields);
    let euTaxRate: number | null = null;
    if (taxRateText !== "") {
      euTaxRate = parseGermanAmount(taxRateText);
      if (euTaxRate === null || euTaxRate < 0) {
        throw new DatevParseError(`${where}: ungültiger EU-Steuersatz „${taxRateText}“.`);
      }
    }

    const raw: Record<string, string> = {};
    titles.forEach((title, i) => {
      const value = fields[i] ?? "";
      if (value.trim() !== "" && title !== "" && !(title in raw)) raw[title] = value;
    });

    bookings.push({
      row: line,
      amount,
      side,
      currency: currencyOf(fields) || header.currency,
      account,
      contraAccount,
      buKey: buKeyOf(fields),
      date: resolveDate(dateOf(fields), header, where, warnings),
      voucherField1: voucher1Of(fields),
      voucherField2: voucher2Of(fields),
      text: textOf(fields),
      documentLink: linkOf(fields),
      costCenter1: kost1Of(fields),
      costCenter2: kost2Of(fields),
      euVatId: vatIdOf(fields),
      euTaxRate,
      raw,
    });
  }
  return { header, bookings, warnings };
}

/**
 * Summen je Konto: Soll und Haben, beide Seiten einer Buchung (Konto und Gegenkonto).
 * Reine Umsatzliste: bei Automatikkonten oder BU-Schlüssel sind die Beträge brutto, die
 * Steuer wird nicht auf ein Steuerkonto aufgeteilt.
 */
export function datevAccountTotals(bookings: DatevBooking[]): { account: string; debit: number; credit: number }[] {
  const totals = new Map<string, { account: string; debit: number; credit: number }>();
  const entry = (account: string) => {
    let t = totals.get(account);
    if (!t) {
      t = { account, debit: 0, credit: 0 };
      totals.set(account, t);
    }
    return t;
  };
  for (const b of bookings) {
    const [debit, credit] = b.side === "S" ? [b.account, b.contraAccount] : [b.contraAccount, b.account];
    entry(debit).debit += b.amount;
    entry(credit).credit += b.amount;
  }
  return [...totals.values()].sort((a, b) => a.account.localeCompare(b.account, "de", { numeric: true }));
}
