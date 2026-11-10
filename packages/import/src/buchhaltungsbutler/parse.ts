import { taxIncluded } from "@haben/core";
import { BU_RATES, parseDatevBuchungsstapel, type Kontenrahmen } from "../datev.ts";
import { parseDate, parseGermanAmount } from "../text.ts";
import type { LegacyVoucher } from "../lexoffice/map.ts";
import { joinRows } from "./datev-info.ts";
import { directionOf } from "./direction.ts";
import { readBbRows, readExportFiles, readReceiptFiles, type ExportPart } from "./export-files.ts";
import type { BuchhaltungsbutlerJoinedRow, BuchhaltungsbutlerPreview, BuchhaltungsbutlerVoucher } from "./types.ts";
import { BuchhaltungsbutlerError } from "./types.ts";

export function previewBuchhaltungsbutlerExport(parts: ExportPart[], skr: Kontenrahmen): BuchhaltungsbutlerPreview {
  const files = readExportFiles(parts);
  const stack = parseDatevBuchungsstapel(files.datev);
  const rows = joinRows(readBbRows(files.bb), stack.bookings);
  const receiptFiles = readReceiptFiles(files.receipts);
  const withReceipt = rows.filter((row) => row.info.url !== "");
  const expectedIds = new Set(withReceipt.map((row) => row.info.bookingId));
  for (const row of withReceipt) {
    if (!receiptFiles.has(row.info.bookingId)) throw new BuchhaltungsbutlerError(`Buchung ${row.info.bookingId}: Beleg-URL vorhanden, aber PDF fehlt.`);
  }
  for (const id of receiptFiles.keys()) {
    if (!expectedIds.has(id)) throw new BuchhaltungsbutlerError(`Belege.zip: PDF für Buchung ${id} hat keine Beleg-URL im DATEV-Export.`);
  }
  const year = Number((stack.header.dateFrom ?? stack.header.fiscalYearStart).slice(0, 4));
  const vouchers = withReceipt.map((row) => mapVoucher(row, receiptFiles.get(row.info.bookingId)!, skr, year));
  const warnings: string[] = [];
  const withoutNumber = vouchers.filter((item) => !item.voucher.number).length;
  if (withoutNumber > 0) warnings.push(`${withoutNumber} Belege haben keine Rechnungsnummer und sind nur über Kontakt und Datum suchbar.`);
  const withoutContact = vouchers.filter((item) => !item.voucher.contactName).length;
  if (withoutContact > 0) warnings.push(`${withoutContact} Belege haben keine Gegenpartei im Export.`);
  return {
    year,
    dateFrom: stack.header.dateFrom,
    dateTo: stack.header.dateTo,
    bookings: rows.length,
    vouchers,
    files: vouchers.reduce((sum, item) => sum + item.files.length, 0),
    withoutReceipt: rows.length - withReceipt.length,
    multipleFiles: vouchers.filter((item) => item.files.length > 1).length,
    warnings,
  };
}

function mapVoucher(row: BuchhaltungsbutlerJoinedRow, files: BuchhaltungsbutlerVoucher["files"], skr: Kontenrahmen, year: number): BuchhaltungsbutlerVoucher {
  const mapping = directionOf(row, skr);
  const rate = taxRate(row);
  const sign = mapping.positive ? 1 : -1;
  const gross = sign * row.datev.amount;
  const tax = sign * taxIncluded(row.datev.amount, rate);
  const net = gross - tax;
  const type = mapping.direction === "einnahme" ? (mapping.positive ? "invoice" : "creditnote") : mapping.positive ? "purchaseinvoice" : "purchasecreditnote";
  const taxType = taxTypeOf(row, mapping.direction);
  const number = row.datev.voucherField1 || row.bb.Rechnungsnummern || row.info.invoiceNumber;
  const documentDate = parseDate(row.info.documentDate) ?? row.datev.date;
  const serviceFrom = parseDate(row.bb.Leistungsdatum ?? "") ?? documentDate;
  const raw = {
    bb: row.bb,
    datev: row.datev.raw,
    info: row.info.raw,
    taxType,
    taxConditions: { taxType },
    ohneBeleg: false,
  };
  const voucher: LegacyVoucher = {
    lexofficeId: `booking/${year}/${row.info.bookingId}`,
    type,
    direction: mapping.direction,
    number,
    date: documentDate,
    dueDate: null,
    serviceFrom,
    serviceTo: serviceFrom,
    status: "archiviert",
    contactLexofficeId: null,
    contactName: row.info.contactName || row.bb.Gegenpartei || "",
    currency: row.bb.Währung || row.datev.currency,
    net,
    tax,
    gross,
    taxes: [{ rate, net, tax }],
    categories: [{ categoryId: mapping.categoryAccount, net, tax, rate }],
    fileIds: [],
    remark: row.bb.Kommentar || row.bb.Buchungstext || "",
  };
  return { voucher, bookingId: row.info.bookingId, files, raw };
}

function taxRate(row: BuchhaltungsbutlerJoinedRow): number {
  const text = row.info.taxRateText || row.bb.Umsatzsteuer;
  if (text) {
    const rate = parseGermanAmount(text);
    if (rate === null || rate < 0) throw new BuchhaltungsbutlerError(`Buchung ${row.info.bookingId}: ungültiger Steuersatz „${text}“.`);
    return rate;
  }
  return BU_RATES[row.datev.buKey.trim().replace(/^0+/, "")] ?? 0;
}

function taxTypeOf(row: BuchhaltungsbutlerJoinedRow, direction: "einnahme" | "ausgabe"): string {
  if (direction !== "einnahme") return "net";
  const bu = row.datev.buKey.trim().replace(/^0+/, "");
  if (bu === "2" || bu === "3") return "net";
  return `bb:${bu || "unbekannt"}`;
}
