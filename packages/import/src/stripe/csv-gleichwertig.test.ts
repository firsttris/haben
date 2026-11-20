import { describe, expect, it } from "vitest";
import { findHeaderRow } from "../table.ts";
import { isStripeHeader, parseStripe } from "../psp.ts";
import { validateBatch } from "../importvertrag/index.ts";
import { stripeBatch } from "./batch.ts";
import type { StripeBalanceTransaction } from "./client.ts";

/*
 * Akzeptanzkriterium aus #1280: Der Abruf eines Zeitraums ergibt dieselben Umsätze wie der CSV-Export „Balance history“
 * desselben Zeitraums. Beide Wege bekommen hier dieselben (erfundenen) Bewegungen: als Zeilen des CSV-Exports und als
 * Balance Transactions der API.
 */

const at = (iso: string) => Date.parse(iso) / 1000;
const txn = (over: Partial<StripeBalanceTransaction>): StripeBalanceTransaction => ({
  id: "txn_1",
  amount: 0,
  created: 0,
  currency: "eur",
  description: "",
  fee: 0,
  net: 0,
  reporting_category: "charge",
  source: null,
  status: "available",
  type: "charge",
  ...over,
});

const transactions = [
  txn({ id: "txn_1", amount: 10000, fee: 300, net: 9700, created: at("2026-10-06T09:14:00Z"), description: "Rechnung 2026-117" }),
  // Kurz nach Mitternacht Berliner Zeit: der Tag in UTC ist der 20.
  txn({ id: "txn_2", amount: 2500, fee: 100, net: 2400, created: at("2026-10-20T22:30:00Z"), description: "Rechnung 2026-130", status: "pending" }),
  txn({
    id: "txn_3",
    amount: -2000,
    net: -2000,
    created: at("2026-10-12T10:02:00Z"),
    reporting_category: "refund",
    type: "refund",
    description: "REFUND FOR CHARGE",
  }),
  txn({ id: "txn_4", amount: -50, net: -50, created: at("2026-10-15T00:00:00Z"), reporting_category: "fee", type: "stripe_fee", description: "Billing" }),
  txn({
    id: "txn_5",
    amount: -12379,
    net: -12379,
    created: at("2026-10-21T04:00:00Z"),
    reporting_category: "payout",
    type: "payout",
    source: "po_1",
    description: "STRIPE PAYOUT",
  }),
  txn({ id: "txn_6", amount: 0, fee: 15, net: -15, created: at("2026-10-22T08:00:00Z"), description: "Nur Gebühr" }),
];

const euro = (cents: number) => (cents / 100).toFixed(2);
const csv = (): string[][] => [
  ["balance_transaction_id", "created_utc", "reporting_category", "gross", "fee", "net", "currency", "description"],
  ...transactions.map((t) => [
    t.id,
    new Date(t.created * 1000).toISOString().slice(0, 19).replace("T", " "),
    t.reporting_category ?? t.type,
    euro(t.amount),
    euro(t.fee),
    euro(t.net),
    t.currency,
    t.description ?? "",
  ]),
];

describe("Stripe: API und CSV-Export", () => {
  const rows = csv();
  const header = findHeaderRow(rows, isStripeHeader);
  const fromCsv = parseStripe(rows, header).transactions;
  const batch = validateBatch(
    stripeBatch({
      externalAccountId: "acct_beispiel",
      transactions,
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      fetchedAt: "2026-11-01T06:00:00Z",
      fetchId: "abruf-1",
    }),
    { provider: "stripe", externalAccountId: "acct_beispiel", accountKind: "psp" },
  );
  if (!batch.ok) throw new Error(batch.problems.join(" "));

  /** Schlüssel je Bewegung: Kennung (die Gebühr mit Anhang wie im CSV-Import), Buchungstag und Betrag */
  const apiKeys = batch.accepted.map((m) => [m.component === "fee" ? `${m.sourceEventId}-gebuehr` : m.sourceEventId, m.bookingDate, m.amount]);

  it("ergibt dieselben Umsätze mit demselben Buchungstag und Betrag", () => {
    const csvKeys = fromCsv.map((t) => [t.bankReference, t.bookingDate, t.amount]);
    expect(apiKeys).toEqual(csvKeys);
  });

  it("zählt Gebühren, Erstattung und Auszahlung wie der CSV-Import", () => {
    const total = (list: { amount: number }[]) => list.reduce((s, m) => s + m.amount, 0);
    expect(total(batch.accepted)).toBe(total(fromCsv));
    expect(total(batch.accepted)).toBe(transactions.reduce((s, t) => s + t.net, 0));
  });
});
