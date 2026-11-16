import type { Cents } from "@haben/core";
import type { Balance, Statement, Transaction } from "lib-fints";
import { applyStatedBalance } from "../common.ts";
import { normalizeIban, normalizeText, parseDotAmount } from "../text.ts";
import type { ParsedStatement, ParsedTransaction } from "../types.ts";

/**
 * Betrag aus lib-fints in Cent. Die Bibliothek liest den Dezimaltext aus MT940 (`1234,56`) und CAMT (`1234.56`) mit
 * parseFloat; eine andere Form gibt sie nicht heraus. Ein Betrag mit höchstens zwei Nachkommastellen übersteht das
 * genau: `toFixed(2)` ergibt denselben Text, und der geht wie jeder Dezimaltext über parseDotAmount in Cent. Hat die
 * Zahl mehr Stellen oder ist sie keine endliche Zahl, ist der Betrag nicht sicher: null.
 */
export function fintsCents(value: number): Cents | null {
  const text = value.toFixed(2);
  if (Number(text) !== value) return null;
  return parseDotAmount(text);
}

/**
 * Tag eines Datums aus lib-fints als YYYY-MM-DD. Die Bibliothek legt Tage ohne Uhrzeit (MT940, CAMT `Dt`) als lokale
 * Mitternacht oder lokalen Mittag an; die lokalen Felder geben deshalb den Tag der Bank, toISOString könnte je nach
 * Zeitzone einen Tag daneben liegen.
 */
export function fintsDay(date: Date | undefined): string | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** „NOTPROVIDED“ steht in SEPA-Feldern, die der Auftraggeber leer gelassen hat */
const reference = (value: string | undefined) => {
  const text = normalizeText(value);
  return text && text.toUpperCase() !== "NOTPROVIDED" ? text : undefined;
};

/** Ein gebuchter Umsatz aus MT940 oder CAMT; null ohne gültigen Buchungstag oder Betrag */
export function mapFintsTransaction(t: Transaction, currency: string, index: number): ParsedTransaction | null {
  const bookingDate = fintsDay(t.entryDate) ?? fintsDay(t.valueDate);
  const amount = fintsCents(t.amount);
  if (!bookingDate || amount === null) return null;
  const mandateReference = reference(t.mandateReference);
  return {
    bookingDate,
    valueDate: fintsDay(t.valueDate),
    amount,
    currency,
    counterpartyName: normalizeText(t.remoteName),
    // MT940 ?31 trägt bei SEPA die IBAN, bei alten Inlandszahlungen die Kontonummer; die fällt hier heraus
    counterpartyIban: normalizeIban(t.remoteAccountNumber),
    purpose: normalizeText(t.purpose),
    type: normalizeText(t.bookingText) || undefined,
    bankReference: reference(t.bankReference) ?? reference(t.e2eReference),
    endToEndId: reference(t.e2eReference),
    // CRED+ nennt bei einer Lastschrift die Gläubiger-ID; lib-fints legt CRED+ und DEBT+ in dasselbe Feld
    creditorId: mandateReference ? reference(t.remoteIdentifier) : undefined,
    mandateReference,
    index,
  };
}

/**
 * Gebuchter Kontostand aus den Auszügen: der Endsaldo mit dem spätesten Stichtag, der zum Abruf passt (fits); passt
 * keiner, der späteste, damit applyStatedBalance den unpassenden Stichtag meldet. Den verfügbaren Saldo (:64:) mit
 * Kreditlinie übernimmt Haben nie.
 */
export function fintsClosingBalance(statements: Statement[], fits: (date: string) => boolean): { amount: Cents; date: string } | null {
  const ranked = statements
    .flatMap((s) => (s.closingBalance ? [s.closingBalance] : []))
    .flatMap((b: Balance) => {
      const date = fintsDay(b.date);
      const amount = fintsCents(b.value);
      return date && amount !== null && (!b.currency || b.currency === "EUR") ? [{ amount, date }] : [];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return ranked.find((b) => fits(b.date)) ?? ranked[0] ?? null;
}

/**
 * Baut aus einem FinTS-Abruf (HKKAZ mit MT940 oder HKCAZ mit CAMT.052) einen Kontoauszug wie aus einer Datei.
 * lib-fints liefert nur gebuchte Umsätze; vorgemerkte fragt Haben nicht ab, weil Umsätze ab Import unveränderlich
 * sind. Sortiert nach Buchungstag, bei gleichem Tag in der Reihenfolge der Bank: So bekommen gleiche Umsätze an einem
 * Tag bei jedem Abruf dieselbe laufende Nummer und damit denselben Hash.
 */
export function fintsStatement(input: {
  iban: string;
  accountName?: string;
  currency?: string;
  statements: Statement[];
  dateFrom: string;
  dateTo: string;
}): ParsedStatement {
  const currency = input.currency || "EUR";
  const warnings: string[] = [];
  const mapped: ParsedTransaction[] = [];
  input.statements
    .flatMap((s) => s.transactions ?? [])
    .forEach((t, i) => {
      const tx = mapFintsTransaction(t, currency, i);
      if (tx) mapped.push(tx);
      else warnings.push(`Umsatz ${reference(t.bankReference) ?? i + 1} ohne gültiges Datum oder Betrag übersprungen.`);
    });
  const transactions = mapped
    .map((t, order) => ({ t, order }))
    .sort((a, b) => a.t.bookingDate.localeCompare(b.t.bookingDate) || a.order - b.order)
    .map(({ t }, index) => ({ ...t, index }));
  const lastBooking = transactions.at(-1)?.bookingDate;
  const balance = fintsClosingBalance(input.statements, (date) => (!lastBooking || date >= lastBooking) && date <= input.dateTo);
  const statement: ParsedStatement = {
    format: "fints",
    accountIban: normalizeIban(input.iban),
    accountName: normalizeText(input.accountName) || undefined,
    currency,
    periodFrom: input.dateFrom,
    periodTo: input.dateTo,
    transactions,
    warnings,
  };
  applyStatedBalance(statement, balance ?? undefined);
  return statement;
}
