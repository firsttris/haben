import { postenOf, taxIncluded, taxOf } from "@haben/core";
import { isBlankRow, parseCsv } from "../csv.ts";
import type { Kontenrahmen } from "../datev.ts";
import { decodeText } from "../decode.ts";
import type { LegacyVoucher } from "../lexoffice/map.ts";
import { normalizeText, parseDate, parseGermanAmount } from "../text.ts";
import { WisoParseError, type WisoCsvRow, type WisoPreview, type WisoVoucher } from "./types.ts";

const REQUIRED_COLUMNS = [
  "Buchungsnummer",
  "Teilbuchung",
  "Zahlungsdatum",
  "Wertstellungsdatum",
  "Buchungstext",
  "Konto",
  "Kontobezeichnung",
  "Gegenkonto",
  "Gegenkontobezeichnung",
  "Soll",
  "Haben",
  "Steuerschluessel",
  "Steuersatz",
  "Steuerschluesselbezeichnung",
  "Belegnummer",
  "Buchungsdatum",
  "UStID",
  "Umsatzart",
] as const;

type ColumnName = (typeof REQUIRED_COLUMNS)[number];
type AccountKind = "erloes" | "aufwand" | "anlage" | "bank" | null;

function buildColumnMap(header: string[]): Map<ColumnName, number> {
  const normalized = new Map<string, number>();
  header.forEach((col, index) => {
    normalized.set(col.trim().toLowerCase(), index);
  });
  const map = new Map<ColumnName, number>();
  const missing: string[] = [];
  for (const col of REQUIRED_COLUMNS) {
    const idx = normalized.get(col.toLowerCase());
    if (idx === undefined) missing.push(col);
    else map.set(col, idx);
  }
  if (missing.length > 0) {
    throw new WisoParseError(`Keine gültige WISO-Buchungs-CSV (fehlende Spalten: ${missing.join(", ")}).`);
  }
  return map;
}

function cell(row: string[], cols: Map<ColumnName, number>, name: ColumnName): string {
  return normalizeText(row[cols.get(name)!]);
}

function parseAmountField(value: string, rowNumber: number, label: string): number {
  const parsed = parseGermanAmount(value || "0");
  if (parsed === null) {
    throw new WisoParseError(`Zeile ${rowNumber}: ungültiger Betrag in ${label} („${value}“).`);
  }
  return parsed;
}

/**
 * Liest den CSV-Export der Buchungen aus WISO Steuer (Modul EÜR) und WISO EÜR & Kasse;
 * beide Programme liefern dieselben 18 Semikolon-Spalten.
 */
export function parseWisoCsv(bytes: Uint8Array): { rows: WisoCsvRow[]; unreadableBookingDates: number } {
  const text = decodeText(bytes).replace(/^\uFEFF/, "");
  const rawRows = parseCsv(text, ";").filter((r) => !isBlankRow(r));
  if (rawRows.length < 2) {
    throw new WisoParseError("Die WISO-CSV enthält keine Buchungszeilen.");
  }
  const cols = buildColumnMap(rawRows[0]!);
  const rows: WisoCsvRow[] = [];
  let unreadableBookingDates = 0;

  for (let i = 1; i < rawRows.length; i++) {
    const raw = rawRows[i]!;
    const rowNumber = i + 1;
    const zahlungsdatumRaw = cell(raw, cols, "Zahlungsdatum");
    const zahlungsdatum = parseDate(zahlungsdatumRaw);
    if (!zahlungsdatum) {
      throw new WisoParseError(`Zeile ${rowNumber}: ungültiges Zahlungsdatum („${zahlungsdatumRaw}“).`);
    }
    const wertRaw = cell(raw, cols, "Wertstellungsdatum");
    const wertstellungsdatum = (wertRaw ? parseDate(wertRaw) : null) ?? zahlungsdatum;
    const buchungsdatumRaw = cell(raw, cols, "Buchungsdatum");
    const buchungsdatum = buchungsdatumRaw ? parseDate(buchungsdatumRaw) : null;
    if (buchungsdatumRaw && !buchungsdatum) unreadableBookingDates += 1;

    const soll = parseAmountField(cell(raw, cols, "Soll"), rowNumber, "Soll");
    const haben = parseAmountField(cell(raw, cols, "Haben"), rowNumber, "Haben");
    const steuersatz = parseAmountField(cell(raw, cols, "Steuersatz") || "0", rowNumber, "Steuersatz");
    if (steuersatz < 0) {
      throw new WisoParseError(`Zeile ${rowNumber}: negativer Steuersatz.`);
    }

    rows.push({
      rowNumber,
      buchungsnummer: cell(raw, cols, "Buchungsnummer"),
      teilbuchung: cell(raw, cols, "Teilbuchung"),
      zahlungsdatum,
      wertstellungsdatum,
      buchungstext: cell(raw, cols, "Buchungstext"),
      konto: cell(raw, cols, "Konto"),
      kontobezeichnung: cell(raw, cols, "Kontobezeichnung"),
      gegenkonto: cell(raw, cols, "Gegenkonto"),
      gegenkontobezeichnung: cell(raw, cols, "Gegenkontobezeichnung"),
      soll,
      haben,
      steuerschluessel: cell(raw, cols, "Steuerschluessel"),
      steuersatz,
      steuerschluesselbezeichnung: cell(raw, cols, "Steuerschluesselbezeichnung"),
      belegnummer: cell(raw, cols, "Belegnummer"),
      buchungsdatum,
      ustId: cell(raw, cols, "UStID"),
      umsatzart: cell(raw, cols, "Umsatzart"),
    });
  }
  return { rows, unreadableBookingDates };
}

function accountKind(account: string, skr: Kontenrahmen): AccountKind {
  if (!/^\d+$/.test(account) || account.length > 4) return null;
  const posten = postenOf(skr, account.padStart(4, "0"));
  if (posten === null) return null;
  if (posten === "umsatzerloese" || posten === "sonstigeErtraege") return "erloes";
  if (posten === "aktiva.A") return "anlage";
  if (posten.startsWith("aktiva.") || posten.startsWith("passiva.")) return "bank";
  return "aufwand";
}

function classifyRow(row: WisoCsvRow, skr: Kontenrahmen): { direction: "einnahme" | "ausgabe"; positive: boolean; neutral: boolean; categoryAccount: string } {
  if (row.konto === "9000" || row.gegenkonto === "9000") {
    return {
      direction: row.soll >= row.haben ? "ausgabe" : "einnahme",
      positive: true,
      neutral: true,
      categoryAccount: row.konto === "9000" ? row.gegenkonto : row.konto,
    };
  }
  const debit = accountKind(row.konto, skr);
  const credit = accountKind(row.gegenkonto, skr);
  if (debit === "erloes" || credit === "erloes") {
    const positive = debit === "erloes" ? row.haben >= row.soll : row.soll >= row.haben;
    return { direction: "einnahme", positive, neutral: false, categoryAccount: debit === "erloes" ? row.konto : row.gegenkonto };
  }
  if (debit === "aufwand" || credit === "aufwand") {
    const positive = debit === "aufwand" ? row.soll >= row.haben : row.haben >= row.soll;
    return { direction: "ausgabe", positive, neutral: false, categoryAccount: debit === "aufwand" ? row.konto : row.gegenkonto };
  }
  if (debit === "anlage" || credit === "anlage") {
    const direction = debit === "anlage" ? (row.soll >= row.haben ? "ausgabe" : "einnahme") : row.haben >= row.soll ? "ausgabe" : "einnahme";
    return { direction, positive: true, neutral: false, categoryAccount: debit === "anlage" ? row.konto : row.gegenkonto };
  }
  if (debit === "bank" && credit === "bank") {
    return { direction: row.soll >= row.haben ? "ausgabe" : "einnahme", positive: true, neutral: true, categoryAccount: row.konto };
  }
  const key = row.steuerschluessel;
  if (/^USt\b/i.test(key)) {
    const positive = debit === "bank" ? row.soll >= row.haben : row.haben >= row.soll;
    return { direction: "einnahme", positive, neutral: false, categoryAccount: debit === "bank" ? row.gegenkonto : row.konto };
  }
  if (/^(VSt|13b|EU\s+VSt)\b/i.test(key)) {
    const positive = debit === "bank" ? row.haben >= row.soll : row.soll >= row.haben;
    return { direction: "ausgabe", positive, neutral: false, categoryAccount: debit === "bank" ? row.gegenkonto : row.konto };
  }
  return {
    direction: row.haben > row.soll ? "einnahme" : "ausgabe",
    positive: true,
    neutral: false,
    categoryAccount: row.konto,
  };
}

function computeRowAmounts(row: WisoCsvRow, positive: boolean, neutral: boolean): { rate: number; net: number; tax: number; gross: number } {
  const amount = Math.abs(row.soll - row.haben);
  const sign = positive ? 1 : -1;
  if (neutral || row.steuersatz === 0) {
    const net = sign * amount;
    return { rate: 0, net, tax: 0, gross: net };
  }
  // Bei § 13b UStG und innergemeinschaftlichem Erwerb steht im WISO-CSV-Export der Nettobetrag (Abgleich zu #565)
  const isNetInCsv = /^(13b\b|EU\s+VSt\b)/i.test(row.steuerschluessel);
  if (isNetInCsv) {
    const net = sign * amount;
    const tax = taxOf(net, row.steuersatz);
    return { rate: row.steuersatz, net, tax, gross: net + tax };
  }
  const gross = sign * amount;
  const tax = sign * taxIncluded(amount, row.steuersatz);
  return { rate: row.steuersatz, net: gross - tax, tax, gross };
}

/**
 * Richtung einer Buchung aus ihren Teilbuchungen: die Seite mit dem größeren Bruttobetrag, nicht die erste Teilbuchung.
 * Ein Zahlungseingang mit abgezogener Gebühr bleibt so eine Einnahme, gleich in welcher Reihenfolge WISO die Teile ausgibt.
 */
function groupDirection(group: WisoCsvRow[], skr: Kontenrahmen): "einnahme" | "ausgabe" {
  const sum = { einnahme: 0, ausgabe: 0 };
  for (const row of group) {
    const rowClass = classifyRow(row, skr);
    if (rowClass.neutral && !group.every((r) => classifyRow(r, skr).neutral)) continue;
    sum[rowClass.direction] += computeRowAmounts(row, rowClass.positive, rowClass.neutral).gross;
  }
  if (Math.abs(sum.einnahme) === Math.abs(sum.ausgabe)) return classifyRow(group[0]!, skr).direction;
  return Math.abs(sum.einnahme) > Math.abs(sum.ausgabe) ? "einnahme" : "ausgabe";
}

function buildGroupVoucher(key: string, group: WisoCsvRow[], skr: Kontenrahmen): WisoVoucher {
  const first = group[0]!;
  const year = Number(first.zahlungsdatum.slice(0, 4));
  const neutral = group.every((r) => classifyRow(r, skr).neutral);
  const direction = groupDirection(group, skr);

  const taxByRate = new Map<number, { rate: number; net: number; tax: number }>();
  const categories: LegacyVoucher["categories"] = [];
  let totalNet = 0;
  let totalTax = 0;
  let totalGross = 0;

  for (const row of group) {
    const rowClass = classifyRow(row, skr);
    const { rate, net: rowNet, tax: rowTax, gross: rowGross } = computeRowAmounts(row, rowClass.positive, rowClass.neutral);
    const dirSign = rowClass.direction === direction ? 1 : -1;
    const net = dirSign * rowNet;
    const tax = dirSign * rowTax;
    const gross = dirSign * rowGross;
    totalNet += net;
    totalTax += tax;
    totalGross += gross;
    const existingTax = taxByRate.get(rate);
    if (existingTax) {
      existingTax.net += net;
      existingTax.tax += tax;
    } else {
      taxByRate.set(rate, { rate, net, tax });
    }
    categories.push({
      categoryId: rowClass.categoryAccount,
      rate,
      net,
      tax,
    });
  }

  const positive = totalGross >= 0;
  const type = direction === "einnahme" ? (positive ? "salesinvoice" : "salescreditnote") : positive ? "purchaseinvoice" : "purchasecreditnote";

  const remarks = [...new Set(group.map((r) => r.buchungstext).filter(Boolean))];
  const voucher: LegacyVoucher = {
    lexofficeId: `wiso/${key}`,
    type,
    direction,
    number: first.belegnummer,
    date: first.zahlungsdatum,
    dueDate: null,
    serviceFrom: first.zahlungsdatum,
    serviceTo: first.zahlungsdatum,
    status: "archiviert",
    contactLexofficeId: null,
    contactName: "",
    currency: "EUR",
    net: totalNet,
    tax: totalTax,
    gross: totalGross,
    taxes: [...taxByRate.values()],
    categories,
    fileIds: [],
    remark: remarks.join("; "),
  };

  return {
    voucher,
    bookingKey: key,
    year,
    neutral,
    raw: {
      ohneBeleg: true,
      neutral,
      buchungsnummer: first.buchungsnummer,
      rows: group,
    },
  };
}

export function previewWisoExport(bytes: Uint8Array, skr: Kontenrahmen): WisoPreview {
  const { rows, unreadableBookingDates } = parseWisoCsv(bytes);
  const groups = new Map<string, WisoCsvRow[]>();

  for (const row of rows) {
    const year = row.zahlungsdatum.slice(0, 4);
    const key = row.buchungsnummer ? `${year}/${row.buchungsnummer}` : `${year}/row-${row.rowNumber}`;
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  const vouchers = [...groups.entries()].map(([key, group]) => buildGroupVoucher(key, group, skr));
  const years = [...new Set(vouchers.map((v) => v.year))].sort((a, b) => a - b);
  const dates = rows.map((r) => r.zahlungsdatum).sort();
  const warnings: string[] = [];

  const withoutNumber = vouchers.filter((v) => !v.voucher.number).length;
  if (withoutNumber > 0) {
    warnings.push(`${withoutNumber} Buchungen haben keine Belegnummer.`);
  }
  if (unreadableBookingDates > 0) {
    warnings.push(`Buchungsdatum in ${unreadableBookingDates} Zeilen nicht lesbar oder anonymisiert; Zahlungsdatum verwendet.`);
  }
  const neutralCount = vouchers.filter((v) => v.neutral).length;
  if (neutralCount > 0) {
    warnings.push(`${neutralCount} neutrale Buchungen (z. B. Saldovortrag, Geldtransit, Privat) enthalten.`);
  }

  return {
    years,
    dateFrom: dates[0]!,
    dateTo: dates[dates.length - 1]!,
    bookings: vouchers.length,
    rows: rows.length,
    vouchers,
    warnings,
  };
}
