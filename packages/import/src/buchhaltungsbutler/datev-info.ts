import type { DatevBooking } from "../datev.ts";
import { parseDate, parseGermanAmount } from "../text.ts";
import type { BuchhaltungsbutlerInfo, BuchhaltungsbutlerJoinedRow, BuchhaltungsbutlerRow } from "./types.ts";
import { BuchhaltungsbutlerError } from "./types.ts";

const INFO_NAMES = ["Buchungsnummer", "URL", "Gegenpartei", "Rechnungsnummer", "Betrag", "Umsatzsteuer", "Rechnungsdatum"] as const;

export function datevInfo(row: BuchhaltungsbutlerRow): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 1; i <= 8; i++) {
    const name = row[`Beleginfo - Art ${i}`]?.trim();
    if (name) result[name] = row[`Beleginfo - Inhalt ${i}`]?.trim() ?? "";
  }
  return result;
}

export function bookingIdOf(row: BuchhaltungsbutlerRow): string {
  return datevInfo(row).Buchungsnummer?.trim() ?? "";
}

export function requireBookingId(row: BuchhaltungsbutlerRow): string {
  const id = bookingIdOf(row);
  if (!/^\d+$/.test(id)) throw new BuchhaltungsbutlerError(`DATEV-Zeile ${row.__row}: Buchungsnummer fehlt oder ist ungültig.`);
  return id;
}

export function readInfo(row: BuchhaltungsbutlerRow): BuchhaltungsbutlerInfo {
  const raw = datevInfo(row);
  return {
    bookingId: requireBookingId(row),
    url: raw.URL ?? "",
    contactName: raw.Gegenpartei ?? "",
    invoiceNumber: raw.Rechnungsnummer ?? "",
    grossText: raw.Betrag ?? "",
    taxRateText: raw.Umsatzsteuer ?? "",
    documentDate: raw.Rechnungsdatum ?? "",
    raw,
  };
}

function requireBbBookingId(row: BuchhaltungsbutlerRow): string {
  const id = row.Buchungsnummer?.trim() ?? "";
  if (!/^\d+$/.test(id)) throw new BuchhaltungsbutlerError(`BB-Zeile ${row.__row}: Buchungsnummer fehlt oder ist ungültig.`);
  return id;
}

export function joinRows(bbRows: BuchhaltungsbutlerRow[], datevRows: DatevBooking[]): BuchhaltungsbutlerJoinedRow[] {
  const bbById = uniqueBy(bbRows, requireBbBookingId, "BB-Buchungsstapel");
  const datevById = uniqueBy(datevRows, (row) => requireBookingId(row.raw), "DATEV-Buchungsstapel");
  for (const id of Object.keys(bbById)) {
    if (!datevById[id]) throw new BuchhaltungsbutlerError(`Buchung ${id} fehlt im DATEV-Buchungsstapel.`);
  }
  for (const id of Object.keys(datevById)) {
    if (!bbById[id]) throw new BuchhaltungsbutlerError(`Buchung ${id} fehlt im BB Standardexport.`);
  }
  return datevRows.map((datev) => {
    const bb = bbById[requireBookingId(datev.raw)]!;
    compareRows(bb, datev);
    return {
      bb,
      datev,
      info: readInfo(datev.raw),
      debitAccount: datev.side === "S" ? datev.account : datev.contraAccount,
      creditAccount: datev.side === "H" ? datev.account : datev.contraAccount,
    };
  });
}

function uniqueBy<T>(rows: T[], idOf: (row: T) => string, label: string): Record<string, T> {
  const result: Record<string, T> = {};
  for (const row of rows) {
    const id = idOf(row);
    if (result[id]) throw new BuchhaltungsbutlerError(`${label}: Buchungsnummer ${id} ist doppelt enthalten.`);
    result[id] = row;
  }
  return result;
}

function compareRows(bb: BuchhaltungsbutlerRow, datev: DatevBooking): void {
  const id = bb.Buchungsnummer ?? "?";
  const problems: string[] = [];
  if (parseGermanAmount(bb.Betrag ?? "") !== datev.amount) problems.push(`Betrag ${bb.Betrag} entspricht nicht ${datev.amount} Cent`);
  if (bb.Sollkonto !== (datev.side === "S" ? datev.account : datev.contraAccount)) problems.push("Sollkonto weicht ab");
  if (bb.Habenkonto !== (datev.side === "H" ? datev.account : datev.contraAccount)) problems.push("Habenkonto weicht ab");
  if (bb.Steuerschlüssel !== datev.buKey) problems.push("Steuerschlüssel weicht ab");
  if (parseDate(bb.Datum ?? "") !== datev.date) problems.push("Datum weicht ab");
  if (problems.length > 0) throw new BuchhaltungsbutlerError(`Buchung ${id}: BB- und DATEV-Export weichen ab (${problems.join(", ")}).`);
}

export function infoNames(): readonly string[] {
  return INFO_NAMES;
}
