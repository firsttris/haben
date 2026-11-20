import { parseStripe } from "../psp.ts";
import type { ParsedStatement } from "../types.ts";
import type { StripeBalanceTransaction } from "./client.ts";

/*
 * Ein Abruf der Balance Transactions als Kontoauszug, zugleich zur Lieferung von `stripeBatch` (Importvertrag, #306,
 * #1280). Gespeichert wird der Auszug, die Lieferung ordnet ihm die Quellenidentität zu. Damit ein Umsatz aus dem Abruf
 * derselbe ist wie der aus dem CSV-Export „Balance history“ (gleicher Dubletten-Hash über Tag, Betrag und Zweck), liest
 * dieselbe Funktion beide: Die Balance Transactions werden zu den Zeilen des Exports (Spalten `balance_transaction_id`,
 * `created_utc`, `reporting_category`, `gross`, `fee`, `net`, `currency`, `description`, `customer_name`), und
 * `parseStripe` macht daraus die Umsätze: Bruttobetrag und Gebühr getrennt, die Gebühr mit der Referenz `<txn>-gebuehr`.
 *
 * Grenze: Der Zweck enthält die Art der Zeile und geht in den Dubletten-Hash. Der Abruf nimmt die `reporting_category` wie der
 * aktuelle Balance-Bericht. Der ältere Export führt die Spalte `Type`; wo sie anders heißt (`payment`, `payment_refund`,
 * `adjustment` statt `charge`, `refund`, `dispute`), gilt dieselbe Zeile im Abruf als anderer Umsatz. Die Doku sagt, wie man
 * das umgeht (Abruf ab nach dem letzten Tag des Exports); der Test „Grenze“ in statement.test.ts hält es fest.
 */

const euro = (cents: number) => (cents / 100).toFixed(2);
/** „2026-10-06 09:14:00“, wie die Spalte „Created (UTC)“ des Exports */
const utc = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 19).replace("T", " ");

const HEADER = ["balance_transaction_id", "created_utc", "reporting_category", "gross", "fee", "net", "currency", "description", "customer_name"];

export function stripeStatement(transactions: StripeBalanceTransaction[]): ParsedStatement {
  const rows = [
    HEADER,
    ...transactions.map((t) => [
      t.id,
      utc(t.created),
      t.reporting_category ?? t.type,
      euro(t.amount),
      euro(t.fee),
      euro(t.net),
      t.currency,
      t.description ?? "",
      t.customerName ?? "",
    ]),
  ];
  return { ...parseStripe(rows, 0), format: "stripe-api" };
}

/** Bankreferenz der Gebührenzeile, wie `parseStripe` sie vergibt */
const GEBUEHR = "-gebuehr";

/**
 * Schlüssel der Bewegung zu einem Umsatz des Auszugs, nach `eventKey` im Modul bank: der Hauptbetrag unter der
 * Kennung der Balance Transaction, die Gebühr mit dem Zusatz `#fee`. `undefined`, wenn die Bewegung der Lieferung fehlt.
 */
export function stripeEventOf(movementKeys: ReadonlySet<string>) {
  return (t: { bankReference?: string }): string | undefined => {
    const ref = t.bankReference;
    if (!ref) return undefined;
    const key = ref.endsWith(GEBUEHR) ? `${ref.slice(0, -GEBUEHR.length)}#fee` : ref;
    return movementKeys.has(key) ? key : undefined;
  };
}
