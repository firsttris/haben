import { IMPORT_CONTRACT_VERSION, type ImportBatch, type ImportMovement } from "../importvertrag/types.ts";
import type { EbBalance, EbTransaction } from "./client.ts";
import { bookedBalance, mapEnableBankingTransaction } from "./map.ts";

/*
 * Ein Abruf über Enable Banking als Lieferung des Importvertrags (#306, Schritt 2). Ereigniskennung ist die
 * `entry_reference`: nach der API-Referenz (https://enablebanking.com/docs/api/reference/, Transaction) eindeutig und
 * unveränderlich für Konten mit demselben `identification_hash`; `transaction_id` kann sich ändern und ist kein Ersatz.
 * Ohne `entry_reference` bleibt der Umsatz unter `unsupported`; gespeichert wird er weiter über den heutigen Weg
 * (`enableBankingStatement`, `dedup.ts`), so in #306 abgestimmt.
 */

export interface EnableBankingBatchInput {
  /** Kontokennung der Quellenbindung */
  externalAccountId: string;
  transactions: EbTransaction[];
  balances: EbBalance[];
  /** Abgerufenes Fenster, YYYY-MM-DD */
  dateFrom: string;
  dateTo: string;
  /** Zeitpunkt des Abrufs mit Offset; sein Tag darf nicht vor `dateTo` liegen */
  fetchedAt: string;
  /** Kennung dieses Abrufs; der Client holt alle Seiten selbst, die Lieferung hat deshalb genau einen Teil */
  fetchId: string;
}

/** Bewegung aus einem gebuchten Umsatz mit entry_reference, sonst der Grund, warum er keine ist */
function movement(t: EbTransaction, index: number): ImportMovement | string {
  if (t.status === "PDNG") return "Vorgemerkt (PDNG); folgt, sobald die Bank ihn bucht.";
  if (t.status && t.status !== "BOOK") return `Status ${t.status}.`;
  const mapped = mapEnableBankingTransaction(t, index);
  if (!mapped) return "Ohne gültiges Datum oder Betrag.";
  if (!t.entry_reference) return `Gebuchter Umsatz vom ${mapped.bookingDate} ohne entry_reference; transaction_id kann sich ändern und ist kein Ersatz.`;
  return {
    sourceEventId: t.entry_reference,
    component: "main",
    kind: "payment",
    bookingDate: mapped.bookingDate,
    ...(mapped.valueDate ? { valueDate: mapped.valueDate } : {}),
    amount: mapped.amount,
    currency: mapped.currency,
    // Fehlende Angaben bleiben leer (Vertrag), nicht als leerer Text
    ...(mapped.counterpartyName ? { counterpartyName: mapped.counterpartyName } : {}),
    ...(mapped.counterpartyIban ? { counterpartyIban: mapped.counterpartyIban } : {}),
    purpose: mapped.purpose,
    references: { providerReference: t.entry_reference },
  };
}

/** Lieferung für `validateBatch`; Status, Saldo und Abbildung je Umsatz wie `enableBankingStatement` */
export function enableBankingBatch(input: EnableBankingBatchInput): ImportBatch {
  const movements: ImportMovement[] = [];
  const unsupported: ImportBatch["unsupported"] = [];
  input.transactions.forEach((t, index) => {
    const m = movement(t, index);
    if (typeof m !== "string") movements.push(m);
    else unsupported.push({ ...(t.entry_reference ? { sourceEventId: t.entry_reference } : {}), reason: m });
  });
  const balance = bookedBalance(input.balances);
  return {
    contractVersion: IMPORT_CONTRACT_VERSION,
    provider: "enablebanking",
    externalAccountId: input.externalAccountId,
    idempotencyKey: input.fetchId,
    fetchedAt: input.fetchedAt,
    coverage: { from: input.dateFrom, to: input.dateTo },
    part: { fetchId: input.fetchId, index: 0, last: true },
    movements,
    balances: balance?.date ? [{ date: balance.date, amount: balance.amount, currency: "EUR" }] : [],
    unsupported,
  };
}
