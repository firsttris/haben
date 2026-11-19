import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findHeaderRow } from "../table.ts";
import { isStripeHeader, parseStripe } from "../psp.ts";
import { stripeBatch } from "./batch.ts";
import type { StripeBalanceTransaction } from "./client.ts";
import { stripeEventOf, stripeStatement } from "./statement.ts";

// Echte Antworten des Stripe-Testmodus, Kennungen erfunden, siehe test-fixtures/stripe/README.md
const transactions: StripeBalanceTransaction[] = JSON.parse(
  readFileSync(new URL("../../test-fixtures/stripe/sandbox-balance-transactions.json", import.meta.url), "utf8"),
);

describe("stripeStatement", () => {
  const statement = stripeStatement(transactions);

  it("liest die Balance Transactions wie den CSV-Export: Betrag und Gebühr getrennt, Gebühr mit eigener Referenz", () => {
    expect(statement.format).toBe("stripe-api");
    expect(statement.transactions).toHaveLength(10);
    const refs = statement.transactions.map((t) => t.bankReference);
    expect(refs).toContain("txn_Beispiel007");
    expect(refs).toContain("txn_Beispiel007-gebuehr");
    expect(statement.transactions.reduce((s, t) => s + t.amount, 0)).toBe(transactions.reduce((s, t) => s + t.net, 0));
  });

  it("ergibt dieselben Umsätze wie derselbe Export als CSV, auch im Zweck, den der Dubletten-Hash umfasst", () => {
    const euro = (cents: number) => (cents / 100).toFixed(2);
    const rows = [
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
    const csv = parseStripe(rows, findHeaderRow(rows, isStripeHeader));
    expect(statement.transactions.map(({ bookingDate, amount, purpose, bankReference }) => [bookingDate, amount, purpose, bankReference])).toEqual(
      csv.transactions.map(({ bookingDate, amount, purpose, bankReference }) => [bookingDate, amount, purpose, bankReference]),
    );
  });

  it("nimmt den Namen des Kunden, wo Stripe ihn zur Zahlung kennt", () => {
    const mitName = stripeStatement([{ ...transactions[3]!, customerName: "Erika Beispiel" }]);
    expect(mitName.transactions[0]!.counterpartyName).toBe("Erika Beispiel");
  });
});

describe("stripeEventOf", () => {
  const batch = stripeBatch({
    externalAccountId: "acct_beispiel",
    transactions,
    dateFrom: "2019-01-01",
    dateTo: "2026-11-06",
    fetchedAt: "2026-11-07T06:00:00Z",
    fetchId: "x",
  });
  const keys = new Set(batch.movements.map((m) => (m.component === "main" ? m.sourceEventId : `${m.sourceEventId}#${m.component}`)));
  const eventOf = stripeEventOf(keys);

  it("ordnet jedem Umsatz seine Bewegung zu: den Hauptbetrag unter der Kennung, die Gebühr mit „#fee“", () => {
    expect(eventOf({ bankReference: "txn_Beispiel007" })).toBe("txn_Beispiel007");
    expect(eventOf({ bankReference: "txn_Beispiel007-gebuehr" })).toBe("txn_Beispiel007#fee");
  });

  it("kennt keine Bewegung zu einem Umsatz ohne Referenz oder außerhalb der Lieferung", () => {
    expect(eventOf({})).toBeUndefined();
    expect(eventOf({ bankReference: "txn_unbekannt" })).toBeUndefined();
    expect(eventOf({ bankReference: "txn_unbekannt-gebuehr" })).toBeUndefined();
  });
});
