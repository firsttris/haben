import { describe, expect, it } from "vitest";
import { validateBatch } from "../importvertrag/index.ts";
import type { EbTransaction } from "./client.ts";
import { enableBankingBatch, entryReferenceOf } from "./batch.ts";
import { enableBankingStatement } from "./map.ts";

const tx = (over: Partial<EbTransaction> = {}): EbTransaction => ({
  entry_reference: "ER-1",
  transaction_amount: { currency: "EUR", amount: "49.99" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-10-05",
  value_date: "2026-10-06",
  creditor: { name: "Telekom" },
  creditor_account: { iban: "DE89370400440532013000" },
  remittance_information: ["Rechnung 9/2026"],
  ...over,
});

const input = (transactions: EbTransaction[], over: Partial<Parameters<typeof enableBankingBatch>[0]> = {}) => ({
  externalAccountId: "DE12500105170648489890",
  transactions,
  balances: [{ balance_amount: { currency: "EUR", amount: "1500.00" }, balance_type: "CLBD", reference_date: "2026-10-30" }],
  dateFrom: "2026-10-01",
  dateTo: "2026-10-31",
  fetchedAt: "2026-10-31T23:15:00+01:00",
  fetchId: "abruf-1",
  ...over,
});

const binding = { provider: "enablebanking", externalAccountId: "DE12500105170648489890", accountKind: "bank" as const };

describe("enableBankingBatch", () => {
  it("übersetzt einen gebuchten Umsatz mit entry_reference in eine Bewegung des Vertrags", () => {
    const result = validateBatch(enableBankingBatch(input([tx()])), binding);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.batch).toMatchObject({
      provider: "enablebanking",
      externalAccountId: "DE12500105170648489890",
      idempotencyKey: "abruf-1",
      coverage: { from: "2026-10-01", to: "2026-10-31" },
      part: { fetchId: "abruf-1", index: 0, last: true },
      unsupported: [],
    });
    expect(result.accepted).toEqual([
      {
        sourceEventId: "ER-1",
        component: "main",
        kind: "payment",
        bookingDate: "2026-10-05",
        valueDate: "2026-10-06",
        amount: -4999,
        currency: "EUR",
        counterpartyName: "Telekom",
        counterpartyIban: "DE89370400440532013000",
        purpose: "Rechnung 9/2026",
        references: { providerReference: "ER-1" },
      },
    ]);
    expect(result.balances).toEqual([{ date: "2026-10-30", amount: 150000, currency: "EUR" }]);
  });

  it("nimmt ohne entry_reference keine transaction_id als Ersatz, der Umsatz zählt als nicht eingeordnet", () => {
    const result = validateBatch(enableBankingBatch(input([tx({ entry_reference: null, transaction_id: "T-1" })])), binding);
    expect(result.ok && result.accepted).toEqual([]);
    expect(result.ok && result.batch.unsupported).toEqual([
      { bookingDate: "2026-10-05", reason: "Gebuchter Umsatz vom 2026-10-05 ohne entry_reference; transaction_id kann sich ändern und ist kein Ersatz." },
    ]);
    expect(result.ok && result.blocking).toBe(1);
  });

  it("verwechselt die transaction_id eines anderen Umsatzes nicht mit seiner entry_reference", () => {
    const transactions = [
      tx({ entry_reference: " ER-1 ", transaction_id: "T-1" }),
      tx({ entry_reference: null, transaction_id: " ER-1 ", remittance_information: ["Eigenständiger Umsatz"] }),
    ];
    const statement = enableBankingStatement({ ...input(transactions), account: { uid: "konto" } });
    const eventOf = entryReferenceOf(transactions);
    expect(statement.transactions.map(eventOf)).toEqual(["ER-1", undefined]);
  });

  it("legt vorgemerkte und unbekannte Status nicht als Bewegung an", () => {
    const batch = enableBankingBatch(input([tx({ entry_reference: "ER-2", status: "PDNG" }), tx({ entry_reference: "ER-3", status: "OTHR" })]));
    expect(batch.movements).toEqual([]);
    expect(batch.unsupported).toEqual([
      { sourceEventId: "ER-2", bookingDate: "2026-10-05", reason: "Vorgemerkt (PDNG); folgt, sobald die Bank ihn bucht." },
      { sourceEventId: "ER-3", bookingDate: "2026-10-05", reason: "Status OTHR." },
    ]);
  });

  it("zeigt stornierte und abgelehnte Umsätze (CNCL, RJCT) ohne Tag und hält den Zeitraum nicht offen", () => {
    const result = validateBatch(
      enableBankingBatch(
        input([tx(), tx({ entry_reference: "ER-C", status: "CNCL", booking_date: "2026-10-20" }), tx({ entry_reference: "ER-R", status: "RJCT" })]),
      ),
      binding,
    );
    expect(result.ok && [result.batch.unsupported, result.blocking, result.openFrom]).toEqual([
      [
        { sourceEventId: "ER-C", reason: "Storniert (CNCL); wird nie gebucht.", final: true },
        { sourceEventId: "ER-R", reason: "Abgelehnt (RJCT); wird nie gebucht.", final: true },
      ],
      0,
      undefined,
    ]);
  });

  it("legt einen Umsatz ohne gültiges Datum oder Betrag nicht an", () => {
    const batch = enableBankingBatch(input([tx({ booking_date: null, value_date: null, transaction_date: null })]));
    expect(batch.unsupported).toEqual([{ sourceEventId: "ER-1", reason: "Ohne gültiges Datum oder Betrag." }]);
  });

  it("übernimmt einen Umsatz vor dem Fenster, ohne das Fenster zu verbreitern", () => {
    const result = validateBatch(enableBankingBatch(input([tx({ booking_date: "2026-09-29", value_date: "2026-10-02" })])), binding);
    expect(result.ok && [result.accepted.map((m) => m.bookingDate), result.batch.coverage, result.blocking]).toEqual([
      ["2026-09-29"],
      { from: "2026-10-01", to: "2026-10-31" },
      0,
    ]);
  });

  it("verwendet eine mehrfach gelieferte entry_reference auch bei gleichem Inhalt nicht als Identität", () => {
    const result = validateBatch(enableBankingBatch(input([tx(), tx()])), binding);
    expect(result.ok).toBe(true);
    expect(result.ok && result.accepted.map((m) => m.sourceEventId)).not.toContain("ER-1");
  });

  it("lässt eine Lieferung mit derselben entry_reference und verschiedenem Betrag zur Inhaltsprüfung zu", () => {
    const result = validateBatch(enableBankingBatch(input([tx(), tx({ transaction_amount: { currency: "EUR", amount: "5.00" } })])), binding);
    expect(result.ok).toBe(true);
    expect(result.ok && result.accepted.map((m) => m.sourceEventId)).not.toContain("ER-1");
  });

  it("zählt einen gebuchten Umsatz nach dem Fenster bei der Eindeutigkeit der Bankreferenz mit", () => {
    const result = validateBatch(enableBankingBatch(input([tx(), tx({ booking_date: "2026-11-03" })])), binding);
    expect(result.ok).toBe(true);
    expect(result.ok && result.accepted.map((m) => m.sourceEventId)).not.toContain("ER-1");
    expect(result.ok && result.accepted.map((m) => m.bookingDate)).toEqual(["2026-10-05"]);
  });

  it("übernimmt die Art des Umsatzes der Bank als Ereigniscode", () => {
    const batch = enableBankingBatch(input([tx({ bank_transaction_code: { description: "Lastschrift" } })]));
    expect(batch.movements[0]?.references).toEqual({ providerReference: "ER-1", eventCode: "Lastschrift" });
  });

  it("behält zwei gleichartige Umsätze mit verschiedenen entry_reference", () => {
    const result = validateBatch(enableBankingBatch(input([tx(), tx({ entry_reference: "ER-2" })])), binding);
    expect(result.ok && result.accepted.map((m) => m.sourceEventId)).toEqual(["ER-1", "ER-2"]);
  });

  it("lässt fehlende Gegenpartei und Verwendungszweck leer, statt sie zu erfinden", () => {
    const batch = enableBankingBatch(input([tx({ creditor: null, creditor_account: null, remittance_information: null })]));
    expect(batch.movements[0]).not.toHaveProperty("counterpartyName");
    expect(batch.movements[0]).not.toHaveProperty("counterpartyIban");
    expect(batch.movements[0]!.purpose).toBe("");
  });

  it("übernimmt keinen verfügbaren Saldo", () => {
    const batch = enableBankingBatch(input([tx()], { balances: [{ balance_amount: { currency: "EUR", amount: "10.00" }, balance_type: "ITAV" }] }));
    expect(batch.balances).toEqual([]);
  });

  it("lässt einen Saldo mit einem Tag, den es nicht gibt, weg, statt die Lieferung abzulehnen", () => {
    const balances = [{ balance_amount: { currency: "EUR", amount: "1.00" }, balance_type: "CLBD", reference_date: "2026-02-30" }];
    const result = validateBatch(enableBankingBatch(input([tx()], { balances })), binding);
    expect(result.ok && result.balances).toEqual([]);
  });

  it("nimmt einen Umsatz nach dem Fenster nicht an, ohne den Zeitraum offenzuhalten", () => {
    const result = validateBatch(enableBankingBatch(input([tx({ booking_date: "2026-11-02", value_date: null })])), binding);
    expect(result.ok && [result.accepted, result.batch.unsupported, result.blocking]).toEqual([
      [],
      [{ sourceEventId: "ER-1", bookingDate: "2026-11-02", reason: "Buchungstag 2026-11-02 nach dem abgerufenen Fenster bis 2026-10-31." }],
      0,
    ]);
  });

  it("übernimmt einen gebuchten Saldo ohne Stichtag nicht", () => {
    const batch = enableBankingBatch(input([tx()], { balances: [{ balance_amount: { currency: "EUR", amount: "10.00" }, balance_type: "CLBD" }] }));
    expect(batch.balances).toEqual([]);
  });
});
