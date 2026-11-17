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
    hint: "Pflicht. TT.MM.JJJJ, TT.MM.JJ oder JJJJ-MM-TT",
    aliases: ["Buchungstag", "Buchungsdatum", "Buchung", "Datum", "Booking Date", "Date"],
  },
  { key: "valueDate", label: "Wertstellung", aliases: ["Wertstellung", "Wert", "Valuta", "Valutadatum", "Wertstellungsdatum", "Value Date"] },
  {
    key: "amount",
    label: "Betrag",
    hint: "Mit Vorzeichen, Ausgänge negativ; sonst Soll und Haben",
    aliases: ["Betrag", "Betrag (EUR)", "Betrag in EUR", "Betrag (€)", "Umsatz", "Amount"],
  },
  {
    key: "debit",
    label: "Soll (Ausgänge)",
    hint: "Statt Betrag; gilt als Ausgang, auch ohne Minus",
    aliases: ["Soll", "Ausgang", "Ausgaben", "Belastung", "Debit", "Debit EUR"],
  },
  { key: "credit", label: "Haben (Eingänge)", hint: "Statt Betrag", aliases: ["Haben", "Eingang", "Einnahmen", "Gutschrift", "Credit", "Kredit EUR"] },
  { key: "currency", label: "Währung", hint: "Leer ist Euro", aliases: ["Währung", "Waehrung", "Currency"] },
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
    hint: "Etwa Überweisung, Lastschrift",
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
