import type { Cents } from "@haben/core";

export type StatementFormat =
  | "dkb-csv"
  | "dkb-csv-alt"
  | "n26-csv"
  /** Kontoauszug von Swan (CSV mit Kopfblock, Datum TT/MM/JJJJ) */
  | "swan-csv"
  /** Umsätze aus dem Online-Banking der Commerzbank (Semikolon-CSV ohne Kontostand) */
  | "commerzbank-csv"
  /** Umsätze aus dem Online-Banking der BW-Bank, Baden-Württembergische Bank (Semikolon-CSV mit „Auftragskonto“, ohne Kontostand) */
  | "bw-bank-csv"
  /** Umsatzanzeige der ING (Semikolon-CSV mit Kopfblock, Saldo je Zeile; auch als gefilterter Export) */
  | "ing-csv"
  /** Umsätze eines Kontos oder einer Pocket bei C24 (Komma-CSV ohne IBAN und Kontostand) */
  | "c24-csv"
  /** Umsätze aus dem Online-Banking der Deutschen Bank, Norisbank und Postbank (Semikolon-CSV mit Kopfblock) */
  | "deutsche-bank-group-csv"
  /** Unbekannte Bank-CSV, Spalten von Hand zugeordnet (#1275) */
  | "csv-zuordnung"
  | "camt053"
  | "enablebanking"
  /** Abruf über FinTS (HKKAZ mit MT940 oder HKCAZ mit CAMT.052), #654 */
  | "fints"
  /** Kontobewegungen aus dem Accountable-Export (Daten.xlsx, Sheet „Kontobewegungen“) */
  | "accountable-xlsx"
  | "paypal-csv"
  /** Abruf der Transaction Search über die PayPal-API (#1512) */
  | "paypal-api"
  | "stripe-csv"
  /** Abruf der Balance Transactions über die Stripe-API (#1280) */
  | "stripe-api"
  | "shopify-payments-csv"
  | "ebay-csv"
  | "etsy-csv"
  /** Zahlungsverlauf von Etsy Payments über die Open API v3 (kein Dateiimport) */
  | "etsy-ledger"
  | "googleplay-earnings"
  | "appstore-finance"
  | "store-payout"
  /** Lieferung eines Dienstes über den REST-Import (#306), ins Bankkonto bzw. ins Konto eines Zahlungsdienstleisters */
  | "importvertrag"
  | "importvertrag-psp";

/** Exporte von Zahlungsdienstleistern: nur in ein Konto mit diesem Zweck importierbar */
export const PSP_FORMATS: StatementFormat[] = [
  "paypal-csv",
  "paypal-api",
  "stripe-csv",
  "stripe-api",
  "shopify-payments-csv",
  "ebay-csv",
  "etsy-csv",
  "etsy-ledger",
  "googleplay-earnings",
  "appstore-finance",
  "store-payout",
  "importvertrag-psp",
];

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
  /** Originale Enable-Banking-entry_reference, getrennt von der bisherigen bankReference. */
  entryReference?: string;
  /** Veränderliche transaction_id von Enable Banking; keine stabile Umsatzkennung. */
  providerTransactionId?: string;
  /** Position im Enable-Banking-Abruf vor der Sortierung des Auszugs. */
  providerRowIndex?: number;
  /** Kennung des Auftraggebers (CAMT Refs/EndToEndId), auch wenn bankReference die Referenz der Bank trägt */
  endToEndId?: string;
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
