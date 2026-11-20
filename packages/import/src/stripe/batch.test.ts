import { describe, expect, it } from "vitest";
import { advanceCheckpoint, classifyMovements, knownMovement, movementKey, validateBatch } from "../importvertrag/index.ts";
import { stripeBatch, STRIPE_NICHT_UNTERSTUETZT } from "./batch.ts";
import type { StripeBalanceTransaction } from "./client.ts";

// Erfundene Werte; 2026-10-06 12:00 UTC
const T = Date.UTC(2026, 9, 6, 12) / 1000;

const txn = (over: Partial<StripeBalanceTransaction> = {}): StripeBalanceTransaction => ({
  id: "txn_1",
  amount: 10000,
  created: T,
  currency: "eur",
  description: "Rechnung 2026-117",
  fee: 300,
  net: 9700,
  reporting_category: "charge",
  source: "ch_1",
  status: "available",
  type: "charge",
  ...over,
});

const input = (transactions: StripeBalanceTransaction[]) => ({
  externalAccountId: "acct_beispiel",
  transactions,
  dateFrom: "2026-10-01",
  dateTo: "2026-10-31",
  fetchedAt: "2026-11-01T06:00:00Z",
  fetchId: "abruf-1",
});

const binding = { provider: "stripe", externalAccountId: "acct_beispiel", accountKind: "psp" as const };

function accept(transactions: StripeBalanceTransaction[]) {
  const result = validateBatch(stripeBatch(input(transactions)), binding);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result;
}

const sum = (list: { amount: number }[]) => list.reduce((s, m) => s + m.amount, 0);

describe("stripeBatch", () => {
  it("bildet Zahlung und Gebühr als zwei Komponenten ab, die zusammen das Netto ergeben", () => {
    const result = accept([txn()]);
    expect(result.accepted.map((m) => [m.sourceEventId, m.component, m.kind, m.amount])).toEqual([
      ["txn_1", "main", "payment", 10000],
      ["txn_1", "fee", "payment", -300],
    ]);
    expect(sum(result.accepted)).toBe(9700);
    expect(result.accepted[0]).toMatchObject({ bookingDate: "2026-10-06", currency: "EUR", references: { providerReference: "txn_1", eventCode: "charge" } });
    expect(result.blocking).toBe(0);
  });

  it("setzt Name und Verwendungszweck der Zahlung aus dem Charge, wenn die Balance Transaction keine Beschreibung hat", () => {
    const result = accept([
      txn({ description: null, customerName: "Beispiel GmbH", chargeDescription: "Rechnung 2026-117", invoice: "RE-0026" }),
      txn({ id: "txn_2", description: null }),
    ]);
    const [paid, , bare] = result.accepted;
    expect(paid).toMatchObject({ counterpartyName: "Beispiel GmbH", purpose: "Rechnung 2026-117 · RE-0026" });
    // Die Gebühr hat Stripe als Gegenseite, nicht den Kunden
    expect(result.accepted[1]).toMatchObject({ component: "fee", counterpartyName: "Stripe" });
    expect(bare!.counterpartyName).toBeUndefined();
    expect(bare!.purpose).toBe("charge");
  });

  it("lässt bei Auszahlung und Stripe-Rechnung Stripe als Gegenpartei, auch wenn ein Kunde bekannt wäre", () => {
    const result = accept([
      txn({ id: "txn_3", amount: -9700, fee: 0, net: -9700, reporting_category: "payout", type: "payout", source: "po_1", customerName: "Beispiel GmbH" }),
    ]);
    expect(result.accepted[0]!.counterpartyName).toBe("Stripe");
  });

  it("nimmt auch noch nicht verfügbares Guthaben (pending) an", () => {
    expect(accept([txn({ status: "pending" })]).accepted).toHaveLength(2);
  });

  it("bildet Erstattung und Auszahlung ab; zusammen ergeben sie 0", () => {
    const result = accept([
      txn(),
      txn({ id: "txn_2", amount: -2000, fee: 0, net: -2000, reporting_category: "refund", type: "refund", source: "re_1", description: "REFUND FOR CHARGE" }),
      txn({ id: "txn_3", amount: -7700, fee: 0, net: -7700, reporting_category: "payout", type: "payout", source: "po_1", description: "STRIPE PAYOUT" }),
    ]);
    expect(result.accepted.map((m) => [m.sourceEventId, m.component, m.kind])).toEqual([
      ["txn_1", "main", "payment"],
      ["txn_1", "fee", "payment"],
      ["txn_2", "main", "refund"],
      ["txn_3", "main", "payout"],
    ]);
    expect(sum(result.accepted)).toBe(0);
    const payout = result.accepted.find((m) => m.sourceEventId === "txn_3")!;
    expect(payout.counterpartyName).toBe("Stripe");
    expect(payout.references.payoutId).toBe("po_1");
  });

  it("legt eine Stripe-Rechnung als Gebühr an und eine Bewegung ohne Betrag nur als Gebührenkomponente", () => {
    const result = accept([
      txn({ id: "txn_4", amount: -50, fee: 0, net: -50, reporting_category: "fee", type: "stripe_fee", description: "Billing - Usage Fee", source: null }),
      txn({ id: "txn_5", amount: 0, fee: 15, net: -15 }),
    ]);
    expect(result.accepted.map((m) => [m.sourceEventId, m.component, m.kind, m.amount])).toEqual([
      ["txn_4", "main", "fee", -50],
      ["txn_5", "fee", "payment", -15],
    ]);
  });

  it("zählt eine zurückerstattete Gebühr (negative Gebühr) als Gutschrift", () => {
    const result = accept([txn({ id: "txn_6", amount: -2000, fee: -60, net: -1940, reporting_category: "refund", type: "refund" })]);
    expect(result.accepted.map((m) => [m.component, m.amount])).toEqual([
      ["main", -2000],
      ["fee", 60],
    ]);
  });

  it("legt Bewegungen ohne bekannte Kategorie oder mit falschem Netto offen unter unsupported ab", () => {
    const batch = stripeBatch(
      input([
        txn({ id: "txn_7", reporting_category: "transfer", type: "transfer" }),
        txn({ id: "txn_8", net: 1 }),
        txn({ id: "txn_9", reporting_category: null, type: "charge" }),
      ]),
    );
    expect(batch.unsupported.map((u) => u.sourceEventId)).toEqual(["txn_7", "txn_8"]);
    expect(batch.unsupported[0]!.reason).toContain(STRIPE_NICHT_UNTERSTUETZT);
    expect(batch.movements.map((m) => m.sourceEventId)).toEqual(["txn_9", "txn_9"]);
    const result = validateBatch(batch, binding);
    if (!result.ok) throw new Error(result.problems.join(" "));
    expect(result.blocking).toBe(2);
    expect(
      advanceCheckpoint("2026-09-30", [{ coverage: result.batch.coverage, part: result.batch.part, blocking: result.blocking, conflict: false }]).complete,
    ).toBe(false);
  });

  it("nimmt fremde Währung nicht an, verwirft die Lieferung nicht und lässt den Zeitraum offen", () => {
    const result = accept([txn(), txn({ id: "txn_10", currency: "usd" })]);
    expect(result.accepted.map((m) => m.sourceEventId)).toEqual(["txn_1", "txn_1"]);
    expect(result.rejected.length).toBeGreaterThan(0);
    expect(result.rejected.every((r) => r.sourceEventId === "txn_10" && r.blocking)).toBe(true);
  });

  it("erkennt dieselben Bewegungen bei erneutem Abruf als bekannt", () => {
    const first = accept([txn()]);
    const known = new Map(first.accepted.map((m) => [movementKey(binding, m), [knownMovement(m)]]));
    const again = accept([txn()]);
    expect(classifyMovements(known, binding, again.accepted).results.map((r) => r.outcome)).toEqual(["known", "known"]);
  });

  it("nimmt den Buchungstag in UTC, auch nach Mitternacht Berliner Zeit", () => {
    // 2026-10-06 22:30 UTC ist in Berlin schon der 7.; der CSV-Export „Balance history“ nennt UTC
    const result = accept([txn({ created: Date.UTC(2026, 9, 6, 22, 30) / 1000 })]);
    expect(result.accepted[0]!.bookingDate).toBe("2026-10-06");
    expect(result.accepted[0]!.sourceTimestamp).toBe("2026-10-06T22:30:00.000Z");
  });
});
