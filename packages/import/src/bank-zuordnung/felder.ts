import type { ColumnMapping, ImportField } from "../csv-import/mapping.ts";

/**
 * Felder eines Umsatzes, auf die bei einer unbekannten Bank-CSV eine Spalte gelegt werden kann (#1275). Es sind die
 * Felder, die der Bankimport speichert (`bank_transactions`); Mandatsreferenz und Gläubiger-ID speichert er nicht.
 * Der Betrag steht entweder in einer Spalte mit Vorzeichen oder in zwei Spalten für Soll und Haben.
 */
export const BANK_CSV_FIELDS = [
  {
    key: "bookingDate",
    label: "Buchungstag",
    hint: "TT.MM.JJJJ, TT.MM.JJ oder JJJJ-MM-TT",
    aliases: ["Buchungstag", "Buchungsdatum", "Buchung", "Datum", "Booking Date", "Date"],
  },
  { key: "valueDate", label: "Wertstellung", aliases: ["Wertstellung", "Wert", "Valuta", "Valutadatum", "Wertstellungsdatum", "Value Date"] },
  {
    key: "amount",
    label: "Betrag",
    hint: "Mit Vorzeichen; sonst Soll und Haben",
    aliases: ["Betrag", "Betrag (EUR)", "Betrag in EUR", "Betrag (€)", "Umsatz", "Amount"],
  },
  {
    key: "debit",
    label: "Soll (Ausgänge)",
    hint: "Gilt als Ausgang, auch ohne Minus",
    aliases: ["Soll", "Ausgang", "Ausgaben", "Belastung", "Debit", "Debit EUR"],
  },
  { key: "credit", label: "Haben (Eingänge)", aliases: ["Haben", "Eingang", "Einnahmen", "Gutschrift", "Credit", "Kredit EUR"] },
  { key: "currency", label: "Währung", hint: "Leer ist Euro; andere Währungen übernimmt Haben nicht", aliases: ["Währung", "Waehrung", "Currency"] },
  {
    key: "counterpartyName",
    label: "Name der Gegenseite",
    aliases: [
      "Begünstigter / Auftraggeber",
      "Auftraggeber / Begünstigter",
      "Auftraggeber/Empfänger",
      "Zahlungsempfänger",
      "Empfänger",
      "Auftraggeber",
      "Gegenpartei",
      "Name",
      "Payee",
      "Partner Name",
    ],
  },
  { key: "counterpartyIban", label: "IBAN der Gegenseite", aliases: ["IBAN", "Gegen-IBAN", "IBAN Gegenkonto", "Kontonummer/IBAN", "IBAN Auftraggeber"] },
  { key: "purpose", label: "Verwendungszweck", aliases: ["Verwendungszweck", "Zweck", "Beschreibung", "Purpose"] },
  {
    key: "type",
    label: "Buchungsart",
    aliases: ["Umsatzart", "Buchungsart", "Buchungstext", "Transaktionstyp", "Type"],
  },
  { key: "bankReference", label: "Referenz", aliases: ["Kundenreferenz", "Referenz", "End-to-End-Referenz", "Reference"] },
] as const satisfies readonly ImportField[];

export type BankCsvField = (typeof BANK_CSV_FIELDS)[number]["key"];

/** „de“: 1.234,56 · „en“: 1,234.56 */
export type AmountFormat = "de" | "en";

/**
 * Zuordnung, wie sie am Konto gespeichert wird: Sie gilt für Dateien mit genau dieser Kopfzeile. So läuft der nächste
 * Export derselben Bank ohne Rückfrage durch, und der Dubletten-Hash bleibt gleich, weil dieselben Spalten Datum,
 * Betrag, IBAN und Zweck liefern.
 */
export interface BankCsvMapping {
  header: string[];
  columns: ColumnMapping;
  amountFormat: AmountFormat;
}

/** Felder, aus denen der Dubletten-Hash entsteht (dedup.ts), dazu das Zahlenformat, das den Betrag liest */
const HASH_FIELDS: readonly BankCsvField[] = ["bookingDate", "amount", "debit", "credit", "counterpartyIban", "purpose"];

/**
 * Ändert die neue Zuordnung gegenüber der gespeicherten etwas, das in den Dubletten-Hash eingeht? Dann erkennt Haben
 * schon importierte Umsätze derselben Datei nicht mehr als Dubletten.
 */
export function changesDuplicateDetection(stored: BankCsvMapping, next: BankCsvMapping): boolean {
  return stored.amountFormat !== next.amountFormat || HASH_FIELDS.some((key) => (stored.columns[key] ?? null) !== (next.columns[key] ?? null));
}

/** Dieselbe Zuordnung, gleich in welcher Reihenfolge die Schlüssel stehen (Postgres ordnet jsonb um) */
export function sameMapping(a: BankCsvMapping, b: BankCsvMapping): boolean {
  return (
    a.amountFormat === b.amountFormat &&
    a.header.length === b.header.length &&
    a.header.every((name, i) => name === b.header[i]) &&
    BANK_CSV_FIELDS.every((f) => (a.columns[f.key] ?? null) === (b.columns[f.key] ?? null))
  );
}
