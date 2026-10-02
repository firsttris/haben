import { createHash } from "node:crypto";
import type { ParsedTransaction } from "./types.ts";

type HashInput = Pick<ParsedTransaction, "bookingDate" | "amount" | "counterpartyIban" | "purpose">;

function key(t: HashInput): string {
  const iban = (t.counterpartyIban ?? "").replace(/\s+/g, "").toUpperCase();
  const purpose = t.purpose.toLowerCase().replace(/\s+/g, " ").trim();
  return [t.bookingDate, String(t.amount), iban, purpose].join("|");
}

/**
 * Hash zur Erkennung bereits importierter Umsätze. `occurrence` zählt gleiche Umsätze
 * (Datum, Betrag, Gegen-IBAN, Verwendungszweck) innerhalb einer Datei: 0, 1, …
 */
export function transactionHash(t: HashInput, occurrence: number): string {
  return createHash("sha256").update(`${key(t)}|${occurrence}`, "utf8").digest("hex");
}

/** Hashes in Dateireihenfolge; echte Doppelbuchungen am selben Tag erhalten verschiedene Hashes. */
export function withDedupHashes<T extends ParsedTransaction>(transactions: T[]): (T & { dedupHash: string })[] {
  const seen = new Map<string, number>();
  return transactions.map((t) => {
    const k = key(t);
    const occurrence = seen.get(k) ?? 0;
    seen.set(k, occurrence + 1);
    return { ...t, dedupHash: transactionHash(t, occurrence) };
  });
}
