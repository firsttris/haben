import { formatRateMonth, foreignToEuro } from "@haben/core";
import { gunzipSync } from "fflate";
import { StatementParseError } from "../errors.ts";
import type { ParsedTransaction } from "../types.ts";
import { euro, headerIndex, microsToCents, parseMicros, reportText, type ParsedStoreReport, type StoreSettlement } from "./reports.ts";

/*
 * Bericht „All Countries or Regions (Detailed)“ (FINANCE_DETAIL, Region Z1) als gzip-TSV. Felder laut
 * https://developer.apple.com/help/app-store-connect/reference/reporting/financial-report-fields/, Aufbau nach echten
 * Berichten (#1424): vor der Kopfzeile stehen Vendor Name, Start Date und End Date als Zeilen „Name<TAB>Wert“ (MM/DD/YYYY,
 * Apples Fiskalperiode), die Kopfzeile beginnt mit Transaction Date, und nach den Vorgängen folgt ohne Leerzeile ein
 * Summenblock je Land und Währung (Country Of Sale, Partner Share Currency, Quantity, Extended Partner Share).
 *
 * Der Anspruch je Währung ist die Summe der Extended Partner Share (Menge × Anteil, positiv oder negativ, zwei
 * Nachkommastellen); der Summenblock ist die Gegenprobe. Apple zahlt alle Währungen gesammelt in der Währung deines
 * Bankkontos aus, zum Kurs am Zahltag; der steht nicht im Bericht. Haben rechnet Fremdwährung deshalb mit dem
 * Umsatzsteuer-Umrechnungskurs des Monats um (§ 16 Abs. 6 UStG); die Differenz zur Zahlung ist eine Kursdifferenz.
 */

/** Erkennt den Bericht an seiner Kopfzeile */
export function isAppStoreFinanceHeader(header: string[]): boolean {
  const col = headerIndex(header);
  return col("Transaction Date") >= 0 && col("Extended Partner Share") >= 0 && col("Partner Share Currency") >= 0;
}

/** MM/DD/YYYY → YYYY-MM-DD; null, wenn kein Datum */
function appleDate(raw: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const date = `${match[3]}-${match[1]!.padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

/**
 * Kalendermonat einer Fiskalperiode: der Monat ihrer Mitte. Die Perioden haben vier oder fünf Wochen und reichen dann
 * einige Tage in den Nachbarmonat (28.09. bis 01.11. ist der Oktober).
 */
function appleMonth(from: string, to: string): string {
  return new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString().slice(0, 7);
}

/** Umrechnungskurs (1 EUR = Kurs) einer Währung für einen Monat YYYY-MM; null, wenn keiner vorliegt */
export type RateLookup = (currency: string, month: string) => string | null;

type AppleGroup = { micros: number; lines: number; sales: number; returns: number };

/** Zeitraum aus dem Vorspann und die Vorgänge je Währung; bricht ab, wenn die Summen nicht zum Summenblock passen */
function readAppleRows(rows: string[][]): { from: string; to: string; groups: Map<string, AppleGroup> } {
  const headerRow = rows.findIndex((row) => isAppStoreFinanceHeader(row));
  if (headerRow < 0)
    throw new StatementParseError(
      "Das ist kein Finanzbericht von App Store Connect (Spalten Transaction Date, Extended Partner Share und Partner Share Currency fehlen).",
    );
  const preamble = new Map(rows.slice(0, headerRow).map((row) => [(row[0] ?? "").trim().toLowerCase(), row[1] ?? ""]));
  const from = appleDate(preamble.get("start date") ?? "");
  const to = appleDate(preamble.get("end date") ?? "");
  if (!from || !to || from > to) throw new StatementParseError("Im Finanzbericht fehlt der Zeitraum (Start Date und End Date vor der Kopfzeile).");

  const col = headerIndex(rows[headerRow]!);
  const at = { amount: col("Extended Partner Share"), currency: col("Partner Share Currency"), kind: col("Sale or Return") };
  const groups = new Map<string, AppleGroup>();
  /** Spalten des Summenblocks, sobald seine Kopfzeile kam */
  let summary: { amount: number; currency: number } | null = null;
  const sums = new Map<string, number>();
  for (const [i, row] of rows.slice(headerRow + 1).entries()) {
    if (row.every((cell) => cell.trim() === "")) continue;
    // Der Summenblock beginnt mit seiner Kopfzeile. Am Transaction Date lässt er sich nicht erkennen: Apple lässt es leer,
    // wenn der Vorgang mehr als 30 Tage vor der Abrechnung lag (Financial report fields, „Detailed“).
    const sumCol = headerIndex(row);
    if (!summary && sumCol("Extended Partner Share") >= 0 && sumCol("Partner Share Currency") >= 0) {
      summary = { amount: sumCol("Extended Partner Share"), currency: sumCol("Partner Share Currency") };
      continue;
    }
    const where = `Zeile ${headerRow + i + 2}`;
    const cells = summary ?? at;
    const rawAmount = (row[cells.amount] ?? "").trim();
    const micros = parseMicros(rawAmount);
    if (micros === null) throw new StatementParseError(`Ungültiger Betrag „${rawAmount}“ (${where}).`);
    const currency = (row[cells.currency] ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new StatementParseError(`Ungültige Währung „${currency}“ (${where}).`);
    if (summary) {
      sums.set(currency, (sums.get(currency) ?? 0) + micros);
      continue;
    }
    const group = groups.get(currency) ?? { micros: 0, lines: 0, sales: 0, returns: 0 };
    group.micros += micros;
    group.lines++;
    if (at.kind >= 0 && (row[at.kind] ?? "").trim().toUpperCase() === "R") group.returns++;
    else group.sales++;
    groups.set(currency, group);
  }
  if (groups.size === 0) throw new StatementParseError("Der Finanzbericht enthält keine Vorgänge.");
  if (!summary) throw new StatementParseError("Im Finanzbericht fehlt der Summenblock am Ende; die Datei ist unvollständig.");
  for (const currency of new Set([...groups.keys(), ...sums.keys()])) {
    if ((groups.get(currency)?.micros ?? 0) !== (sums.get(currency) ?? 0))
      throw new StatementParseError(`Die Vorgänge in ${currency} ergeben nicht die Summe im Summenblock des Finanzberichts; die Datei ist unvollständig.`);
  }
  return { from, to, groups };
}

/**
 * Liest den Finanzbericht „Detailed“ von App Store Connect. Berichtsmonat ist der Kalendermonat der Fiskalperiode
 * (appleMonth), Buchungstag ihr Enddatum. Für Fremdwährung braucht es `rateFor`; fehlt ein Kurs, kommt der Betrag nicht
 * ins Konto (Hinweis), ein späterer Abgleich holt ihn nach.
 */
export function parseAppStoreFinanceDetail(bytes: Uint8Array, options: { rateFor?: RateLookup } = {}): ParsedStoreReport {
  let raw = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      raw = gunzipSync(bytes);
    } catch {
      throw new StatementParseError("Die gzip-Datei lässt sich nicht entpacken.");
    }
  }
  const { from, to, groups } = readAppleRows(
    reportText(raw)
      .split(/\r?\n/)
      .map((line) => line.split("\t")),
  );
  const warnings: string[] = [];

  const period = appleMonth(from, to);
  // Kurs des Berichtsmonats; das Enddatum der Periode liegt oft schon im Folgemonat
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
