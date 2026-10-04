/**
 * DATEV-Buchungsstapel (EXTF, Formatkategorie 21, Version 13) aus dem Journal von Haben, für die
 * Steuerberatung. Jede Buchung mit mehreren Zeilen wird in Buchungssätze Konto an Gegenkonto
 * zerlegt; die Summe je Konto bleibt exakt wie im Journal. Auf DATEV-Automatikkonten setzt der
 * Export den BU-Schlüssel 40 (Aufhebung der Automatik), weil die Umsatzsteuer schon als eigene
 * Zeile im Journal steht und DATEV sie sonst ein zweites Mal herausrechnen würde.
 */

export interface DatevExportLine {
  account: string;
  debit: number;
  credit: number;
}

export interface DatevExportEntry {
  /** JJJJ-MM-TT */
  date: string;
  description: string;
  /** Belegfeld 1, z. B. die Rechnungsnummer */
  voucher: string;
  lines: DatevExportLine[];
  /** Festgeschrieben in Haben */
  locked: boolean;
}

export interface DatevExportHeader {
  beraterNr: string;
  mandantNr: string;
  /** JJJJ-MM-TT */
  fiscalYearStart: string;
  dateFrom: string;
  dateTo: string;
  description: string;
  kontenrahmen: "SKR03" | "SKR04";
  /** Zeitpunkt der Erzeugung */
  createdAt: Date;
}

export interface DatevBookingRow {
  amount: number;
  side: "S" | "H";
  account: string;
  contraAccount: string;
  buKey: string;
  date: string;
  voucher: string;
  text: string;
  locked: boolean;
}

/** Erlöskonten mit Umsatzsteuer-Automatik in den DATEV-Standardkontenrahmen */
export const DATEV_AUTOMATIC_ACCOUNTS: Record<DatevExportHeader["kontenrahmen"], ReadonlySet<string>> = {
  SKR03: new Set(["8400", "8300"]),
  SKR04: new Set(["4400", "4300"]),
};

/**
 * Zerlegt eine ausgeglichene Buchung in Buchungssätze. Soll- und Habenzeilen werden der Größe nach
 * gegeneinander verrechnet; jede Zeile landet so vollständig bei ihrem Konto.
 */
export function splitEntry(entry: DatevExportEntry, kontenrahmen: DatevExportHeader["kontenrahmen"]): DatevBookingRow[] {
  const debits = entry.lines.filter((l) => l.debit > 0).map((l) => ({ account: l.account, rest: l.debit }));
  const credits = entry.lines.filter((l) => l.credit > 0).map((l) => ({ account: l.account, rest: l.credit }));
  const sumDebit = debits.reduce((s, l) => s + l.rest, 0);
  const sumCredit = credits.reduce((s, l) => s + l.rest, 0);
  if (sumDebit !== sumCredit) throw new Error(`Buchung „${entry.description}“ ist nicht ausgeglichen (${sumDebit} ≠ ${sumCredit}).`);
  debits.sort((a, b) => b.rest - a.rest);
  credits.sort((a, b) => b.rest - a.rest);
  const automatic = DATEV_AUTOMATIC_ACCOUNTS[kontenrahmen];
  const rows: DatevBookingRow[] = [];
  let d = 0;
  let c = 0;
  while (d < debits.length && c < credits.length) {
    const debit = debits[d]!;
    const credit = credits[c]!;
    const amount = Math.min(debit.rest, credit.rest);
    rows.push({
      amount,
      side: "S",
      account: debit.account,
      contraAccount: credit.account,
      buKey: automatic.has(debit.account) || automatic.has(credit.account) ? "40" : "",
      date: entry.date,
      voucher: entry.voucher,
      text: entry.description,
      locked: entry.locked,
    });
    debit.rest -= amount;
    credit.rest -= amount;
    if (debit.rest === 0) d++;
    if (credit.rest === 0) c++;
  }
  return rows;
}

/** Spalten der Formatversion 13; DATEV liest EXTF-Dateien nach Position */
export const DATEV_COLUMNS = [
  "Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basis-Umsatz", "WKZ Basis-Umsatz", "Konto",
  "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum", "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext",
  "Postensperre", "Diverse Adressnummer", "Geschäftspartnerbank", "Sachverhalt", "Zinssperre", "Beleglink",
  ...Array.from({ length: 8 }, (_, i) => [`Beleginfo - Art ${i + 1}`, `Beleginfo - Inhalt ${i + 1}`]).flat(),
  "KOST1 - Kostenstelle", "KOST2 - Kostenstelle", "Kost-Menge", "EU-Mitgliedstaat u. UStID (Bestimmung)", "EU-Steuersatz (Bestimmung)",
  "Abw. Versteuerungsart", "Sachverhalt L+L", "Funktionsergänzung L+L", "BU 49 Hauptfunktionstyp", "BU 49 Hauptfunktionsnummer",
  "BU 49 Funktionsergänzung",
  ...Array.from({ length: 20 }, (_, i) => [`Zusatzinformation - Art ${i + 1}`, `Zusatzinformation- Inhalt ${i + 1}`]).flat(),
  "Stück", "Gewicht", "Zahlweise", "Forderungsart", "Veranlagungsjahr", "Zugeordnete Fälligkeit", "Skontotyp", "Auftragsnummer",
  "Buchungstyp", "USt-Schlüssel (Anzahlungen)", "EU-Land (Anzahlungen)", "Sachverhalt L+L (Anzahlungen)", "EU-Steuersatz (Anzahlungen)",
  "Erlöskonto (Anzahlungen)", "Herkunft-Kz", "Buchungs GUID", "KOST-Datum", "SEPA-Mandatsreferenz", "Skontosperre", "Gesellschaftername",
  "Beteiligtennummer", "Identifikationsnummer", "Zeichnernummer", "Postensperre bis", "Bezeichnung SoBil-Sachverhalt",
  "Kennzeichen SoBil-Buchung", "Festschreibung", "Leistungsdatum", "Datum Zuord. Steuerperiode", "Fälligkeit", "Generalumkehr (GU)",
  "Steuersatz", "Land",
] as const;

const text = (value: string) => `"${value.replace(/"/g, '""').replace(/[\r\n]+/g, " ")}"`;
const compact = (iso: string) => iso.replace(/-/g, "");
const amount = (cents: number) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
/** Belegfeld 1 erlaubt laut DATEV nur bestimmte Zeichen, höchstens 36 */
const voucherField = (value: string) => value.replace(/[^A-Za-z0-9$&%*+\-/.]/g, "").slice(0, 36);
const pad2 = (n: number) => String(n).padStart(2, "0");

function stamp(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}${String(date.getMilliseconds()).padStart(3, "0")}`;
}

/** Kopfzeile laut Schnittstellenbeschreibung (31 Felder) */
function headerLine(h: DatevExportHeader): string {
  const fields: (string | number)[] = [
    text("EXTF"), 700, 21, text("Buchungsstapel"), 13, stamp(h.createdAt), "", text("HB"), text(""), text(""),
    h.beraterNr, h.mandantNr, compact(h.fiscalYearStart), 4, compact(h.dateFrom), compact(h.dateTo), text(h.description.slice(0, 30)),
    text(""), 1, 0, 1, text("EUR"), "", text(""), "", "", text(h.kontenrahmen === "SKR04" ? "04" : "03"), "", "", text(""), text(""),
  ];
  return fields.join(";");
}

function bookingLine(row: DatevBookingRow): string {
  const fields: string[] = new Array(DATEV_COLUMNS.length).fill("");
  const set = (column: (typeof DATEV_COLUMNS)[number], value: string) => {
    fields[DATEV_COLUMNS.indexOf(column)] = value;
  };
  set("Umsatz (ohne Soll/Haben-Kz)", amount(row.amount));
  set("Soll/Haben-Kennzeichen", text(row.side));
  set("WKZ Umsatz", text("EUR"));
  set("Konto", row.account);
  set("Gegenkonto (ohne BU-Schlüssel)", row.contraAccount);
  set("BU-Schlüssel", row.buKey ? text(row.buKey) : "");
  set("Belegdatum", `${row.date.slice(8, 10)}${row.date.slice(5, 7)}`);
  set("Belegfeld 1", text(voucherField(row.voucher)));
  set("Buchungstext", text(row.text.slice(0, 60)));
  set("Festschreibung", row.locked ? "1" : "0");
  return fields.join(";");
}

/** Windows-1252, wie DATEV EXTF-Dateien erwartet; nicht darstellbare Zeichen werden zu „?“ */
const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97, "·": 0xb7,
};

export function encodeCp1252(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  let i = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    out[i++] = CP1252[ch] ?? (code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : 0x3f);
  }
  return out.subarray(0, i);
}

export function buildDatevBuchungsstapel(header: DatevExportHeader, entries: DatevExportEntry[]): { bytes: Uint8Array; rows: DatevBookingRow[] } {
  if (!/^\d{4,7}$/.test(header.beraterNr)) throw new Error("Die Beraternummer hat 4 bis 7 Ziffern.");
  if (!/^\d{1,5}$/.test(header.mandantNr)) throw new Error("Die Mandantennummer hat 1 bis 5 Ziffern.");
  const rows = entries.flatMap((entry) => splitEntry(entry, header.kontenrahmen));
  const lines = [headerLine(header), DATEV_COLUMNS.map(text).join(";"), ...rows.map(bookingLine)];
  return { bytes: encodeCp1252(`${lines.join("\r\n")}\r\n`), rows };
}
