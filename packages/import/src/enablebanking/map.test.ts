import { describe, expect, it } from "vitest";
import { withDedupHashes } from "../dedup.ts";
import type { EbTransaction } from "./client.ts";
import { bookedBalance, enableBankingStatement, mapEnableBankingTransaction } from "./map.ts";

const base = {
  transaction_amount: { currency: "EUR", amount: "119.00" },
  status: "BOOK",
  booking_date: "2026-09-15",
  value_date: "2026-09-15",
} as const;

const incoming: EbTransaction = {
  ...base,
  entry_reference: "ref-1",
  credit_debit_indicator: "CRDT",
  debtor: { name: "Muster  GmbH" },
  debtor_account: { iban: "DE02 1203 0000 0000 2020 51" },
  creditor: { name: "Ich" },
  remittance_information: ["RE-2026-0042", "Danke"],
  bank_transaction_code: { description: "Gutschrift" },
};

const outgoing: EbTransaction = {
  ...base,
  transaction_amount: { currency: "EUR", amount: "49.99" },
  transaction_id: "t-2",
  credit_debit_indicator: "DBIT",
  booking_date: "2026-09-10",
  creditor: { name: "Telekom" },
  creditor_account: { iban: "DE89370400440532013000" },
  remittance_information: ["Rechnung 9/2026"],
};

describe("mapEnableBankingTransaction", () => {
  it("setzt das Vorzeichen nach Soll/Haben und nimmt die Gegenpartei der Richtung", () => {
    expect(mapEnableBankingTransaction(incoming, 0)).toEqual({
      bookingDate: "2026-09-15",
      valueDate: "2026-09-15",
      amount: 11900,
      currency: "EUR",
      counterpartyName: "Muster GmbH",
      counterpartyIban: "DE02120300000000202051",
      purpose: "RE-2026-0042 Danke",
      type: "Gutschrift",
      bankReference: "ref-1",
      index: 0,
    });
    const out = mapEnableBankingTransaction(outgoing, 1)!;
    expect(out.amount).toBe(-4999);
    expect(out.counterpartyName).toBe("Telekom");
    expect(out.counterpartyIban).toBe("DE89370400440532013000");
    expect(out.bankReference).toBe("t-2");
  });

  it("lässt vorgemerkte Umsätze weg", () => {
    expect(mapEnableBankingTransaction({ ...incoming, status: "PDNG" }, 0)).toBeNull();
  });

  it("nimmt das Valutadatum, wenn das Buchungsdatum fehlt", () => {
    expect(mapEnableBankingTransaction({ ...incoming, booking_date: null, value_date: "2026-09-16" }, 0)!.bookingDate).toBe("2026-09-16");
  });
});

describe("enableBankingStatement", () => {
  const account = { uid: "u1", account_id: { iban: "DE12 5001 0517 0648 4898 90" }, name: "Geschäftskonto", currency: "EUR" };

  it("sortiert nach Buchungstag und meldet vorgemerkte Umsätze", () => {
    const statement = enableBankingStatement({
      account,
      transactions: [incoming, { ...incoming, status: "PDNG" }, outgoing],
      balances: [
        { balance_amount: { currency: "EUR", amount: "100.00" }, balance_type: "XPCD" },
        { balance_amount: { currency: "EUR", amount: "1234.56" }, balance_type: "CLBD", reference_date: "2026-10-01" },
      ],
      dateFrom: "2026-09-01",
      dateTo: "2026-10-02",
    });
    expect(statement.format).toBe("enablebanking");
    expect(statement.accountIban).toBe("DE12500105170648489890");
    expect(statement.accountName).toBe("Geschäftskonto");
    expect(statement.transactions.map((t) => [t.bookingDate, t.amount, t.index])).toEqual([
      ["2026-09-10", -4999, 0],
      ["2026-09-15", 11900, 1],
    ]);
    expect(statement.closingBalance).toBe(123456);
    expect(statement.statedBalance).toEqual({ date: "2026-10-01", amount: 123456 });
    expect(statement.warnings).toEqual(["1 vorgemerkte Umsätze folgen, sobald die Bank sie bucht."]);
  });

  it("ergibt bei überlappenden Abrufen dieselben Hashes", () => {
    const first = enableBankingStatement({ account, transactions: [outgoing, incoming, incoming], balances: [], dateFrom: "2026-09-01", dateTo: "2026-09-20" });
    const second = enableBankingStatement({ account, transactions: [incoming, incoming], balances: [], dateFrom: "2026-09-13", dateTo: "2026-09-25" });
    const firstHashes = withDedupHashes(first.transactions).map((t) => t.dedupHash);
    const secondHashes = withDedupHashes(second.transactions).map((t) => t.dedupHash);
    expect(firstHashes.slice(1)).toEqual(secondHashes);
    expect(new Set(firstHashes).size).toBe(3);
  });
});

describe("bookedBalance", () => {
  it("ist null ohne Salden", () => {
    expect(bookedBalance([])).toBeNull();
  });
});
