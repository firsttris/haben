import { describe, expect, it } from "vitest";
import { etsyLedgerBatch } from "./etsy-batch.ts";
import type { EtsyLedgerEntry } from "./etsy-ledger.ts";
import { validateBatch } from "./importvertrag/index.ts";

/** 2026-10-05 10:00:00 UTC in Epoch-Sekunden */
const T = Date.UTC(2026, 9, 5, 10, 0, 0) / 1000;

const entry = (e: Partial<EtsyLedgerEntry> & Pick<EtsyLedgerEntry, "entry_id" | "sequence_number" | "amount" | "ledger_type">): EtsyLedgerEntry => ({
  currency: "EUR",
  created_timestamp: T,
  ...e,
});

const base = {
  shopId: "12345678",
  dateFrom: "2026-10-01",
  dateTo: "2026-10-31",
  fetchedAt: "2026-10-31T23:00:00Z",
  fetchId: "etsy-2026-10-31",
};

const binding = { provider: "etsy", externalAccountId: "12345678", accountKind: "psp" as const };

describe("etsyLedgerBatch", () => {
  it("sortiert nach sequence_number, nicht nach Zeitstempel, damit die Saldokette aufgeht", () => {
    // Drei Zeilen in derselben Sekunde, von Etsy in anderer Reihenfolge geliefert
    const batch = etsyLedgerBatch({
      ...base,
      entries: [
        entry({ entry_id: 3, sequence_number: 30, amount: -50, ledger_type: "transaction", balance: 2250 }),
        entry({ entry_id: 1, sequence_number: 10, amount: 2500, ledger_type: "PAYMENT_GROSS", balance: 2500 }),
        entry({ entry_id: 2, sequence_number: 20, amount: -200, ledger_type: "PAYMENT_PROCESSING_FEE", balance: 2300 }),
      ],
    });
    expect(batch.movements.map((m) => m.sourceEventId)).toEqual(["1", "2", "3"]);
    // Tagessaldo ist der Stand der letzten Zeile des Tages
    expect(batch.balances).toEqual([{ date: "2026-10-05", amount: 2250, currency: "EUR" }]);
  });

  it("ordnet die Arten wie im Vertragsbeispiel zu", () => {
    const batch = etsyLedgerBatch({
      ...base,
      entries: [
        entry({ entry_id: 1, sequence_number: 1, amount: 2500, ledger_type: "PAYMENT_GROSS" }),
        entry({ entry_id: 2, sequence_number: 2, amount: -900, ledger_type: "REFUND_GROSS" }),
        entry({ entry_id: 3, sequence_number: 3, amount: -221, ledger_type: "sales_tax" }),
        entry({ entry_id: 4, sequence_number: 4, amount: -20, ledger_type: "listing" }),
        entry({ entry_id: 5, sequence_number: 5, amount: -1500, ledger_type: "DISBURSE2", reference_type: "disbursement", reference_id: 777 }),
        entry({ entry_id: 6, sequence_number: 6, amount: 672, ledger_type: "billing_payment" }),
        entry({ entry_id: 7, sequence_number: 7, amount: 100, ledger_type: "RECOUP" }),
      ],
    });
    expect(batch.movements.map((m) => [m.references.eventCode, m.kind, m.component])).toEqual([
      ["PAYMENT_GROSS", "payment", "main"],
      ["REFUND_GROSS", "refund", "main"],
      ["sales_tax", "adjustment", "main"],
      ["listing", "fee", "main"],
      ["DISBURSE2", "payout", "main"],
      ["billing_payment", "adjustment", "main"],
      ["RECOUP", "adjustment", "main"],
    ]);
    expect(batch.movements[4]?.references.payoutId).toBe("777");
    expect(batch.movements[4]?.references.providerReference).toBe("disbursement:777");
  });

  it("übernimmt parent_entry_id als Bezug und die Bestellnummer aus Zeile oder Payments-Abruf", () => {
    const batch = etsyLedgerBatch({
      ...base,
      orderFor: (zahlung) => (zahlung === "9001" ? "3000000001" : undefined),
      entries: [
        entry({ entry_id: 1, sequence_number: 1, amount: 2500, ledger_type: "PAYMENT_GROSS", reference_type: "shop_payment", reference_id: "9001" }),
        entry({ entry_id: 2, sequence_number: 2, amount: -221, ledger_type: "sales_tax", reference_type: "receipt", reference_id: "3000000001" }),
        entry({ entry_id: 3, sequence_number: 3, amount: -50, ledger_type: "transaction", reference_type: "transaction", reference_id: "55" }),
        entry({ entry_id: 4, sequence_number: 4, amount: 50, ledger_type: "transaction_refund", parent_entry_id: 3 }),
      ],
    });
    const [verkauf, steuer, gebuehr, gutschrift] = batch.movements;
    expect(verkauf?.references.orderId).toBe("3000000001");
    expect(steuer?.references.orderId).toBe("3000000001");
    // Die Transaktionsgebühr verweist nur auf die Transaktion, eine Bestellnummer wird nicht erfunden
    expect(gebuehr?.references.orderId).toBeUndefined();
    expect(gutschrift?.references.relatedEventId).toBe("3");
  });

  it("verknüpft eine Erstattung mit dem einzigen Verkauf derselben Bestellung, sonst nicht", () => {
    const orders: Record<string, string> = { "9001": "3000000001", "9002": "3000000001", "9003": "3000000002", "9004": "3000000003", "9005": "3000000003" };
    const batch = etsyLedgerBatch({
      ...base,
      orderFor: (zahlung) => orders[zahlung],
      entries: [
        entry({ entry_id: 1, sequence_number: 1, amount: 2500, ledger_type: "PAYMENT_GROSS", reference_id: "9001" }),
        entry({ entry_id: 2, sequence_number: 2, amount: -900, ledger_type: "REFUND_GROSS", reference_id: "9002" }),
        // Erstattung ohne Verkauf in dieser Lieferung
        entry({ entry_id: 3, sequence_number: 3, amount: -900, ledger_type: "REFUND_GROSS", reference_id: "9003" }),
        // Zwei Verkäufe derselben Bestellung: nicht eindeutig, also kein Bezug
        entry({ entry_id: 4, sequence_number: 4, amount: 1000, ledger_type: "PAYMENT_GROSS", reference_id: "9004" }),
        entry({ entry_id: 5, sequence_number: 5, amount: 1000, ledger_type: "PAYMENT_GROSS", reference_id: "9005" }),
        entry({ entry_id: 6, sequence_number: 6, amount: -500, ledger_type: "REFUND_GROSS", reference_id: "9004" }),
      ],
    });
    const bezug = (id: string) => batch.movements.find((m) => m.sourceEventId === id)?.references.relatedEventId;
    expect(bezug("2")).toBe("1");
    expect(bezug("3")).toBeUndefined();
    expect(bezug("6")).toBeUndefined();
  });

  it("führt Zeilen ohne entry_id und mit unbekanntem Typ unter unsupported, statt sie zu raten", () => {
    const batch = etsyLedgerBatch({
      ...base,
      entries: [
        entry({ entry_id: 1, sequence_number: 1, amount: -20, ledger_type: "listing" }),
        { amount: -20, currency: "EUR", created_timestamp: T, ledger_type: "listing", sequence_number: 2 },
        entry({ entry_id: 3, sequence_number: 3, amount: -99, ledger_type: "neue_gebuehr" }),
      ],
    });
    expect(batch.movements.map((m) => m.sourceEventId)).toEqual(["1"]);
    // Mit dem Buchungstag: Der Vertrag hält den Zeitraum dann erst ab diesem Tag offen, nicht ab dem Anfang des Fensters
    const tag = new Date(T * 1000).toISOString().slice(0, 10);
    expect(batch.unsupported).toEqual([
      { bookingDate: tag, reason: expect.stringContaining("ohne entry_id") },
      { sourceEventId: "3", bookingDate: tag, reason: expect.stringContaining("neue_gebuehr") },
    ]);
  });

  it("liefert eine Lieferung, die der Vertrag annimmt", () => {
    const batch = etsyLedgerBatch({
      ...base,
      entries: [
        entry({ entry_id: 1, sequence_number: 1, amount: 2500, ledger_type: "PAYMENT_GROSS", balance: 2500 }),
        entry({ entry_id: 2, sequence_number: 2, amount: -200, ledger_type: "PAYMENT_PROCESSING_FEE", balance: 2300 }),
        entry({ entry_id: 3, sequence_number: 3, amount: -2300, ledger_type: "DISBURSE2", reference_id: 4, balance: 0, created_timestamp: T + 86400 }),
      ],
    });
    const result = validateBatch(batch, binding);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted).toHaveLength(3);
    expect(result.blocking).toBe(0);
    expect(batch.balances.map((b) => [b.date, b.amount])).toEqual([
      ["2026-10-05", 2300],
      ["2026-10-06", 0],
    ]);
    expect(batch.movements[0]?.sourceTimestamp).toBe("2026-10-05T10:00:00.000Z");
  });

  it("führt die Umsatzsteuer auf Gebühren (vat_seller_services) als Gebühr, nicht unter unsupported", () => {
    const batch = etsyLedgerBatch({
      ...base,
      entries: [
        entry({ entry_id: 1, sequence_number: 1, amount: -20, ledger_type: "listing" }),
        entry({ entry_id: 2, sequence_number: 2, amount: -4, ledger_type: "vat_seller_services", parent_entry_id: 1 }),
      ],
    });
    expect(batch.unsupported).toEqual([]);
    expect(batch.movements.find((m) => m.sourceEventId === "2")).toMatchObject({ kind: "fee", amount: -4, references: { relatedEventId: "1" } });
    const result = validateBatch(batch, binding);
    expect(result.ok && result.blocking).toBe(0);
  });
});
