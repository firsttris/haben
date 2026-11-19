import { type EbTransaction, enableBankingStatement } from "@haben/import";
import { describe, expect, it } from "vitest";
import { abrufNachVertrag, berlinTimestamp } from "./vertrag-abruf.ts";

const tx = (over: Partial<EbTransaction> = {}): EbTransaction => ({
  entry_reference: "ER-1",
  transaction_amount: { currency: "EUR", amount: "10.00" },
  credit_debit_indicator: "CRDT",
  status: "BOOK",
  booking_date: "2026-10-05",
  remittance_information: ["Zinsen"],
  ...over,
});

describe("berlinTimestamp", () => {
  it("nennt Zeit und Offset in Deutschland, auch nach Mitternacht UTC-seitig", () => {
    expect(berlinTimestamp(new Date("2026-10-09T22:30:00Z"))).toBe("2026-10-10T00:30:00+02:00");
    expect(berlinTimestamp(new Date("2026-11-16T23:30:05Z"))).toBe("2026-11-17T00:30:05+01:00");
  });
});

describe("abrufNachVertrag", () => {
  const nachVertrag = (transactions: EbTransaction[]) =>
    abrufNachVertrag({
      identificationHash: "hash-1",
      transactions,
      balances: [],
      statement: enableBankingStatement({ account: { uid: "u" }, transactions, balances: [], dateFrom: "2026-10-01", dateTo: "2026-10-09" }),
      dateFrom: "2026-10-01",
      dateTo: "2026-10-09",
      now: new Date("2026-10-09T20:00:00Z"),
      fetchId: "abruf-1",
      source: { filename: "Abruf", sha256: "x" },
    });

  it("bindet an den identification_hash", () => {
    const { input, hinweise } = nachVertrag([tx()]);
    expect(input.binding).toEqual({ provider: "enablebanking", externalAccountId: "hash-1", accountKind: "bank" });
    expect(input.batch.externalAccountId).toBe("hash-1");
    expect(hinweise).toEqual([]);
  });

  it("gibt „Umsätze abrufen ab“ für den Stichtag einer neuen Bindung mit", () => {
    const mit = abrufNachVertrag({
      identificationHash: "hash-1",
      transactions: [tx()],
      balances: [],
      statement: { format: "enablebanking", currency: "EUR", transactions: [], warnings: [] },
      dateFrom: "2026-10-01",
      dateTo: "2026-10-09",
      now: new Date("2026-10-09T20:00:00Z"),
      fetchId: "abruf-1",
      source: { filename: "Abruf", sha256: "x" },
      fetchFrom: "2026-09-15",
    });
    expect(mit.input.fetchFrom).toBe("2026-09-15");
    expect(nachVertrag([tx()]).input).not.toHaveProperty("fetchFrom");
  });

  it("nennt Umsätze ohne entry_reference, ohne dass sie den Zeitraum offenhalten", () => {
    const { input, hinweise } = nachVertrag([tx(), tx({ entry_reference: null, transaction_id: "T-9" }), tx({ entry_reference: " " })]);
    expect(hinweise).toEqual(["2 Umsätze ohne Referenz der Bank (entry_reference): wie bisher am Inhalt erkannt."]);
    expect(input.batch.unsupported).toEqual([]);
  });

  it("ordnet mehrdeutige Zeilen auch nach der Sortierung ihrer Vertragsprüfung zu und nennt sie im Hinweis", () => {
    const { input, hinweise } = nachVertrag([
      tx(),
      tx(),
      tx({ entry_reference: "ER-2", booking_date: "2026-09-28" }),
      tx({ entry_reference: "ER-3", booking_date: "2026-10-12" }),
    ]);
    expect(hinweise).toEqual([
      "1 Umsatz nach dem abgerufenen Zeitraum nicht übernommen; der nächste Abruf holt ihn.",
      "2 Umsätze mit mehrfach vergebener Bankreferenz: am Inhalt erkannt.",
    ]);
    const events = input.statement.transactions.map(input.eventOf);
    expect(events[0]).toBe("ER-2");
    expect(events[3]).toBe("ER-3");
    expect(new Set(events.slice(1, 3))).toEqual(input.fallbackEvents);
  });

  it("lässt vorgemerkte Umsätze unter unsupported", () => {
    expect(nachVertrag([tx({ status: "PDNG" })]).input.batch.unsupported).toHaveLength(1);
  });

  it("verwechselt eine Prüfkennung nicht mit der echten Referenz einer Zeile außerhalb des Fensters", () => {
    const { input } = nachVertrag([tx(), tx(), tx({ entry_reference: "~zeile:0", booking_date: "2026-10-12" })]);
    const event = input.eventOf(input.statement.transactions[2]!);
    expect(event).toBe("~zeile:0");
    expect(input.fallbackEvents?.has(event!)).toBe(false);
  });
});
