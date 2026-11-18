import type { EtsyLedgerEntry } from "./etsy-ledger.ts";
import { isKnownEtsyLedgerType } from "./etsy-ledger-arten.ts";
import { IMPORT_CONTRACT_VERSION, type ImportBatch, type ImportMovement, type MovementKind } from "./importvertrag/types.ts";

/*
 * Ein Abruf des Etsy-Zahlungsverlaufs als Lieferung des Importvertrags (#306), wie `enableBankingBatch` für Enable
 * Banking. Ereigniskennung ist die `entry_id` der Verlaufszeile: im Verlauf eindeutig und bei jedem Abruf gleich.
 * Gespeichert wird über `storeBatch` (Modul bank, #1340); `parseEtsyLedger` liefert denselben Abruf als Kontoauszug.
 *
 * Reihenfolge ist die `sequence_number`: Etsy bucht mehrere Zeilen in derselben Sekunde, und nur nach der laufenden
 * Nummer gilt an jeder Zeile „vorheriger Stand + Betrag = Stand“ (geprüft an vier Monaten echtem Verlauf, #306).
 *
 * Bezüge: Gutschriften von Gebühren und Steuer nennen das Original in `parent_entry_id`. `REFUND_GROSS` hat keinen; der
 * Bezug ist dann der Verkauf derselben Bestellung, aber nur, wenn genau einer in der Lieferung steht. Die Bestellnummer
 * steht direkt nur an Zeilen mit `reference_type` „receipt“; zu Verkauf und Erstattung liefert sie der Payments-Abruf
 * (`orderFor`). Eine Transaktionsgebühr verweist nur auf die Transaktion und bekommt keine.
 */

export interface EtsyLedgerBatchInput {
  /** Kennung des Shops, die Kontokennung der Quellenbindung */
  shopId: string;
  entries: EtsyLedgerEntry[];
  /** Abgerufenes Fenster in UTC, wie die Buchungstage, YYYY-MM-DD */
  dateFrom: string;
  dateTo: string;
  /** Zeitpunkt des Abrufs mit Offset; sein Tag darf nicht vor `dateTo` liegen */
  fetchedAt: string;
  /** Kennung dieses Abrufs; der Client holt alle Seiten selbst, die Lieferung hat genau einen Teil */
  fetchId: string;
  /** Bestellnummer zur Zahlungs- oder Erstattungsnummer (`reference_id`) aus dem Payments-Abruf */
  orderFor?: (referenceId: string) => string | undefined;
}

/** Art im Vertrag; Steuer des Käufers, Karteneinzug und Ausgleich sind weder Erlös noch Gebühr noch Auszahlung */
const KIND: Record<string, MovementKind> = {
  PAYMENT_GROSS: "payment",
  REFUND_GROSS: "refund",
  sales_tax: "adjustment",
  sales_tax_refund: "adjustment",
  billing_payment: "adjustment",
  RECOUP: "adjustment",
  DISBURSE2: "payout",
};

const text = (value: string | number | undefined) => (value === undefined || value === "" ? undefined : String(value));

/** Buchungstag in UTC wie in `parseEtsyLedger`; Etsy liefert Epoch-Sekunden */
const dayOf = (entry: EtsyLedgerEntry) => (entry.created_timestamp ? new Date(entry.created_timestamp * 1000).toISOString().slice(0, 10) : undefined);

/** Laufende Nummer zuerst, ohne sie der Zeitstempel; sonst bleibt die Reihenfolge der Lieferung (stabile Sortierung) */
function inReihenfolge(entries: EtsyLedgerEntry[]): EtsyLedgerEntry[] {
  return [...entries].sort((a, b) => {
    if (a.sequence_number !== undefined && b.sequence_number !== undefined) return a.sequence_number - b.sequence_number;
    return (a.created_timestamp ?? 0) - (b.created_timestamp ?? 0);
  });
}

function orderOf(entry: EtsyLedgerEntry, orderFor: EtsyLedgerBatchInput["orderFor"]): string | undefined {
  if (entry.reference_type === "receipt") return text(entry.reference_id);
  if (entry.ledger_type !== "PAYMENT_GROSS" && entry.ledger_type !== "REFUND_GROSS") return undefined;
  const reference = text(entry.reference_id);
  return reference ? orderFor?.(reference) : undefined;
}

/** Bewegung aus einer Zeile, sonst der Grund, warum sie keine ist */
function movement(entry: EtsyLedgerEntry, orderFor: EtsyLedgerBatchInput["orderFor"]): ImportMovement | string {
  const day = dayOf(entry);
  if (entry.entry_id === undefined) return `Zeile${day ? ` vom ${day}` : ""} ohne entry_id; ohne stabile Kennung erkennt der Vertrag sie nicht wieder.`;
  if (!day) return "Zeile ohne Zeitstempel.";
  if (!isKnownEtsyLedgerType(entry.ledger_type)) return `Unbekannter Typ „${entry.ledger_type || "ohne Typ"}“; Haben ordnet ihn nicht ein.`;
  const reference = text(entry.reference_id);
  const order = orderOf(entry, orderFor);
  const references: ImportMovement["references"] = {
    eventCode: entry.ledger_type,
    ...(reference ? { providerReference: entry.reference_type ? `${entry.reference_type}:${reference}` : reference } : {}),
    ...(entry.parent_entry_id !== undefined ? { relatedEventId: String(entry.parent_entry_id) } : {}),
    ...(order ? { orderId: order } : {}),
    ...(entry.ledger_type === "DISBURSE2" && reference ? { payoutId: reference } : {}),
  };
  return {
    sourceEventId: String(entry.entry_id),
    component: "main",
    kind: KIND[entry.ledger_type] ?? "fee",
    bookingDate: day,
    sourceTimestamp: new Date((entry.created_timestamp ?? 0) * 1000).toISOString(),
    amount: entry.amount,
    currency: entry.currency.toUpperCase(),
    counterpartyName: "Etsy",
    purpose: entry.description ?? entry.ledger_type,
    references,
  };
}

/** Erstattung ohne Bezug: der Verkauf derselben Bestellung, wenn genau einer in der Lieferung steht */
function verknuepfeErstattungen(movements: ImportMovement[]): void {
  const verkaeufe = new Map<string, string[]>();
  for (const m of movements) {
    if (m.kind !== "payment" || !m.references.orderId) continue;
    verkaeufe.set(m.references.orderId, [...(verkaeufe.get(m.references.orderId) ?? []), m.sourceEventId]);
  }
  for (const m of movements) {
    if (m.kind !== "refund" || m.references.relatedEventId || !m.references.orderId) continue;
    const treffer = verkaeufe.get(m.references.orderId);
    if (treffer?.length === 1) m.references.relatedEventId = treffer[0];
  }
}

/** Saldo je Tag: der Stand der letzten Zeile des Tages; ohne Stand an dieser Zeile keiner */
function tagessalden(sortiert: EtsyLedgerEntry[]): ImportBatch["balances"] {
  const letzte = new Map<string, EtsyLedgerEntry>();
  for (const entry of sortiert) {
    const day = dayOf(entry);
    if (day) letzte.set(day, entry);
  }
  return [...letzte]
    .filter(([, entry]) => entry.balance !== undefined)
    .map(([date, entry]) => ({ date, amount: entry.balance as number, currency: entry.currency.toUpperCase() }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Lieferung für `validateBatch` */
export function etsyLedgerBatch(input: EtsyLedgerBatchInput): ImportBatch {
  const sortiert = inReihenfolge(input.entries);
  const movements: ImportMovement[] = [];
  const unsupported: ImportBatch["unsupported"] = [];
  for (const entry of sortiert) {
    const m = movement(entry, input.orderFor);
    if (typeof m !== "string") movements.push(m);
    else {
      // Mit Buchungstag hält der Vertrag den Zeitraum erst ab diesem Tag offen (optionales bookingDate, #306)
      const day = dayOf(entry);
      unsupported.push({
        ...(entry.entry_id !== undefined ? { sourceEventId: String(entry.entry_id) } : {}),
        ...(day ? { bookingDate: day } : {}),
        reason: m,
      });
    }
  }
  verknuepfeErstattungen(movements);
  return {
    contractVersion: IMPORT_CONTRACT_VERSION,
    provider: "etsy",
    externalAccountId: input.shopId,
    idempotencyKey: input.fetchId,
    fetchedAt: input.fetchedAt,
    coverage: { from: input.dateFrom, to: input.dateTo },
    part: { fetchId: input.fetchId, index: 0, last: true },
    movements,
    balances: tagessalden(sortiert),
    unsupported,
  };
}
