import { formatRateMonth, foreignToEuro, type Cents } from "@haben/core";
import { gunzipSync, unzipSync } from "fflate";
import { parseCsv } from "../csv.ts";
import { decodeText } from "../decode.ts";
import { StatementParseError } from "../errors.ts";
import type { ParsedStatement, ParsedTransaction } from "../types.ts";

/*
 * Monatsabrechnungen der App-Stores als Umsätze eines Zahlungsdienstleister-Kontos. Beide Stores verkaufen im eigenen
 * Namen (Kommissionär, § 3 Abs. 11a UStG); deine Leistung geht an den Store, dein Entgelt ist der Auszahlungsanspruch
 * nach Provision und Steuer. Haben übernimmt deshalb je Monat (bei Apple je Monat und Währung) einen Umsatz mit dem
 * Nettobetrag; Umsätze, Gebühren und Steuern stehen nur im Verwendungszweck und im archivierten Original.
 *
 * Aufbau nach den Beschreibungen der Stores; echte Dateien lagen bei der Umsetzung nicht vor. Deshalb erkennt Haben die
 * Spalten über ihre Namen, verlangt nur die für den Betrag nötigen und bricht ab, wenn etwas nicht passt (Währung,
 * Betrag, Datum), statt zu raten. Unbekannte Zeilenarten gehen mit Betrag in den Nettobetrag und werden gemeldet.
 */

/** Ergebnis einer Monatsabrechnung, auch für den Rechnungsentwurf an die Store-Gesellschaft */
export interface StoreSettlement {
  /** Feste Referenz, gleich der des Umsatzes im Konto (bankReference) */
  reference: string;
  /** Berichtsmonat YYYY-MM (bei Apple der Fiskalmonat) */
  period: string;
  periodFrom: string;
  periodTo: string;
  /** Währung des Auszahlungsanspruchs */
  currency: string;
  /** Auszahlungsanspruch in dieser Währung, in Cent */
  net: Cents;
  /** Nettobetrag in Euro; null, wenn der Umrechnungskurs fehlt */
  euro: Cents | null;
  /** Umrechnungskurs (1 EUR = Kurs) bei Fremdwährung */
  rate: string | null;
  /** Aufschlüsselung, wie sie im Verwendungszweck steht */
  parts: { label: string; amount: Cents }[];
  lines: number;
}

export interface ParsedStoreReport {
  statement: ParsedStatement;
  settlements: StoreSettlement[];
}

// ─── Gemeinsames ─────────────────────────────────────────────────────────────

/** Beträge mit bis zu sechs Nachkommastellen ganzzahlig summieren, erst die Summe auf Cent runden */
const MICROS = 1_000_000;

/** "12345.67", "-0.5", "1,234.5678" → Millionstel; null, wenn kein Betrag */
export function parseMicros(input: string): number | null {
  const value = input.trim().replace(/[−–]/g, "-");
  const match = /^([+-])?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  const micros = Number(match[2]!.replace(/,/g, "")) * MICROS + Number((match[3] ?? "").padEnd(6, "0"));
  if (!Number.isSafeInteger(micros)) return null;
  return match[1] === "-" ? -micros : micros;
}

/** Millionstel auf Cent, halbe Cent vom Nullpunkt weg */
export function microsToCents(micros: number): Cents {
  const cents = Math.round(Math.abs(micros) / 10_000);
  return micros < 0 ? -cents : cents;
}

const euro = (cents: Cents, currency = "EUR") =>
  `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === "EUR" ? "€" : currency}`;

const lastDayOf = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** Text einer CSV/TSV im Bericht; UTF-16 auch ohne BOM (Google empfiehlt, die Dateien von UTF-16 nach UTF-8 zu wandeln) */
function reportText(bytes: Uint8Array): string {
  const zeros = bytes.subarray(0, 200).filter((b, i) => b === 0 && i % 2 === 1).length;
  const text = zeros > 20 && bytes[0] !== 0xff && bytes[0] !== 0xfe ? new TextDecoder("utf-16le").decode(bytes) : decodeText(bytes);
  return text.replace(/^﻿/, "");
}

/** Spalten über den genauen Namen (ohne Groß-/Kleinschreibung): „Amount (Buyer Currency)“ und „Amount (Merchant Currency)“ unterscheiden sich nur in der Klammer */
function headerIndex(header: string[]) {
  const names = header.map((h) => h.trim().toLowerCase());
  return (...candidates: string[]) => {
    for (const candidate of candidates) {
      const i = names.indexOf(candidate.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// ─── Google Play: Einnahmenbericht ───────────────────────────────────────────

/*
 * Einnahmenbericht (earnings/earnings_YYYYMM.zip): CSV in einer ZIP, eine Zeile je Vorgang. Spalten laut
 * https://support.google.com/googleplay/android-developer/answer/6135870 („Earnings“), u. a. Transaction Date
 * („Nov 30, 2016“, Pacific Time), Transaction Type, Merchant Currency (Währung der Auszahlung) und Amount (Merchant
 * Currency). Zeilenarten laut Google: Charge, Google fee, Tax, Charge refund, Google fee refund, Charge rebill, Tax
 * rebill, Google fee rebill, Adjustment. Umsatz = Charge + Charge refund, Gebühren = Google fee + Google fee refund
 * (https://support.google.com/googleplay/android-developer/answer/2482017); die Summe aller Zeilen ist der Anspruch.
 * Korrigiert Google einen Monat, kommt eine zusätzliche Datei nur mit den Korrekturen; sie wird ein eigener Umsatz.
 */

const GOOGLE_KINDS: [RegExp, string][] = [
  [/^charge( refund| rebill)?$/i, "Umsätze"],
  [/^google fee( refund| rebill)?$/i, "Gebühren"],
  [/^tax( refund| rebill)?$/i, "Steuern"],
  [/^adjustment$/i, "Korrekturen"],
];

/** Erkennt den Einnahmenbericht an seiner Kopfzeile */
export function isGooglePlayEarningsHeader(header: string[]): boolean {
  const col = headerIndex(header);
  return col("Transaction Type") >= 0 && col("Amount (Merchant Currency)") >= 0 && col("Merchant Currency") >= 0 && col("Transaction Date") >= 0;
}

/** „Nov 30, 2016“ bzw. „Oct 1, 2026“ → 2016-11-30 */
function googleDate(raw: string, where: string): string {
  const match = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(raw.trim());
  const month = match ? MONTHS.indexOf(match[1]!.toLowerCase()) + 1 : 0;
  if (!match || month === 0) throw new StatementParseError(`Ungültiges Datum „${raw}“ (${where}).`);
  const date = `${match[3]}-${String(month).padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new StatementParseError(`Ungültiges Datum „${raw}“ (${where}).`);
  }
  return date;
}

/** Alle CSV-Dateien einer ZIP, sonst die Datei selbst */
function googleCsvFiles(bytes: Uint8Array): Uint8Array[] {
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return [bytes];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new StatementParseError("Die ZIP-Datei lässt sich nicht entpacken.");
  }
  const files = Object.entries(entries)
    .filter(([name]) => name.toLowerCase().endsWith(".csv"))
    .sort(([a], [b]) => a.localeCompare(b));
  if (files.length === 0) throw new StatementParseError("In der ZIP-Datei liegt keine CSV-Datei.");
  return files.map(([, content]) => content);
}

/**
 * Liest einen Einnahmenbericht von Google Play. `period` ist der Berichtsmonat aus dem Dateinamen; ohne ihn gilt der
 * Monat, in dem die meisten Vorgänge liegen (einzelne Zeitstempel fallen laut Google in den Folgemonat).
 * `part` unterscheidet mehrere Dateien eines Monats (Korrekturdatei) in der Referenz des Umsatzes.
 */
export function parseGooglePlayEarnings(bytes: Uint8Array, options: { period?: string; part?: string } = {}): ParsedStoreReport {
  const rows = googleCsvFiles(bytes).flatMap((file) => {
    const parsed = parseCsv(reportText(file), ",");
    const headerRow = parsed.findIndex((row) => isGooglePlayEarningsHeader(row));
    if (headerRow < 0)
      throw new StatementParseError("Das ist kein Einnahmenbericht von Google Play (Spalten Transaction Type und Amount (Merchant Currency) fehlen).");
    const col = headerIndex(parsed[headerRow]!);
    const at = { date: col("Transaction Date"), type: col("Transaction Type"), currency: col("Merchant Currency"), amount: col("Amount (Merchant Currency)") };
    return parsed
      .slice(headerRow + 1)
      .map((row, i) => ({ row, line: headerRow + i + 2 }))
      .filter(({ row }) => row.some((cell) => cell.trim() !== ""))
      .map(({ row, line }) => ({ cell: (index: number) => (row[index] ?? "").trim(), line, at }));
  });

  const warnings: string[] = [];
  const sums = new Map<string, number>();
  const unknown = new Map<string, number>();
  const currencies = new Set<string>();
  const months = new Map<string, number>();
  let total = 0;
  let firstDate = "";
  let lastDate = "";
  for (const { cell, line, at } of rows) {
    const where = `Zeile ${line}`;
    const date = googleDate(cell(at.date), where);
    const type = cell(at.type);
    const currency = cell(at.currency).toUpperCase();
    const micros = parseMicros(cell(at.amount));
    if (micros === null) throw new StatementParseError(`Ungültiger Betrag „${cell(at.amount)}“ (${where}).`);
    currencies.add(currency);
    months.set(date.slice(0, 7), (months.get(date.slice(0, 7)) ?? 0) + 1);
    if (!firstDate || date < firstDate) firstDate = date;
    if (date > lastDate) lastDate = date;
    const label = GOOGLE_KINDS.find(([pattern]) => pattern.test(type))?.[1];
    if (label) sums.set(label, (sums.get(label) ?? 0) + micros);
    else {
      unknown.set(type || "(leer)", (unknown.get(type || "(leer)") ?? 0) + 1);
      sums.set("Sonstiges", (sums.get("Sonstiges") ?? 0) + micros);
    }
    total += micros;
  }
  if (rows.length === 0) throw new StatementParseError("Der Einnahmenbericht enthält keine Vorgänge.");
  if (currencies.size !== 1 || !currencies.has("EUR")) {
    throw new StatementParseError(
      `Der Bericht ist in ${[...currencies].join(", ")}; Haben übernimmt nur Berichte in Euro. Die Auszahlungswährung stellst du im Zahlungsprofil von Google ein.`,
    );
  }
  for (const [type, count] of unknown) warnings.push(`Unbekannte Zeilenart „${type}“ (${count}×): mit ihrem Betrag im Nettobetrag enthalten.`);

  const period = options.period ?? [...months].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
  const parts = ["Umsätze", "Gebühren", "Steuern", "Korrekturen", "Sonstiges"]
    .filter((label) => sums.has(label))
    .map((label) => ({ label, amount: microsToCents(sums.get(label)!) }));
  const net = microsToCents(total);
  const bookingDate = lastDayOf(period);
  const reference = `googleplay-earnings-${period}${options.part ? `-${options.part}` : ""}`;
  const settlement: StoreSettlement = {
    reference,
    period,
    periodFrom: `${period}-01`,
    periodTo: bookingDate,
    currency: "EUR",
    net,
    euro: net,
    rate: null,
    parts,
    lines: rows.length,
  };
  const transaction: ParsedTransaction = {
    bookingDate,
    amount: net,
    currency: "EUR",
    counterpartyName: "Google Play",
    purpose: `Google Play Einnahmen ${formatRateMonth(period)}${options.part ? " (Korrektur)" : ""}: ${parts.map((p) => `${p.label} ${euro(p.amount)}`).join(", ")}; ${rows.length} Vorgänge vom ${firstDate} bis ${lastDate}`,
    type: "Monatsabrechnung",
    bankReference: reference,
    index: 0,
  };
  return {
    statement: {
      format: "googleplay-earnings",
      currency: "EUR",
      periodFrom: settlement.periodFrom,
      periodTo: bookingDate,
      transactions: [transaction],
      warnings,
    },
    settlements: [settlement],
  };
}

// ─── App Store Connect: Finance Detail (Z1) ──────────────────────────────────

/*
 * Bericht „All Countries or Regions (Detailed)“ (FINANCE_DETAIL, Region Z1) als gzip-TSV. Spalten laut
 * https://developer.apple.com/help/app-store-connect/reference/reporting/financial-report-fields/: u. a. Start Date und
 * End Date (MM/DD/YYYY, Fiskalmonat), Extended Partner Share (Menge × Anteil, positiv oder negativ, zwei
 * Nachkommastellen), Partner Share Currency (ISO), Sale or Return (S/R). Der Anspruch je Währung ist die Summe der
 * Extended Partner Share. Apple zahlt alle Währungen gesammelt in der Währung deines Bankkontos aus, zum Kurs am
 * Zahltag; der steht nicht im Bericht. Haben rechnet Fremdwährung deshalb mit dem Umsatzsteuer-Umrechnungskurs des
 * Fiskalmonats um (§ 16 Abs. 6 UStG); die Differenz zur Zahlung ist eine Kursdifferenz.
 * Summen- oder Fußzeilen (z. B. „Total_Rows“) haben kein gültiges Startdatum und werden übersprungen.
 */

/** Erkennt den Bericht an seiner Kopfzeile */
export function isAppStoreFinanceHeader(header: string[]): boolean {
  const col = headerIndex(header);
  return col("Extended Partner Share") >= 0 && col("Partner Share Currency") >= 0 && col("Start Date") >= 0 && col("End Date") >= 0;
}

/** MM/DD/YYYY → YYYY-MM-DD; null, wenn kein Datum */
function appleDate(raw: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const date = `${match[3]}-${match[1]!.padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

/** Umrechnungskurs (1 EUR = Kurs) einer Währung für einen Monat YYYY-MM; null, wenn keiner vorliegt */
export type RateLookup = (currency: string, month: string) => string | null;

/**
 * Liest den Finanzbericht „Detailed“ von App Store Connect. `period` ist der abgefragte Fiskalmonat; Buchungstag ist das
 * Enddatum des Fiskalmonats laut Bericht. Für Fremdwährung braucht es `rateFor`; fehlt ein Kurs, kommt der Betrag nicht
 * ins Konto (Hinweis), ein späterer Abgleich holt ihn nach.
 */
export function parseAppStoreFinanceDetail(bytes: Uint8Array, options: { period?: string; rateFor?: RateLookup } = {}): ParsedStoreReport {
  let raw = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      raw = gunzipSync(bytes);
    } catch {
      throw new StatementParseError("Die gzip-Datei lässt sich nicht entpacken.");
    }
  }
  const rows = reportText(raw)
    .split(/\r?\n/)
    .map((line) => line.split("\t"));
  const headerRow = rows.findIndex((row) => isAppStoreFinanceHeader(row));
  if (headerRow < 0)
    throw new StatementParseError("Das ist kein Finanzbericht von App Store Connect (Spalten Extended Partner Share und Partner Share Currency fehlen).");
  const col = headerIndex(rows[headerRow]!);
  const at = { start: col("Start Date"), end: col("End Date"), amount: col("Extended Partner Share"), currency: col("Partner Share Currency") };

  const warnings: string[] = [];
  const groups = new Map<string, { micros: number; lines: number; sales: number; returns: number }>();
  const returnsCol = col("Sale or Return");
  let from = "";
  let to = "";
  let skipped = 0;
  for (const [i, row] of rows.slice(headerRow + 1).entries()) {
    if (row.every((cell) => cell.trim() === "")) continue;
    const start = appleDate(row[at.start] ?? "");
    const end = appleDate(row[at.end] ?? "");
    if (!start || !end) {
      skipped++;
      continue;
    }
    const where = `Zeile ${headerRow + i + 2}`;
    const rawAmount = (row[at.amount] ?? "").trim();
    const micros = parseMicros(rawAmount);
    if (micros === null) throw new StatementParseError(`Ungültiger Betrag „${rawAmount}“ (${where}).`);
    const currency = (row[at.currency] ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new StatementParseError(`Ungültige Währung „${currency}“ (${where}).`);
    if (!from || start < from) from = start;
    if (end > to) to = end;
    const group = groups.get(currency) ?? { micros: 0, lines: 0, sales: 0, returns: 0 };
    group.micros += micros;
    group.lines++;
    if (returnsCol >= 0 && (row[returnsCol] ?? "").trim().toUpperCase() === "R") group.returns++;
    else group.sales++;
    groups.set(currency, group);
  }
  if (groups.size === 0) throw new StatementParseError("Der Finanzbericht enthält keine Vorgänge.");
  if (skipped > 0) warnings.push(`${skipped} Zeilen ohne gültiges Start- und Enddatum (Summen- oder Fußzeilen) übersprungen.`);

  const period = options.period ?? to.slice(0, 7);
  // Kurs des Fiskalmonats; dessen Enddatum liegt oft schon im Folgemonat
  const rateMonth = period;
  const settlements: StoreSettlement[] = [];
  const transactions: ParsedTransaction[] = [];
  for (const [currency, group] of [...groups].sort(([a], [b]) => (a === "EUR" ? -1 : b === "EUR" ? 1 : a.localeCompare(b)))) {
    const net = microsToCents(group.micros);
    const rate = currency === "EUR" ? null : (options.rateFor?.(currency, rateMonth) ?? null);
    const inEuro = currency === "EUR" ? net : rate ? foreignToEuro(net, rate) : null;
    const reference = `appstore-finance-${period}-${currency}`;
    settlements.push({
      reference,
      period,
      periodFrom: from,
      periodTo: to,
      currency,
      net,
      euro: inEuro,
      rate,
      parts: [{ label: "Erlösanteil", amount: net }],
      lines: group.lines,
    });
    if (inEuro === null) {
      warnings.push(
        `Für ${currency} fehlt der Umsatzsteuer-Umrechnungskurs ${formatRateMonth(rateMonth)}; ${euro(net, currency)} kommen erst ins Konto, wenn der Kurs vorliegt (Einstellungen › Umrechnungskurse).`,
      );
      continue;
    }
    const conversion = currency === "EUR" ? "" : ` = ${euro(net, currency)} zum Kurs ${rate!.replace(".", ",")} (${formatRateMonth(rateMonth)})`;
    transactions.push({
      bookingDate: to,
      amount: inEuro,
      currency: "EUR",
      counterpartyName: "App Store",
      purpose: `App Store Erlösanteil Fiskalmonat ${formatRateMonth(period)} (${from} bis ${to}) in ${currency}${conversion}; ${group.sales} Verkäufe, ${group.returns} Rückgaben`,
      type: "Monatsabrechnung",
      bankReference: reference,
      index: transactions.length,
    });
  }
  return {
    statement: { format: "appstore-finance", currency: "EUR", periodFrom: from, periodTo: to, transactions, warnings },
    settlements,
  };
}
