import type { Cents } from "@haben/core";
import { applyStatedBalance } from "../common.ts";
import { normalizeIban, normalizeText, parseDotAmount } from "../text.ts";
import type { ParsedStatement, ParsedTransaction } from "../types.ts";
import type { EbAccount, EbBalance, EbTransaction } from "./client.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const day = (value: string | null | undefined) => (value && ISO_DATE.test(value.slice(0, 10)) ? value.slice(0, 10) : undefined);

function cents(amount: string): Cents | null {
  const value = parseDotAmount(amount);
  return value === null || Number.isNaN(value) ? null : value;
}

/** Ein gebuchter Umsatz aus der API; null ohne gültiges Datum oder Betrag */
export function mapEnableBankingTransaction(t: EbTransaction, index: number): ParsedTransaction | null {
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

/**
 * Gebuchter Kontostand: Tagesendsaldo, sonst der aktuelle gebuchte Saldo. Verfügbare oder erwartete
 * Salden (ITAV, CLAV, XPCD) enthalten Vormerkungen oder Kreditlinien; Anfangssalden (OPBD, PRCD)
 * gelten vor den Buchungen ihres Stichtags. Beide passen nicht als Endsaldo.
 */
const BALANCE_PREFERENCE = ["CLBD", "ITBD"];

export function bookedBalance(balances: EbBalance[]): { amount: Cents; date?: string } | null {
  const ranked = balances
    .filter((b) => BALANCE_PREFERENCE.includes(b.balance_type ?? "") && (b.balance_amount.currency === "EUR" || !b.balance_amount.currency))
    .sort((a, b) => BALANCE_PREFERENCE.indexOf(a.balance_type!) - BALANCE_PREFERENCE.indexOf(b.balance_type!));
  for (const balance of ranked) {
    const amount = cents(balance.balance_amount.amount);
    if (amount !== null) return { amount, date: day(balance.reference_date) };
  }
  return null;
}

/**
 * Baut aus einem Abruf einen Kontoauszug wie aus einer Datei. Vorgemerkte Umsätze (PDNG) fehlen
 * absichtlich: Sie können sich noch ändern oder wegfallen, und Umsätze sind ab Import unveränderlich. Die Umsätze werden nach Buchungstag
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
    const ref = t.entry_reference ?? t.transaction_id ?? i + 1;
    if (t.status === "PDNG") pending++;
    else if (t.status && t.status !== "BOOK") warnings.push(`Umsatz ${ref} mit Status ${t.status} übersprungen.`);
    else {
      const tx = mapEnableBankingTransaction(t, i);
      if (tx) mapped.push(tx);
      else warnings.push(`Umsatz ${ref} ohne gültiges Datum oder Betrag übersprungen.`);
    }
  });
  if (pending > 0) warnings.push(`${pending} vorgemerkte Umsätze folgen, sobald die Bank sie bucht.`);
  const transactions = mapped
    .map((t, order) => ({ t, order }))
    .sort((a, b) => a.t.bookingDate.localeCompare(b.t.bookingDate) || a.order - b.order)
    .map(({ t }, index) => ({ ...t, index }));
  const balance = bookedBalance(input.balances);
  const statement: ParsedStatement = {
    format: "enablebanking",
    accountIban: normalizeIban(input.account.account_id?.iban ?? undefined),
    accountName: normalizeText(input.account.name ?? input.account.product ?? "") || undefined,
    currency: input.account.currency || "EUR",
    periodFrom: input.dateFrom,
    periodTo: input.dateTo,
    transactions,
    warnings,
  };
  applyStatedBalance(statement, balance ? { date: balance.date ?? input.dateTo, amount: balance.amount } : undefined);
  return statement;
}
