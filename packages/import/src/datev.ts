import { decodeText } from "./decode.ts";
import type { BasisPoints, Cents } from "@haben/core";
import { parseGermanAmount, parseGermanRate } from "./text.ts";
import { compactDate, resolveDate, timestamp } from "./datev-datum.ts";

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
  /** Immer positiv; die Richtung steht in side */
  amount: Cents;
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
  euTaxRate: BasisPoints | null;
  /** Alle nicht leeren Spalten nach Spaltenname, unverändert */
  raw: Record<string, string>;
}

export interface DatevStack {
  header: DatevHeader;
  bookings: DatevBooking[];
  warnings: string[];
}

const BUCHUNGSSTAPEL = 21;

/** Formatkategorien laut DATEV-Schnittstellenbeschreibung */
const CATEGORIES: Record<number, string> = {
  16: "Debitoren/Kreditoren",
  20: "Kontenbeschriftungen",
  [BUCHUNGSSTAPEL]: "Buchungsstapel",
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
export function splitLines(text: string, maxLines = Infinity): Line[] {
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
      if (lines.length === maxLines) return lines;
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

/**
 * Spaltenname für den Vergleich: Kleinschreibung, Umlaute als ae/oe/ue/ss, ohne Leerraum und
 * Bindestriche. Lexware Office schreibt etwa „BU-Schluessel“ statt „BU-Schlüssel“ und
 * „Basisumsatz“ statt „Basis-Umsatz“.
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[\s-]+/g, "");
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

const categoryName = (category: number, nameInHeader: string) => CATEGORIES[category] || nameInHeader || `Kategorie ${category}`;

/**
 * Name des DATEV-Exports, wenn die Kopfzeile eine andere Formatkategorie als den Buchungsstapel nennt, sonst null.
 * Eine unlesbare Kategorie zählt nicht als anderer Export: So eine Datei lehnt parseDatevBuchungsstapel ab.
 */
export function otherDatevExportName(bytes: Uint8Array): string | null {
  if (!isDatevFile(bytes)) return null;
  // Vollständig dekodieren: Eine Bytegrenze kann UTF-8 teilen und den Windows-1252-Fallback auslösen (RFC 3629 § 3).
  // https://www.rfc-editor.org/rfc/rfc3629#section-3
  // Nur den ersten CSV-Datensatz lesen; Zeilenumbrüche in einem zitierten Feld gehören noch zur Kopfzeile.
  // https://www.rfc-editor.org/rfc/rfc4180#section-2
  const fields = splitLines(stripBom(decodeText(bytes)), 1)[0]?.fields ?? [];
  const category = (fields[2] ?? "").trim();
  if (!/^\d+$/.test(category) || Number(category) === BUCHUNGSSTAPEL) return null;
  return categoryName(Number(category), (fields[3] ?? "").trim());
}

function parseHeader(fields: string[]): DatevHeader {
  const f = (n: number) => (fields[n - 1] ?? "").trim();
  if (f(1) !== "EXTF" && f(1) !== "DTVF") {
    throw new DatevParseError("Keine DATEV-Datei: Kopfzeile beginnt nicht mit EXTF");
  }
  const category = integer(f(3), "Formatkategorie");
  if (category !== BUCHUNGSSTAPEL) {
    throw new DatevParseError(`Das ist ein DATEV-Export „${categoryName(category, f(4))}“, kein Buchungsstapel.`);
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

/** Spaltenzugriff über den Namen; Versionen unterscheiden sich in Reihenfolge und Umfang. */
function columnIndex(names: string[], ...candidates: string[]): number {
  for (const candidate of candidates) {
    const i = names.indexOf(normalizeName(candidate));
    if (i >= 0) return i;
  }
  return -1;
}

/** Lexware Office lässt die Klammerzusätze weg: „Umsatz“, „Gegenkonto“. */
const AMOUNT_COLUMN = ["Umsatz (ohne Soll/Haben-Kz)", "Umsatz"];
const CONTRA_COLUMN = ["Gegenkonto (ohne BU-Schlüssel)", "Gegenkonto"];

/** Pflichtspalten, je mit alternativen Namen; die erste steht in der Fehlermeldung. */
const REQUIRED = [AMOUNT_COLUMN, ["Soll/Haben-Kennzeichen"], ["Konto"], CONTRA_COLUMN, ["Belegdatum"]];

/** Liest einen DATEV-Buchungsstapel (EXTF, Formatkategorie 21, Version 7xx), etwa aus Lexoffice. */
/** Leser je Spalte des Buchungsstapels, nach den normalisierten Spaltenüberschriften */
function columnReaders(names: string[]) {
  const col = (...candidates: string[]) => {
    const i = columnIndex(names, ...candidates);
    return (fields: string[]) => (i < 0 ? "" : (fields[i] ?? "").trim());
  };
  const amountOf = col(...AMOUNT_COLUMN);
  const sideOf = col("Soll/Haben-Kennzeichen");
  const currencyOf = col("WKZ Umsatz");
  const accountOf = col("Konto");
  const contraOf = col(...CONTRA_COLUMN);
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
  return { amountOf, sideOf, currencyOf, accountOf, contraOf, buKeyOf, dateOf, voucher1Of, voucher2Of, textOf, linkOf, kost1Of, kost2Of, vatIdOf, taxRateOf };
}

type ColumnReaders = ReturnType<typeof columnReaders>;

/** Eine Buchungszeile; wirft bei Fehlern, sammelt Warnungen */
function parseBooking(fields: string[], line: number, titles: string[], c: ColumnReaders, header: DatevHeader, warnings: string[]): DatevBooking {
  const where = `Zeile ${line}`;
  if (fields.length > titles.length) {
    warnings.push(`${where}: ${fields.length} Felder, aber nur ${titles.length} Spaltenüberschriften.`);
  }

  const amountText = c.amountOf(fields);
  const amount = parseGermanAmount(amountText);
  if (amount === null) throw new DatevParseError(`${where}: ungültiger Umsatz „${amountText}“.`);
  if (amount < 0 || /^-|-$/.test(amountText)) {
    throw new DatevParseError(`${where}: negativer Umsatz „${amountText}“; DATEV erwartet positive Beträge.`);
  }
  if (amount === 0) warnings.push(`${where}: Umsatz ist 0,00.`);

  const side = c.sideOf(fields).toUpperCase();
  if (side !== "S" && side !== "H") {
    throw new DatevParseError(`${where}: Soll/Haben-Kennzeichen „${c.sideOf(fields)}“ ist weder S noch H.`);
  }
  const account = c.accountOf(fields);
  if (account === "") throw new DatevParseError(`${where}: Konto fehlt.`);
  const contraAccount = c.contraOf(fields);
  if (contraAccount === "") throw new DatevParseError(`${where}: Gegenkonto fehlt.`);

  const taxRateText = c.taxRateOf(fields);
  let euTaxRate: BasisPoints | null = null;
  if (taxRateText !== "") {
    euTaxRate = parseGermanRate(taxRateText);
    if (euTaxRate === null || euTaxRate < 0) {
      throw new DatevParseError(`${where}: ungültiger EU-Steuersatz „${taxRateText}“.`);
    }
  }

  const raw: Record<string, string> = {};
  titles.forEach((title, i) => {
    const value = fields[i] ?? "";
    if (value.trim() !== "" && title !== "" && !(title in raw)) raw[title] = value;
  });

  return {
    row: line,
    amount,
    side,
    currency: c.currencyOf(fields) || header.currency,
    account,
    contraAccount,
    buKey: c.buKeyOf(fields),
    date: resolveDate(c.dateOf(fields), header, where, warnings),
    voucherField1: c.voucher1Of(fields),
    voucherField2: c.voucher2Of(fields),
    text: c.textOf(fields),
    documentLink: c.linkOf(fields),
    costCenter1: c.kost1Of(fields),
    costCenter2: c.kost2Of(fields),
    euVatId: c.vatIdOf(fields),
    euTaxRate,
    raw,
  };
}

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
    if (columnIndex(names, ...required) < 0) {
      throw new DatevParseError(`Zeile 2: Spalte „${required[0]}“ fehlt.`);
    }
  }
  const c = columnReaders(names);

  const bookings: DatevBooking[] = [];
  for (const { line, fields } of lines.slice(2)) {
    if (fields.every((f) => f.trim() === "")) continue;
    bookings.push(parseBooking(fields, line, titles, c, header, warnings));
  }
  return { header, bookings, warnings };
}

/**
 * Summen je Konto: Soll und Haben, beide Seiten einer Buchung (Konto und Gegenkonto).
 * Reine Umsatzliste: bei Automatikkonten oder BU-Schlüssel sind die Beträge brutto, die
 * Steuer wird nicht auf ein Steuerkonto aufgeteilt.
 */
export function datevAccountTotals(bookings: DatevBooking[]): { account: string; debit: Cents; credit: Cents }[] {
  const totals = new Map<string, { account: string; debit: Cents; credit: Cents }>();
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

export * from "./datev-konten.ts";
