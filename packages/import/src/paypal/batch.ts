import { IMPORT_CONTRACT_VERSION, type ImportBatch, type ImportMovement } from "../importvertrag/types.ts";
import { counterpartyOf, purposeOf, type PayPalClassified, type PayPalEntry } from "./eintraege.ts";

/*
 * Ein Abruf der Transaction Search als Lieferung des Importvertrags (#306, #1512). Ereigniskennung ist die
 * `transaction_id`; Betrag und Gebühr sind zwei Komponenten (`main`/`fee`), ein Netto-Umsatz käme nicht dazu, er zählte
 * doppelt (+100,00 € und −3,00 € ergeben +97,00 €). Die Gebühr trägt das Vorzeichen der API (bei einer Zahlung negativ).
 *
 * Art nach dem T-Code (`eintraege.ts`). Eine Rückerstattung, Rückbuchung oder Korrektur nennt mit `paypal_reference_id`
 * (Typ `TXN`) die Transaktion, auf die sie sich bezieht: `relatedEventId`. Eine Zahlung mit Status `V` (nachträglich
 * zurückgebucht) bleibt gebucht; ihre Rückbuchung ist eine eigene Zeile mit eigener Kennung, die der Abruf ohnehin liefert.
 * Ausstehend (`P`) und abgelehnt (`D`), Fremdwährung und nicht eingeordnete T-Codes stehen unter `unsupported`.
 */

export interface PayPalBatchInput {
  /** Kontokennung der Quellenbindung: die `account_id` des Händlerkontos */
  externalAccountId: string;
  /** Ergebnis von `classify`; die Lieferung nimmt davon nur, was eine Art hat */
  classified: PayPalClassified;
  /** Abgerufenes Fenster, YYYY-MM-DD */
  dateFrom: string;
  dateTo: string;
  /** Zeitpunkt des Abrufs mit Offset; sein Tag darf nicht vor `dateTo` liegen */
  fetchedAt: string;
  /** Kennung dieses Abrufs; der Client holt alle Seiten selbst, die Lieferung hat deshalb genau einen Teil */
  fetchId: string;
}

/** Diese Arten nennen die Zahlung, auf die sie sich beziehen */
const RELATED = new Set(["refund", "chargeback", "adjustment"]);

function movements(entry: PayPalEntry): ImportMovement[] {
  const { tx, kind } = entry;
  if (!kind) return [];
  const base = { sourceEventId: entry.eventId, kind, bookingDate: entry.bookingDate, sourceTimestamp: tx.initiated, currency: "EUR" };
  const references = {
    providerReference: entry.eventId,
    ...(tx.eventCode ? { eventCode: tx.eventCode } : {}),
    ...(RELATED.has(kind) && tx.referenceIdType === "TXN" && tx.referenceId ? { relatedEventId: tx.referenceId } : {}),
  };
  const counterparty = counterpartyOf(entry);
  const list: ImportMovement[] = [];
  if (tx.amount !== 0) {
    list.push({
      ...base,
      component: "main",
      amount: tx.amount,
      ...(counterparty ? { counterpartyName: counterparty } : {}),
      purpose: purposeOf(entry),
      references,
    });
  }
  // Wie im CSV-Export: eine Zeile ohne Betrag, aber mit Gebühr bleibt als Gebührenkomponente
  if (tx.fee !== 0) {
    list.push({ ...base, component: "fee", amount: tx.fee, counterpartyName: "PayPal", purpose: `Gebühr · ${entry.eventId}`, references });
  }
  return list;
}

/**
 * Lieferung für `validateBatch`. Einen Saldo nennt sie nicht: Haben prüft bei Zahlungsdienstleistern keinen Kontostand,
 * und `/v1/reporting/balances` hat nur den aktuellen Stand oder einen Zeitpunkt, keinen Tagesschluss in der Zeitzone des Kontos.
 */
export function paypalBatch(input: PayPalBatchInput): ImportBatch {
  return {
    contractVersion: IMPORT_CONTRACT_VERSION,
    provider: "paypal",
    externalAccountId: input.externalAccountId,
    idempotencyKey: input.fetchId,
    fetchedAt: input.fetchedAt,
    coverage: { from: input.dateFrom, to: input.dateTo },
    part: { fetchId: input.fetchId, index: 0, last: true },
    movements: input.classified.entries.flatMap(movements),
    balances: [],
    unsupported: input.classified.unsupported,
  };
}
