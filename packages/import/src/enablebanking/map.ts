import type { Cents } from "@haben/core";
import { normalizeIban, normalizeText, parseDotAmount } from "../text.ts";
import type { ParsedStatement, ParsedTransaction } from "../types.ts";
import type { EbAccount, EbBalance, EbTransaction } from "./client.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const day = (value: string | null | undefined) => (value && ISO_DATE.test(value.slice(0, 10)) ? value.slice(0, 10) : undefined);

function cents(amount: string): Cents | null {
  const value = parseDotAmount(amount);
  return value === null || Number.isNaN(value) ? null : value;
}

/**
 * Ein Umsatz aus der API. Vorgemerkte Umsätze (PDNG) fehlen absichtlich: Sie können sich noch
 * ändern oder wegfallen, und Umsätze sind ab Import unveränderlich.
 */
export function mapEnableBankingTransaction(t: EbTransaction, index: number): ParsedTransaction | null {
  if (t.status && t.status !== "BOOK") return null;
  const bookingDate = day(t.booking_date) ?? day(t.value_date) ?? day(t.transaction_date);
  const amount = cents(t.transaction_amount.amount);
  if (!bookingDate || amount === null) return null;
  const incoming = t.credit_debit_indicator === "CRDT";
  const party = incoming ? t.debtor : t.creditor;
  const partyAccount = incoming ? t.debtor_account : t.creditor_account;
  return {
    bookingDate,
    valueDate: day(t.value_date),
    amount: incoming ? Math.abs(amount) : -Math.abs(amount),
    currency: t.transaction_amount.currency || "EUR",
    counterpartyName: normalizeText(party?.name ?? ""),
    counterpartyIban: normalizeIban(partyAccount?.iban ?? undefined),
    purpose: normalizeText((t.remittance_information ?? []).join(" ")),
    type: normalizeText(t.bank_transaction_code?.description ?? "") || undefined,
    bankReference: t.entry_reference || t.transaction_id || undefined,
    index,
  };
}

/** Gebuchter Kontostand: Tagesendsaldo, sonst der aktuelle gebuchte Saldo */
const BALANCE_PREFERENCE = ["CLBD", "ITBD", "XPCD", "ITAV", "CLAV", "OPBD"];

export function bookedBalance(balances: EbBalance[]): { amount: Cents; date?: string } | null {
  const ranked = [...balances]
    .filter((b) => b.balance_amount.currency === "EUR" || !b.balance_amount.currency)
    .sort((a, b) => rank(a.balance_type) - rank(b.balance_type));
  for (const balance of ranked) {
    const amount = cents(balance.balance_amount.amount);
    if (amount !== null) return { amount, date: day(balance.reference_date) };
  }
  return null;
}

function rank(type: string | null | undefined): number {
  const index = BALANCE_PREFERENCE.indexOf(type ?? "");
  return index === -1 ? BALANCE_PREFERENCE.length : index;
}

/**
 * Baut aus einem Abruf einen Kontoauszug wie aus einer Datei. Die Umsätze werden nach Buchungstag
 * sortiert (bei gleichem Tag in der Reihenfolge der Bank), damit gleiche Umsätze an einem Tag bei
 * jedem Abruf dieselbe laufende Nummer und damit denselben Hash bekommen.
 */
export function enableBankingStatement(input: {
  account: EbAccount;
  transactions: EbTransaction[];
  balances: EbBalance[];
  dateFrom: string;
  dateTo: string;
}): ParsedStatement {
  const warnings: string[] = [];
  const mapped: ParsedTransaction[] = [];
  let pending = 0;
  input.transactions.forEach((t, i) => {
    if (t.status && t.status !== "BOOK") {
      pending++;
      return;
    }
    const tx = mapEnableBankingTransaction(t, i);
    if (tx) mapped.push(tx);
    else warnings.push(`Umsatz ${t.entry_reference ?? t.transaction_id ?? i + 1} ohne gültiges Datum oder Betrag übersprungen.`);
  });
  if (pending > 0) warnings.push(`${pending} vorgemerkte Umsätze folgen, sobald die Bank sie bucht.`);
  const transactions = mapped
    .map((t, order) => ({ t, order }))
    .sort((a, b) => a.t.bookingDate.localeCompare(b.t.bookingDate) || a.order - b.order)
    .map(({ t }, index) => ({ ...t, index }));
  const balance = bookedBalance(input.balances);
  return {
    format: "enablebanking",
    accountIban: normalizeIban(input.account.account_id?.iban ?? undefined),
    accountName: normalizeText(input.account.name ?? input.account.product ?? "") || undefined,
    currency: input.account.currency || "EUR",
    periodFrom: input.dateFrom,
    periodTo: input.dateTo,
    closingBalance: balance?.amount,
    statedBalance: balance ? { date: balance.date ?? input.dateTo, amount: balance.amount } : undefined,
    transactions,
    warnings,
  };
}
