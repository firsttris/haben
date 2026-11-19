import type { ParsedTransaction } from "./types.ts";

type ObservedTransaction = Pick<ParsedTransaction, "bookingDate" | "amount" | "currency" | "counterpartyIban" | "purpose"> & {
  id: string;
  accountId: string;
  /** Alle belegten Abrufe, in denen der Umsatz vorkam, auch wenn er bereits gespeichert war. */
  fetchIds: ReadonlySet<string>;
  stableReference: boolean;
};

function withinEditLimit(left: string[], right: string[], i: number, j: number, remaining: number): boolean {
  if (Math.abs(left.length - i - (right.length - j)) > remaining) return false;
  while (i < left.length && j < right.length && left[i] === right[j]) {
    i++;
    j++;
  }
  if (i === left.length || j === right.length) return left.length - i + right.length - j <= remaining;
  return (
    remaining > 0 &&
    (withinEditLimit(left, right, i + 1, j + 1, remaining - 1) ||
      withinEditLimit(left, right, i + 1, j, remaining - 1) ||
      withinEditLimit(left, right, i, j + 1, remaining - 1))
  );
}

/** Verdachtsprüfung für neuere Umsätze ohne stabile Referenz, in der Reihenfolge alt → neu. Keine Buchung wird geändert. */
export function findDuplicateCandidates(transactions: readonly ObservedTransaction[], newIds?: ReadonlySet<string>) {
  const groups = new Map<string, { row: ObservedTransaction; purpose: string[] }[]>();
  const candidates: { transactionId: string; originalTransactionId: string }[] = [];
  for (const row of transactions) {
    const iban = (row.counterpartyIban ?? "").replace(/\s+/g, "").toUpperCase();
    const key = JSON.stringify([row.accountId, row.bookingDate, row.amount, row.currency, iban]);
    const group = groups.get(key) ?? [];
    const purpose = Array.from(row.purpose.toLowerCase().replace(/\s+/g, ""));
    if (!row.stableReference && (!newIds || newIds.has(row.id))) {
      for (const previous of group) {
        const sameFetch = [...row.fetchIds].some((fetchId) => previous.row.fetchIds.has(fetchId));
        if (!sameFetch && withinEditLimit(purpose, previous.purpose, 0, 0, 2)) {
          candidates.push({ transactionId: row.id, originalTransactionId: previous.row.id });
        }
      }
    }
    group.push({ row, purpose });
    groups.set(key, group);
  }
  return candidates;
}
