import type { ImportBatch, MovementKind } from "../importvertrag/types.ts";
import type { PayPalTransaction } from "./client.ts";

/*
 * Einordnung der Zeilen der Transaction Search (#1512), gemeinsam für den Kontoauszug (`statement.ts`) und die Lieferung
 * des Importvertrags (`batch.ts`), damit beide dieselben Zeilen mit demselben Tag, Betrag und Zweck sehen.
 *
 * Ereigniskennung ist die `transaction_id`. PayPal sagt selbst, dass sie im Reporting nicht eindeutig ist (eine Zeile, die das
 * Guthaben ändert, und eine, die es nicht ändert, können dieselbe tragen); Haben fragt nur nach Zeilen, die es ändern, und
 * nimmt die Kennung allein. Kommt sie dennoch mit zwei Ereigniscodes, behält der erste (nach Code sortiert) die Kennung und jeder
 * weitere bekommt `<Kennung>/<Code>`, damit kein Betrag fehlt und der Vertrag die Lieferung annimmt.
 *
 * Betrag (`transaction_amount`) und Gebühr (`fee_amount`) sind zwei Komponenten desselben Ereignisses. Haben bucht die Gebühr
 * mit dem Vorzeichen, das die API liefert, und nimmt an, dass es bei einer Zahlung negativ ist. Die OpenAPI-Spezifikation von
 * PayPal (`reporting_transactions_v1.json`) sagt dazu nichts („The PayPal fee amount“, ohne Vorzeichen oder Beispiel). Belege
 * für die Annahme sind nur die Spalte „Gebühr“ des Aktivitätenexports (bei Zahlungen negativ) und zwei Integrationen, die die
 * Transaction Search im Echtbetrieb nutzen und die Gebühr ebenso lesen: pgeu-system
 * (`postgresqleu/paypal/management/commands/paypal_fetch.py`) und OCA `account_statement_import_online_paypal`. Eine
 * Antwort der Sandbox von PayPal bestätigt sie (test-fixtures/paypal/sandbox-transaktionen.json: Zahlung −2,25 €, bei der
 * Erstattung +0,38 € zurück); an einem Konto im Livebetrieb ist sie nicht geprüft (#1512). Stimmt die Annahme nicht, bucht
 * Haben nichts Falsches: Eine Zahlung mit positiver Gebühr übernimmt es nicht, sondern meldet sie.
 */

/** Teil des Grunds für ein Ereignis, das Haben nicht einordnet */
const PAYPAL_NICHT_UNTERSTUETZT = "Ereignis nicht unterstützt";

/** T-Code → Art und Beschreibung wie in der [T-Code-Tabelle](https://developer.paypal.com/reports/reference/t-codes); die Beschreibung ist die Spalte „Type“ des Exports (auf Englisch) */
const CODES: Record<string, [MovementKind, string]> = {
  T0000: ["payment", "General payment"],
  T0002: ["payment", "Subscription payment"],
  T0003: ["payment", "Preapproved payment from a user for a recurring bill"],
  T0004: ["payment", "eBay auction payment"],
  T0005: ["payment", "Credit card payment"],
  T0006: ["payment", "Express Checkout payment"],
  T0007: ["payment", "Standard web checkout payment"],
  T0008: ["payment", "Postage payment"],
  T0010: ["payment", "Third-party auction payment"],
  T0011: ["payment", "Mobile payment"],
  T0012: ["payment", "Virtual Terminal payment"],
  T0013: ["payment", "Donation payment"],
  T0014: ["payment", "Rebate payment or cash back with a payment"],
  T0018: ["payment", "PoS payment"],
  T0019: ["payment", "Generic instrument funded payment"],
  T0022: ["payment", "PayPal Seller Profiles"],
  T0023: ["payment", "Business payment"],
  T0100: ["fee", "General non-payment-related fee"],
  T0101: ["fee", "Website Payments Pro account monthly fee"],
  T0106: ["fee", "Chargeback fee"],
  T0107: ["fee", "Payment fee"],
  T0113: ["fee", "Partner fee"],
  T0114: ["fee", "Dispute fee"],
  T1108: ["fee", "Fee reversal"],
  T1109: ["fee", "Fee refund"],
  T0400: ["payout", "General withdrawal - bank account"],
  T0401: ["payout", "Auto-sweep"],
  T0403: ["payout", "Manual withdrawal"],
  T1107: ["refund", "Payment refund"],
  T1120: ["refund", "Payment refund referenced to an authorization transaction"],
  T1106: ["chargeback", "Payment reversal"],
  T1201: ["chargeback", "Chargeback"],
  T1202: ["adjustment", "Chargeback reversal"],
  T1205: ["adjustment", "Reimbursement of chargeback"],
  T1200: ["adjustment", "General account adjustment"],
  T1900: ["adjustment", "General account correction"],
};

/** Bei diesen Arten steht PayPal selbst auf der Gegenseite */
const PAYPAL_IST_GEGENPARTEI = new Set<MovementKind>(["payout", "fee"]);

export const euro = (cents: number) => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

/** `YYYY-MM-DD` aus dem Zeitstempel der API in der Zeitzone des Kontos (IANA-Name, etwa `Europe/Berlin`) */
export function localDay(initiated: string, zone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:?\d{2})$/.exec(initiated.trim());
  if (!match) throw new Error(`Ungültiger Zeitstempel bei PayPal: ${initiated}`);
  const offset = match[7]!;
  const minutes = /^[Zz]$/.test(offset) ? 0 : (offset.startsWith("-") ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(-2)));
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])) - minutes * 60_000;
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(utc));
}

export interface PayPalEntry {
  tx: PayPalTransaction;
  /** Kennung des Ereignisses: die Transaktions-ID, bei einer zweiten Zeile mit derselben ID und anderem Code `<ID>/<Code>` */
  eventId: string;
  bookingDate: string;
  /** null: Ereigniscode, den Haben nicht einordnet; die Zeile kommt als Umsatz in den Auszug, aber ohne Bewegung */
  kind: MovementKind | null;
  /** Beschreibung des Ereigniscodes, die „Type“-Spalte des Exports; sonst der Code selbst */
  typeText: string;
}

export interface PayPalClassified {
  /** Zeilen, die Haben als Umsatz übernimmt */
  entries: PayPalEntry[];
  unsupported: ImportBatch["unsupported"];
}

export interface PayPalWindow {
  /** Zeitzone des Kontos: der Tag einer Zeile ist der in dieser Zone */
  zone: string;
  /** Erster und letzter Tag des Abrufs, YYYY-MM-DD; Zeilen davor und danach (der Client holt Spielraum mit) gehören zum Nachbarabruf */
  dateFrom: string;
  dateTo: string;
}

/** Ordnet die Zeilen ein: übernommen, noch offen (ausstehend), endgültig abgelehnt oder nicht unterstützt */
export function classify(transactions: PayPalTransaction[], window: PayPalWindow): PayPalClassified {
  const entries: PayPalEntry[] = [];
  const unsupported: ImportBatch["unsupported"] = [];
  const codeOf = new Map<string, string>();
  const sorted = [...transactions].sort((a, b) => (a.id === b.id ? a.eventCode.localeCompare(b.eventCode) : a.id < b.id ? -1 : 1));
  for (const tx of sorted) {
    const bookingDate = localDay(tx.initiated, window.zone);
    if (bookingDate < window.dateFrom || bookingDate > window.dateTo) continue;
    const refuse = (reason: string, final = false) =>
      unsupported.push({ sourceEventId: eventId, bookingDate, reason, ...(final ? { final: true as const } : {}) });
    const first = codeOf.get(tx.id);
    if (first === undefined) codeOf.set(tx.id, tx.eventCode);
    const eventId = first === undefined || first === tx.eventCode ? tx.id : `${tx.id}/${tx.eventCode || "ohne-code"}`;
    // S abgeschlossen, V nachträglich zurückgebucht: die Zahlung bleibt gebucht, die Rückbuchung ist ein eigenes Ereignis
    if (tx.status === "D") refuse("Status D (abgelehnt).", true);
    else if (tx.status === "P") refuse("Status P (ausstehend); folgt, sobald PayPal ihn abschließt.");
    else if (tx.status !== "S" && tx.status !== "V") refuse(`Status ${tx.status || "ohne Angabe"} nicht bekannt.`);
    else if (tx.currency !== "EUR" || (tx.fee !== 0 && tx.feeCurrency !== "EUR"))
      refuse(`Währung ${tx.currency !== "EUR" ? tx.currency : tx.feeCurrency}, Haben übernimmt nur Euro.`, true);
    else {
      const known = CODES[tx.eventCode];
      if (known?.[0] === "payment" && tx.amount > 0 && tx.fee > 0) {
        refuse(`Gebühr mit unerwartetem Vorzeichen (+${euro(tx.fee)}) bei einer Zahlung, nicht übernommen.`);
        continue;
      }
      if (!known) refuse(`${PAYPAL_NICHT_UNTERSTUETZT}: ${tx.eventCode || "ohne Code"}.`);
      entries.push({ tx, eventId, bookingDate, kind: known?.[0] ?? null, typeText: known?.[1] ?? (tx.eventCode || "Unbekannt") });
    }
  }
  return { entries, unsupported };
}

/** Name der Gegenseite: bei Auszahlung und Gebühr PayPal, sonst der Name aus der API (leer lassen, wenn sie keinen nennt) */
export function counterpartyOf(entry: PayPalEntry): string {
  return entry.kind && PAYPAL_IST_GEGENPARTEI.has(entry.kind) ? "PayPal" : (entry.tx.payerName ?? "");
}

/** Zweck wie `parsePayPal`: Art, Rechnungsnummer, Betreff, Transaktionscode */
export function purposeOf(entry: PayPalEntry): string {
  const { tx } = entry;
  return [entry.typeText, tx.invoiceId, tx.subject ?? tx.itemTitle, entry.eventId].filter(Boolean).join(" · ");
}
