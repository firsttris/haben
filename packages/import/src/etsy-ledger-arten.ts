import type { EtsyLedgerEntry } from "./etsy-ledger.ts";

/*
 * Ledger-Typen des Etsy-Zahlungsverlaufs und wie Haben sie bucht (etsy-ledger.ts).
 *
 * Die Typen sind nirgends beschrieben; die Zuordnung stammt aus dem echten Verlauf (2.347 Zeilen, Juli 2022 bis
 * Mai 2026) und ist gegen alle 25 Gebührenrechnungen von Juli 2022 bis April 2026 geprüft: Die Summe der Gebühren
 * und Werbung eines Monats (nach dem Tag der Zeile) ergibt jede Rechnungssumme auf den Cent, auch je Rechnungsposition
 * bis auf Rundungscents der Rechnung selbst. Zwei Typen sind leicht zu verkennen:
 *
 * - `shipping_transaction` ist die Transaktionsgebühr auf das Porto (Rechnungsposition „Transaction Fees“), kein Versand.
 * - `transaction_quantity` ist die Einstellgebühr für weitere verkaufte Stücke (Position „Listing Fees“) und trägt Geld.
 */

/** Wie Haben eine Zeile des Verlaufs bucht */
export type Kind =
  | "verkauf"
  | "erstattung"
  | "steuer"
  | "einstellgebuehr"
  | "verlaengerung"
  | "verkaufsverlaengerung"
  | "transaktionsgebuehr"
  | "zahlungsgebuehr"
  | "etsyads"
  | "offsiteads"
  | "gebuehrenumsatzsteuer"
  | "auszahlung"
  | "karteneinzug"
  | "ausgleich";

/** Zuordnung der Ledger-Typen; geprüft gegen die Gebührenrechnungen 07/2022 bis 04/2026 */
export const KINDS: Record<string, Kind> = {
  PAYMENT_GROSS: "verkauf",
  REFUND_GROSS: "erstattung",
  sales_tax: "steuer",
  sales_tax_refund: "steuer",
  listing: "einstellgebuehr",
  listing_refund: "einstellgebuehr",
  transaction_quantity: "einstellgebuehr",
  renew_expired: "verlaengerung",
  auto_renew_expired: "verlaengerung",
  renew_sold_auto: "verkaufsverlaengerung",
  renew_sold_auto_refund: "verkaufsverlaengerung",
  transaction: "transaktionsgebuehr",
  transaction_refund: "transaktionsgebuehr",
  shipping_transaction: "transaktionsgebuehr",
  shipping_transaction_refund: "transaktionsgebuehr",
  PAYMENT_PROCESSING_FEE: "zahlungsgebuehr",
  REFUND_PROCESSING_FEE: "zahlungsgebuehr",
  prolist: "etsyads",
  offsite_ads_fee: "offsiteads",
  // Umsatzsteuer auf die Gebühren, wenn bei Etsy keine USt-IdNr. hinterlegt ist; parent_entry_id nennt die Gebühr
  // (OpenAPI von Etsy). Nicht an einem echten Verlauf ohne USt-IdNr. geprüft.
  vat_seller_services: "gebuehrenumsatzsteuer",
  DISBURSE2: "auszahlung",
  billing_payment: "karteneinzug",
  RECOUP: "ausgleich",
};

/** Ob Haben den Typ einer Verlaufszeile kennt (Zuordnung oben); unbekannte kommen einzeln mit Hinweis */
export const isKnownEtsyLedgerType = (ledgerType: string): boolean => Object.hasOwn(KINDS, ledgerType);

/**
 * Bezeichnung der Sammelzeile je Art, in der Reihenfolge und mit den Namen der Rechnungspositionen (in Klammern).
 * Gebühren und Werbung beginnen mit „Gebühr“ (Zuordnung zur Sammelrechnung); Werbung bleibt als Art „Werbung“ wie beim
 * CSV-Import.
 */
export const BUCKETS: Partial<Record<Kind, { purpose: string; type: string; prefix: string; reference: string }>> = {
  einstellgebuehr: { purpose: "Einstellgebühren (Listing Fees)", type: "Gebühr", prefix: "Gebühr", reference: "einstellgebuehren" },
  verlaengerung: { purpose: "Verlängerungen (Renew Expired Fees)", type: "Gebühr", prefix: "Gebühr", reference: "verlaengerungen" },
  verkaufsverlaengerung: { purpose: "Verlängerungen nach Verkauf (Renew Sold Fees)", type: "Gebühr", prefix: "Gebühr", reference: "verkaufsverlaengerungen" },
  transaktionsgebuehr: { purpose: "Transaktionsgebühren (Transaction Fees)", type: "Gebühr", prefix: "Gebühr", reference: "transaktionsgebuehren" },
  zahlungsgebuehr: { purpose: "Zahlungsabwicklung (Processing Fees)", type: "Gebühr", prefix: "Gebühr", reference: "zahlungsgebuehren" },
  etsyads: { purpose: "Etsy Ads (Etsy Ads Fees)", type: "Werbung", prefix: "Gebühr", reference: "etsyads" },
  offsiteads: { purpose: "Offsite Ads (Offsite Ads Fees)", type: "Werbung", prefix: "Gebühr", reference: "offsiteads" },
  gebuehrenumsatzsteuer: { purpose: "Umsatzsteuer auf Gebühren (VAT)", type: "Gebühr", prefix: "Gebühr", reference: "gebuehrenumsatzsteuer" },
};

/** Zweck einer einzelnen Zeile; Auszahlungen tragen das Wort, das Haben als Geldtransit erkennt */
export function purposeOf(kind: Kind, entry: EtsyLedgerEntry, tag: string, order: string | undefined): string {
  const reference = entry.reference_id ?? "";
  switch (kind) {
    case "verkauf":
      return order ? `Verkauf · Etsy Bestellung ${order}` : `Verkauf · Etsy Zahlung ${reference}`;
    case "erstattung":
      return order ? `Erstattung · Etsy Bestellung ${order}` : `Erstattung · Etsy ${reference}`;
    case "steuer":
      return order ? `Sales Tax · Etsy Bestellung ${order}` : `Sales Tax · Etsy ${reference}`;
    case "auszahlung":
      return `Auszahlung · Etsy ${tag}`;
    case "karteneinzug":
      return `Karteneinzug · Etsy ${tag}`;
    case "ausgleich":
      return `Ausgleich · Etsy ${tag}`;
    default:
      return `Gebühr · Etsy ${entry.ledger_type} ${tag}`;
  }
}

/** Umsatztyp (im Jahresexport Spalte „Umsatztyp“); Verkauf, Erstattung und Steuer wie in etsy.ts */
export function typeOf(kind: Kind): string {
  switch (kind) {
    case "verkauf":
      return "Verkauf";
    case "erstattung":
      return "Erstattung";
    case "auszahlung":
      return "Auszahlung";
    case "karteneinzug":
      return "Karteneinzug";
    case "ausgleich":
      return "Ausgleich";
    case "etsyads":
    case "offsiteads":
      return "Werbung";
    case "steuer":
      return "Umsatzsteuer";
    default:
      return "Gebühr";
  }
}
