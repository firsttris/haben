import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateBatch } from "../importvertrag/index.ts";
import { stripeBatch } from "./batch.ts";
import type { StripeBalanceTransaction } from "./client.ts";

// Echte Antworten des Stripe-Testmodus, Kennungen erfunden, siehe test-fixtures/stripe/README.md
const transactions: StripeBalanceTransaction[] = JSON.parse(
  readFileSync(new URL("../../test-fixtures/stripe/sandbox-balance-transactions.json", import.meta.url), "utf8"),
);

const binding = { provider: "stripe", externalAccountId: "acct_beispiel", accountKind: "psp" as const };
const result = validateBatch(
  stripeBatch({
    externalAccountId: "acct_beispiel",
    transactions,
    dateFrom: "2019-01-01",
    dateTo: "2026-11-06",
    fetchedAt: "2026-11-07T06:00:00Z",
    fetchId: "sandbox",
  }),
  binding,
);
if (!result.ok) throw new Error(result.problems.join(" "));

describe("Stripe-Testmodus", () => {
  it("nimmt alle Bewegungen an und nennt keinen Hinweis und nichts, das den Zeitraum offen lässt", () => {
    expect(result.rejected).toEqual([]);
    expect(result.blocking).toBe(0);
    expect(result.hints).toEqual([]);
    expect(result.accepted.map((m) => m.sourceEventId)).not.toContain(undefined);
  });

  it("bezieht die Erstattung auf die Zahlung und den Streit auf seine Zahlung", () => {
    const refund = result.accepted.find((m) => m.kind === "refund")!;
    const payment = result.accepted.find((m) => m.sourceEventId === refund.references.relatedEventId && m.component === "main")!;
    expect(payment.kind).toBe("payment");
    expect(payment.amount + refund.amount).toBe(11400);
    const dispute = result.accepted.find((m) => m.kind === "chargeback" && m.component === "main")!;
    expect(transactions.find((t) => t.id === dispute.references.relatedEventId)?.type).toBe("charge");
  });

  it("bildet den Streit mit Betrag und Streitgebühr als zwei Komponenten ab", () => {
    const dispute = result.accepted.filter((m) => m.kind === "chargeback");
    expect(dispute.map((m) => [m.component, m.amount])).toEqual([
      ["main", -4800],
      ["fee", -1500],
    ]);
  });

  it("hält das Netto jeder Balance Transaction ein", () => {
    for (const t of transactions) {
      const own = result.accepted.filter((m) => m.sourceEventId === t.id);
      expect([t.id, own.reduce((s, m) => s + m.amount, 0)]).toEqual([t.id, t.net]);
    }
  });
});
