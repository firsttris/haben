import type { Cents } from "@haben/core";

export type StatementFormat = "dkb-csv" | "dkb-csv-alt" | "n26-csv" | "camt053";

/** Ein Umsatz, wie er in der Datei steht. Eingänge positiv, Ausgänge negativ. */
export interface ParsedTransaction {
  /** YYYY-MM-DD */
  bookingDate: string;
  valueDate?: string;
  amount: Cents;
  currency: string;
  counterpartyName: string;
  counterpartyIban?: string;
  purpose: string;
  /** Buchungsart der Bank, z. B. "Überweisung", "Lastschrift" */
  type?: string;
  /** Referenz der Bank, falls vorhanden (CAMT AcctSvcrRef, EndToEndId) */
  bankReference?: string;
  /** SEPA-Lastschrift: Gläubiger-ID und Mandatsreferenz, falls die Datei sie nennt */
  creditorId?: string;
  mandateReference?: string;
  /** Laufende Nummer in der Datei, ab 0 */
  index: number;
}

export interface ParsedStatement {
  format: StatementFormat;
  /** Eigene IBAN, falls die Datei sie nennt (N26-CSV tut es nicht) */
  accountIban?: string;
  accountName?: string;
  currency: string;
  periodFrom?: string;
  periodTo?: string;
  /** Saldo vor dem ersten bzw. nach dem letzten Umsatz, falls die Datei ihn nennt */
  openingBalance?: Cents;
  closingBalance?: Cents;
  /** Kontostand, wie ihn die Datei nennt, auch wenn er nicht zum Zeitraum passt */
  statedBalance?: { date: string; amount: Cents };
  transactions: ParsedTransaction[];
  warnings: string[];
}
