import { finish, indexed, type Tx } from "./common.ts";
import { StatementParseError } from "./errors.ts";
import { settlementKey, settleTax, unsettledTaxWarning } from "./etsy.ts";
import type { ParsedStatement } from "./types.ts";

/*
 * Zahlungsverlauf von Etsy Payments über die Open API v3
 * (GET /shops/{shop_id}/payment-account/ledger-entries, `transactions_r`). Anders als die CSV aus
 * „Finanzen › Monatliche Abrechnungen“ ist der Verlauf nicht auf einen Monat begrenzt und trägt je Zeile eine
 * eindeutige `entry_id` und einen Typ.
 *
 * Die Typen sind nirgends beschrieben; die Zuordnung stammt aus dem echten Verlauf (2.347 Zeilen, Juli 2022 bis
 * Mai 2026) und ist gegen alle 21 Gebührenrechnungen von August 2022 bis April 2024 geprüft: Die Summe der Gebühren
 * und Werbung eines Monats (nach dem Tag der Zeile) ergibt jede Rechnungssumme auf den Cent, auch je Rechnungsposition
 * bis auf Rundungscents der Rechnung selbst. Zwei Typen sind leicht zu verkennen:
 *
 * - `shipping_transaction` ist die Transaktionsgebühr auf das Porto (Rechnungsposition „Transaction Fees“), kein Versand.
 * - `transaction_quantity` ist die Einstellgebühr für weitere verkaufte Stücke (Position „Listing Fees“) und trägt Geld.
 *
 * Gebucht wird wie beim CSV-Import (etsy.ts) und nach der Etsy-Gebührenrechnung:
 *
 * - Verkauf (PAYMENT_GROSS) und Erstattung (REFUND_GROSS) einzeln, mit der Bestellnummer im Zweck.
 * - Die Steuer des Käufers (sales_tax, etwa US Sales Tax) zieht Etsy ein und führt sie ab; sie ist weder Erlös noch
 *   Gebühr. Wie beim CSV-Import wird sie mit dem Verkauf bzw. der Erstattung derselben Bestellung am selben Tag verrechnet
 *   (settleTax), damit der Verkauf mit dem Betrag der Rechnung ankommt. Ohne genau einen solchen Partner bleibt sie mit
 *   Bestellnummer einzeln stehen.
 * - Gebühren und Werbung je Monat zu je einer Zeile gebündelt, am letzten Tag des Monats, mit dem Wort „Gebühr“ am
 *   Anfang, damit der Bankabgleich sie der Sammelrechnung zuordnen kann.
 * - Auszahlung (DISBURSE2) als eigener Umsatz: Geldtransit, kein Erlös.
 * - Karteneinzug (billing_payment) und Verrechnung (RECOUP) bleiben einzeln und werden nicht zu Gebühren gerechnet.
 *
 * Die Bestellnummer steht im Verlauf nur bei der Steuerzeile direkt (sales_tax, reference_id ist die Bestellung).
 * Verkauf und Erstattung tragen die Zahlungs- bzw. Erstattungsnummer; die Bestellung dazu liefert
 * GET /shops/{shop_id}/payment-account/ledger-entries/payments (orderFor).
 */

/** Eine Zeile des Etsy-Zahlungsverlaufs, wie die API sie liefert (Beträge in Cent, Zeitstempel in Sekunden) */
export interface EtsyLedgerEntry {
  entry_id?: number;
  ledger_id?: number;
  sequence_number?: number;
  amount: number;
  currency: string;
  description?: string;
  balance?: number;
  /** Zeitpunkt der Buchung in Epoch-Sekunden */
  created_timestamp?: number;
  ledger_type: string;
  reference_type?: string;
  /** Objektkennung; Etsy liefert sie je Typ als Text oder als Zahl */
  reference_id?: string | number;
  parent_entry_id?: number;
}

/** Wie Haben eine Zeile des Verlaufs bucht */
type Kind =
  | "verkauf"
  | "erstattung"
  | "steuer"
  | "einstellgebuehr"
  | "transaktionsgebuehr"
  | "zahlungsgebuehr"
  | "werbung"
  | "auszahlung"
  | "karteneinzug"
  | "verrechnung";

/** Zuordnung der Ledger-Typen; geprüft gegen die Gebührenrechnungen 08/2022 bis 04/2024 */
const KINDS: Record<string, Kind> = {
  PAYMENT_GROSS: "verkauf",
  REFUND_GROSS: "erstattung",
  sales_tax: "steuer",
  sales_tax_refund: "steuer",
  listing: "einstellgebuehr",
  renew_expired: "einstellgebuehr",
  auto_renew_expired: "einstellgebuehr",
  renew_sold_auto: "einstellgebuehr",
  listing_refund: "einstellgebuehr",
  renew_sold_auto_refund: "einstellgebuehr",
  transaction_quantity: "einstellgebuehr",
  transaction: "transaktionsgebuehr",
  transaction_refund: "transaktionsgebuehr",
  shipping_transaction: "transaktionsgebuehr",
  shipping_transaction_refund: "transaktionsgebuehr",
  PAYMENT_PROCESSING_FEE: "zahlungsgebuehr",
  REFUND_PROCESSING_FEE: "zahlungsgebuehr",
  prolist: "werbung",
  offsite_ads_fee: "werbung",
  DISBURSE2: "auszahlung",
  billing_payment: "karteneinzug",
  RECOUP: "verrechnung",
};

/** Bezeichnung der Sammelzeile je Art; Gebühren und Werbung beginnen mit „Gebühr“ (Zuordnung zur Sammelrechnung) */
const BUCKETS: Partial<Record<Kind, { purpose: string; type: string; prefix: string; reference: string }>> = {
  einstellgebuehr: { purpose: "Einstellgebühren", type: "Gebühr", prefix: "Gebühr", reference: "einstellgebuehren" },
  transaktionsgebuehr: { purpose: "Transaktionsgebühren", type: "Gebühr", prefix: "Gebühr", reference: "transaktionsgebuehren" },
  zahlungsgebuehr: { purpose: "Zahlungsabwicklung", type: "Gebühr", prefix: "Gebühr", reference: "zahlungsgebuehren" },
  // Werbung steht auf der Gebührenrechnung, bleibt aber als Art „Werbung“ wie beim CSV-Import
  werbung: { purpose: "Werbung", type: "Werbung", prefix: "Gebühr", reference: "werbung" },
};

/** Kennung einer Sammelzeile (Art und Monat), wie sie hinter „etsy-“ in der Bankreferenz steht */
export function etsySammelKennung(reference: string, monat: string): string {
  return `${reference}-${monat}`;
}

export interface EtsyLedgerOptions {
  /** Bestellnummer zur Zahlungs- oder Erstattungsnummer (Payments-Abruf); fehlt sie, steht die Referenz im Zweck */
  orderFor?: (referenceId: string) => string | undefined;
  /**
   * Gebühren und Werbung je Monat zu einer Zeile bündeln (Vorgabe). Aus schaltet das ab: dann bleibt jede Zeile des
   * Verlaufs ein eigener Umsatz, wie in der CSV-Datei von Etsy.
   */
  sammelzeilen?: boolean;
  /**
   * Bündeln nur bis zu diesem Tag (JJJJ-MM-TT), in der Regel der letzte Tag des Vormonats, ab dem 5. des Folgemonats.
   * Etsy korrigiert Gebühren eines Monats noch nachträglich, deshalb entsteht die Sammelzeile erst, wenn der Monat
   * vorbei und die Korrekturzeit abgelaufen ist. Spätere Gebührenzeilen werden übersprungen und mit dem nächsten Abruf
   * gebündelt; sonst stünde derselbe Betrag zweimal im Konto (einmal einzeln, einmal in der Sammelzeile).
   */
  gebuehrenBis?: string;
  /**
   * Sammelzeilen, die schon im Konto stehen (etsySammelKennung). Ihre Zeilen bleiben weg: Ein Abruf, der wegen der
   * Überlappung in einen schon gebündelten Monat reicht, ergäbe sonst eine zweite Sammelzeile mit einer Teilsumme.
   */
  schonGebuendelt?: ReadonlySet<string>;
}

/** Buchungstag aus dem Zeitstempel, in UTC wie im Backoffice; Etsy liefert Epoch-Sekunden */
function tag(entry: EtsyLedgerEntry, where: string): string {
  if (!entry.created_timestamp) throw new StatementParseError(`Zeile ohne Zeitstempel (${where}).`);
  return new Date(entry.created_timestamp * 1000).toISOString().slice(0, 10);
}

/** Letzter Tag des Monats „JJJJ-MM“ */
function monatsende(monat: string): string {
  const [jahr, monatsteil] = monat.split("-").map(Number);
  if (!jahr || !monatsteil) throw new StatementParseError(`Monat nicht lesbar: ${monat}.`);
  const letzter = new Date(Date.UTC(jahr, monatsteil, 0));
  return letzter.toISOString().slice(0, 10);
}

/** Zweck einer einzelnen Zeile; Auszahlungen tragen das Wort, das Haben als Geldtransit erkennt */
function purposeOf(kind: Kind, entry: EtsyLedgerEntry, tag: string, order: string | undefined): string {
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
    case "verrechnung":
      return `Verrechnung · Etsy ${tag}`;
    default:
      return `Gebühr · Etsy ${entry.ledger_type} ${tag}`;
  }
}

/** Bezeichnung des Umsatzes, wie Haben sie in der Umsatzliste zeigt; Verkauf, Erstattung und Steuer wie in etsy.ts */
function typeOf(kind: Kind): string {
  switch (kind) {
    case "verkauf":
      return "Verkauf";
    case "erstattung":
      return "Erstattung";
    case "auszahlung":
      return "Auszahlung";
    case "karteneinzug":
      return "Karteneinzug";
    case "verrechnung":
      return "Verrechnung";
    case "werbung":
      return "Werbung";
    case "steuer":
      return "Umsatzsteuer";
    default:
      return "Gebühr";
  }
}

function unbekanntWarning(typen: string[]): string[] {
  if (typen.length === 0) return [];
  const namen = [...new Set(typen)].map((t) => t || "ohne Typ").join(", ");
  return [`${typen.length} ${typen.length === 1 ? "Zeile" : "Zeilen"} mit unbekanntem Typ (${namen}) einzeln übernommen.`];
}

/** Zahlungsverlauf von Etsy Payments als Kontoauszug. Zeilen ohne Euro werden übersprungen und gemeldet. */
export function parseEtsyLedger(entries: EtsyLedgerEntry[], options: EtsyLedgerOptions = {}): ParsedStatement {
  const sammelzeilen = options.sammelzeilen ?? true;
  const list: Tx[] = [];
  // Verkäufe, Erstattungen und Steuerzeilen merken sich Bestellung und Tag für settleTax
  const orders = new Map<Tx, string>();
  const gebuendelt = new Map<string, { amount: number; purpose: string; type: string; monat: string; reference: string }>();
  const unbekannt: string[] = [];
  let fremdwaehrung = 0;
  let spaeter = 0;
  let schonDa = 0;

  entries
    .map((entry, position) => ({ entry, tag: tag(entry, `Zeile ${position + 1}`) }))
    .sort((a, b) => (a.entry.created_timestamp ?? 0) - (b.entry.created_timestamp ?? 0))
    .forEach(({ entry, tag: buchungstag }) => {
      if (entry.currency && entry.currency.toUpperCase() !== "EUR") {
        fremdwaehrung++;
        return;
      }
      if (entry.amount === 0) return;
      const kind = KINDS[entry.ledger_type];
      const order =
        kind === "verkauf" || kind === "erstattung"
          ? // Etsy liefert die Kennung je Typ als Text oder als Zahl; der Abruf liefert Texte, deshalb angleichen
            options.orderFor?.(entry.reference_id === undefined ? "" : String(entry.reference_id))
          : kind === "steuer" && entry.reference_id !== undefined
            ? String(entry.reference_id)
            : undefined;
      const bucket = kind ? BUCKETS[kind] : undefined;
      if (sammelzeilen && kind && bucket) {
        const monat = buchungstag.slice(0, 7);
        const schluessel = etsySammelKennung(bucket.reference, monat);
        if (options.schonGebuendelt?.has(schluessel)) {
          schonDa++;
          return;
        }
        // Gebühren eines noch laufenden Monats bleiben liegen: die Sammelzeile entsteht erst, wenn er vorbei ist
        if (options.gebuehrenBis !== undefined && monatsende(monat) > options.gebuehrenBis) {
          spaeter++;
          return;
        }
        const vorhanden = gebuendelt.get(schluessel);
        if (vorhanden) {
          vorhanden.amount += entry.amount;
          return;
        }
        gebuendelt.set(schluessel, {
          amount: entry.amount,
          purpose: `${bucket.prefix} · ${bucket.purpose} ${monat}`,
          type: bucket.type,
          monat,
          reference: schluessel,
        });
        return;
      }
      if (!kind) unbekannt.push(entry.ledger_type);
      const tx: Tx = {
        bookingDate: buchungstag,
        amount: entry.amount,
        currency: "EUR",
        counterpartyName: "Etsy",
        purpose: kind ? purposeOf(kind, entry, buchungstag, order) : `Etsy ${entry.ledger_type} · ${buchungstag}`,
        type: kind ? typeOf(kind) : entry.ledger_type,
        // Die entry_id ist im Verlauf eindeutig und bleibt es auch beim zweiten Abruf
        bankReference: entry.entry_id ? `etsy-${entry.entry_id}` : undefined,
      };
      list.push(tx);
      if (order !== undefined && (kind === "verkauf" || kind === "erstattung" || kind === "steuer")) {
        orders.set(tx, settlementKey(order, buchungstag));
      }
    });

  const settled = settleTax(list, orders);
  for (const b of gebuendelt.values()) {
    settled.list.push({
      bookingDate: monatsende(b.monat),
      amount: b.amount,
      currency: "EUR",
      counterpartyName: "Etsy",
      purpose: b.purpose,
      type: b.type,
      bankReference: `etsy-${b.reference}`,
    });
  }

  settled.list.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
  const warnings = [...unbekanntWarning(unbekannt), ...unsettledTaxWarning(settled.unsettled)];
  if (fremdwaehrung > 0) warnings.push(`${fremdwaehrung} ${fremdwaehrung === 1 ? "Zeile" : "Zeilen"} nicht in Euro übersprungen.`);
  if (spaeter > 0) warnings.push(`${spaeter} Gebühren- und Werbezeile(n) aus einem noch laufenden Monat kommen mit dem nächsten Abruf als Sammelzeile.`);
  if (schonDa > 0) {
    warnings.push(`${schonDa} Gebühren- und Werbezeile(n) aus einem schon gebündelten Monat übersprungen; die Sammelzeile steht bereits im Konto.`);
  }
  return finish({
    format: "etsy-ledger",
    currency: "EUR",
    transactions: indexed(settled.list),
    warnings,
  });
}
