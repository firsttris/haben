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
  // Ein Buchungstag nach dem Abruf holt der nächste Abruf. Einen vor dem Fenster übernimmt Haben (`enableBankingBatch`):
  // Banken, die nach Valuta filtern, liefern ihn sonst nie im passenden Fenster
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

/** Gleicher Kern: Dieselbe entry_reference zweimal mit gleichem Betrag, Tag und Währung ist ein Umsatz */
const sameCore = (a: ImportMovement, b: ImportMovement) => a.amount === b.amount && a.bookingDate === b.bookingDate && a.currency === b.currency;

/**
 * Lieferung für `validateBatch`; Status und Abbildung je Umsatz wie `enableBankingStatement`. Saldo: der gebuchte
 * (bevorzugt CLBD, sonst ITBD, `bookedBalance`) mit seinem Stichtag, ohne Abstimmung auf den letzten Buchungstag wie
 * im Kontoauszug; die Lieferung nennt ihn als Saldo zu diesem Tag, ohne Stichtag gar nicht.
 */
export function enableBankingBatch(input: EnableBankingBatchInput): ImportBatch {
  const movements: ImportMovement[] = [];
  const unsupported: ImportBatch["unsupported"] = [];
  input.transactions.forEach((t, index) => {
    const m = movement(t, index, input);
    if (!("component" in m)) unsupported.push(m);
    // Mit anderem Kern bleibt die zweite stehen, dann lehnt der Vertrag die Lieferung ab
    else if (!movements.some((other) => other.sourceEventId === m.sourceEventId && sameCore(other, m))) movements.push(m);
  });
  // Das Fenster reicht bis zum frühesten gelieferten Buchungstag zurück; der Stand der Quelle geht dadurch nie zurück
  const from = [input.dateFrom, ...movements.map((m) => m.bookingDate)].toSorted()[0] ?? input.dateFrom;
  const balance = bookedBalance(input.balances);
  return {
    contractVersion: IMPORT_CONTRACT_VERSION,
    provider: "enablebanking",
    externalAccountId: input.externalAccountId,
    idempotencyKey: input.fetchId,
    fetchedAt: input.fetchedAt,
    coverage: { from, to: input.dateTo },
    part: { fetchId: input.fetchId, index: 0, last: true },
    movements,
    // Nur ein Stichtag, den es gibt: Ein falscher Tag der Bank soll nicht die ganze Lieferung ablehnen
    balances: balance?.date && parseDate(balance.date) === balance.date ? [{ date: balance.date, amount: balance.amount, currency: "EUR" }] : [],
    unsupported,
  };
}

/**
 * Ereignis zu einem Umsatz aus `enableBankingStatement`: Dessen `bankReference` ist die `entry_reference` oder, ohne
 * sie, die `transaction_id`; nur die erste ist eine stabile Kennung.
 */
export function entryReferenceOf(transactions: EbTransaction[]): (t: ParsedTransaction) => string | undefined {
  const refs = new Map(transactions.filter((t) => t.entry_reference).map((t) => [t.entry_reference!, referenz(t)]));
  return (t) => (t.bankReference ? refs.get(t.bankReference) : undefined);
}
