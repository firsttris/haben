import { IMPORT_CONTRACT_VERSION, type ImportBatch, type ImportMovement } from "../importvertrag/types.ts";
import { parseDate } from "../text.ts";
import type { ParsedTransaction } from "../types.ts";
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

/** Teil des Grunds für einen gebuchten Umsatz ohne entry_reference, zum Zählen in der Meldung des Abrufs */
export const OHNE_ENTRY_REFERENCE = "ohne entry_reference";

/** Status, die nie zu einer Buchung werden */
const FINAL_STATUS: Record<string, string> = { CNCL: "Storniert", RJCT: "Abgelehnt" };

/** entry_reference ohne Leerzeichen; leer zählt wie fehlend */
const referenz = (t: EbTransaction) => t.entry_reference?.trim() || undefined;

type Unsupported = ImportBatch["unsupported"][number];

/** Bewegung aus einem gebuchten Umsatz mit entry_reference, sonst der Eintrag unter `unsupported` mit Grund */
function movement(t: EbTransaction, index: number, window: { dateFrom: string; dateTo: string }): ImportMovement | Unsupported {
  const mapped = mapEnableBankingTransaction(t, index);
  const ref = referenz(t);
  // Tag, wo bekannt: Vor dem Fenster hält er den Zeitraum nicht offen, sonst ab diesem Tag (Vertrag)
  const skip = (reason: string): Unsupported => ({ ...(ref ? { sourceEventId: ref } : {}), ...(mapped ? { bookingDate: mapped.bookingDate } : {}), reason });
  if (t.status === "PDNG") return skip("Vorgemerkt (PDNG); folgt, sobald die Bank ihn bucht.");
  // Storniert und abgelehnt sind Endzustände (Berlin Group, TransactionStatus): ohne Tag, sie halten den Zeitraum nicht offen
  const final = FINAL_STATUS[t.status ?? ""];
  if (final) return { ...(ref ? { sourceEventId: ref } : {}), reason: `${final} (${t.status}); wird nie gebucht.`, final: true };
  if (t.status && t.status !== "BOOK") return skip(`Status ${t.status}.`);
  if (!mapped) return skip("Ohne gültiges Datum oder Betrag.");
  if (!ref) return skip(`Gebuchter Umsatz vom ${mapped.bookingDate} ${OHNE_ENTRY_REFERENCE}; transaction_id kann sich ändern und ist kein Ersatz.`);
  // Ein Buchungstag nach dem Abruf holt der nächste Abruf. Einen vor dem Fenster übernimmt Haben (der Vertrag nimmt ihn an,
  // ohne das Fenster zu verbreitern): Banken, die nach Valuta filtern, liefern ihn sonst nie im passenden Fenster
  if (mapped.bookingDate > window.dateTo) return skip(`Buchungstag ${mapped.bookingDate} nach dem abgerufenen Fenster bis ${window.dateTo}.`);
  return {
    sourceEventId: ref,
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
    // Art des Umsatzes der Bank (bank_transaction_code), im Umsatz von Haben die Spalte `type`
    references: { providerReference: ref, ...(mapped.type ? { eventCode: mapped.type } : {}) },
  };
}

/** Mehrfach vergebene Referenzen sind keine Quellenidentität, ihre Zeilen müssen aber durch die Vertragsprüfung. */
function projectAmbiguousRows(rows: { index: number; movement: ImportMovement }[], transactions: EbTransaction[]): Map<number, string> {
  const counts = new Map<string, number>();
  // Auch eine gebuchte Zeile außerhalb des Zeitfensters belegt, dass die Bank die Referenz wiederverwendet.
  for (const t of transactions) {
    const ref = referenz(t);
    if (ref && (!t.status || t.status === "BOOK")) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  let prefix = "~zeile:";
  const refs = transactions.map(referenz);
  while (refs.some((ref) => ref?.startsWith(prefix))) prefix = `~${prefix}`;
  const fallback = new Map<number, string>();
  for (const { index, movement: m } of rows) {
    if (counts.get(m.sourceEventId) === 1) continue;
    const key = `${prefix}${index}`;
    fallback.set(index, key);
    m.sourceEventId = key;
  }
  return fallback;
}

/**
 * Lieferung für `validateBatch`; Status und Abbildung je Umsatz wie `enableBankingStatement`. Saldo: der gebuchte
 * (bevorzugt CLBD, sonst ITBD, `bookedBalance`) mit seinem Stichtag, ohne Abstimmung auf den letzten Buchungstag wie
 * im Kontoauszug; die Lieferung nennt ihn als Saldo zu diesem Tag, ohne Stichtag gar nicht.
 */
export function enableBankingDelivery(input: EnableBankingBatchInput): { batch: ImportBatch; fallback: ReadonlyMap<number, string> } {
  const rows: { index: number; movement: ImportMovement }[] = [];
  const unsupported: ImportBatch["unsupported"] = [];
  input.transactions.forEach((t, index) => {
    const m = movement(t, index, input);
    if (!("component" in m)) unsupported.push(m);
    else rows.push({ index, movement: m });
  });
  const fallback = projectAmbiguousRows(rows, input.transactions);
  const balance = bookedBalance(input.balances);
  const batch: ImportBatch = {
    contractVersion: IMPORT_CONTRACT_VERSION,
    provider: "enablebanking",
    externalAccountId: input.externalAccountId,
    idempotencyKey: input.fetchId,
    fetchedAt: input.fetchedAt,
    // Das angefragte Fenster; gebuchte Umsätze davor nimmt der Vertrag an, ohne dass sie Tage davor abdecken
    coverage: { from: input.dateFrom, to: input.dateTo },
    part: { fetchId: input.fetchId, index: 0, last: true },
    movements: rows.map(({ movement: m }) => m),
    // Nur ein Stichtag, den es gibt: Ein falscher Tag der Bank soll nicht die ganze Lieferung ablehnen
    balances: balance?.date && parseDate(balance.date) === balance.date ? [{ date: balance.date, amount: balance.amount, currency: "EUR" }] : [],
    unsupported,
  };
  return { batch, fallback };
}

/** Prüfkopie für Tests des Enable-Banking-Adapters. Beim Speichern auch die Fallback-Kennungen übernehmen. */
export function enableBankingBatch(input: EnableBankingBatchInput): ImportBatch {
  return enableBankingDelivery(input).batch;
}

/**
 * Ereignis zu einem Umsatz aus `enableBankingStatement`. Die Kennung muss aus der `entry_reference` dieser Zeile
 * stammen: Eine fremde `entry_reference` kann denselben Wert wie ihre `transaction_id` haben.
 */
export function entryReferenceOf(transactions: EbTransaction[], fallback?: ReadonlyMap<number, string>): (t: ParsedTransaction) => string | undefined {
  const refs = new Set(transactions.map(referenz));
  return (t) => {
    const key = t.providerRowIndex === undefined ? undefined : fallback?.get(t.providerRowIndex);
    if (key) return key;
    const ref = t.entryReference?.trim() || undefined;
    return ref && refs.has(ref) ? ref : undefined;
  };
}
