import { describe, expect, it } from "vitest";
import { classifyMovements, knownMovement, movementKey, validateBatch } from "../importvertrag/index.ts";
import type { VividTransaction } from "./client.ts";
import { vividAbruf, vividIban, vividTag } from "./batch.ts";

const account = {
  id: "8c1d2f3e-0000-4000-8000-000000000001",
  name: "Hauptkonto",
  currency: "EUR",
  state: "active",
  account_details: [
    { iban: "DE02 1001 1001 2620 9876 54", bic: "NTSBDEB1XXX", type: "international" },
    { iban: "DE89370400440532013000", bic: null, type: "local" },
  ],
};

const tx = (over: Partial<VividTransaction> = {}): VividTransaction => ({
  id: "0f8e0000-0000-4000-8000-0000000000a1",
  account_id: account.id,
  type: "card_payment",
  state: "completed",
  amount: "-12.50",
  currency: "EUR",
  original_amount: null,
  original_currency: null,
  show_at: "2026-11-10T09:15:00Z",
  created_at: "2026-11-10T09:15:02Z",
  updated_at: "2026-11-12T03:00:00Z",
  merchant: { name: "Kaffee Beispiel", city: "Leipzig", country: "DE" },
  card: { last_4: "4242" },
  ...over,
});

const input = (transactions: VividTransaction[], over: Partial<Parameters<typeof vividAbruf>[0]> = {}) => ({
  account,
  transactions,
  dateFrom: "2026-11-01",
  dateTo: "2026-11-18",
  fetchedAt: "2026-11-18T06:00:00+01:00",
  fetchId: "abruf-1",
  ...over,
});

const binding = { provider: "vivid", externalAccountId: account.id, accountKind: "bank" as const };

describe("vividAbruf", () => {
  it("übersetzt einen abgeschlossenen Umsatz in eine Bewegung und einen Umsatz des Auszugs", () => {
    const { batch, statement } = vividAbruf(input([tx()]));
    const result = validateBatch(batch, binding);
    expect(result.ok && result.accepted).toEqual([
      {
        sourceEventId: "0f8e0000-0000-4000-8000-0000000000a1",
        component: "main",
        kind: "payment",
        bookingDate: "2026-11-10",
        sourceTimestamp: "2026-11-10T09:15:00Z",
        amount: -1250,
        currency: "EUR",
        counterpartyName: "Kaffee Beispiel",
        purpose: "Kartenzahlung, Karte …4242, Leipzig, DE",
        references: { providerReference: "0f8e0000-0000-4000-8000-0000000000a1", eventCode: "card_payment" },
      },
    ]);
    expect(result.ok && [result.balances, result.blocking]).toEqual([[], 0]);
    expect(statement).toMatchObject({
      format: "vivid",
      accountIban: "DE89370400440532013000",
      accountName: "Hauptkonto",
      periodFrom: "2026-11-01",
      periodTo: "2026-11-18",
      warnings: [],
    });
    expect(statement.transactions).toEqual([
      {
        bookingDate: "2026-11-10",
        amount: -1250,
        currency: "EUR",
        counterpartyName: "Kaffee Beispiel",
        purpose: "Kartenzahlung, Karte …4242, Leipzig, DE",
        type: "Kartenzahlung",
        bankReference: "0f8e0000-0000-4000-8000-0000000000a1",
        index: 0,
      },
    ]);
    expect(statement).not.toHaveProperty("closingBalance");
  });

  it("nimmt den Tag in Deutschland: kurz vor Mitternacht UTC ist dort schon der nächste Tag", () => {
    expect(vividTag(tx({ show_at: "2026-11-10T23:30:00Z" }))).toBe("2026-11-11");
    expect(vividTag(tx({ show_at: null, created_at: "2026-07-31T22:10:00Z" }))).toBe("2026-08-01");
    expect(vividTag(tx({ show_at: "kaputt" }))).toBeUndefined();
  });

  it("hält eine Vormerkung mit ihrem Tag offen und übernimmt sie nach der Buchung ohne Dublette", () => {
    const vorher = vividAbruf(input([tx({ state: "pending", amount: "-12.00" })]));
    const offen = validateBatch(vorher.batch, binding);
    expect(offen.ok && [offen.accepted, offen.batch.unsupported, offen.blocking, offen.openFrom]).toEqual([
      [],
      [{ sourceEventId: "0f8e0000-0000-4000-8000-0000000000a1", bookingDate: "2026-11-10", reason: "Vorgemerkt (pending); folgt, sobald Vivid ihn bucht." }],
      1,
      "2026-11-10",
    ]);
    expect(vorher.statement.warnings).toEqual(["1 vorgemerkte Umsätze folgen, sobald Vivid sie bucht."]);
    // Gebucht mit anderem Betrag (Trinkgeld): dieselbe id, eine Bewegung
    const gebucht = validateBatch(vividAbruf(input([tx({ amount: "-12.50" })], { fetchId: "abruf-2" })).batch, binding);
    expect(gebucht.ok && gebucht.accepted.map((m) => [m.sourceEventId, m.amount])).toEqual([["0f8e0000-0000-4000-8000-0000000000a1", -1250]]);
    const known = new Map(gebucht.ok ? gebucht.accepted.map((m) => [movementKey(binding, m), knownMovement(m)]) : []);
    const wieder = validateBatch(vividAbruf(input([tx()], { fetchId: "abruf-3" })).batch, binding);
    expect(wieder.ok && classifyMovements(known, binding, wieder.accepted).results.map((r) => r.outcome)).toEqual(["known"]);
  });

  it("zeigt abgelehnte Umsätze, ohne den Zeitraum offenzuhalten, und unbekannte Status mit Tag", () => {
    const result = validateBatch(vividAbruf(input([tx({ id: "d", state: "declined", amount: "0.00" }), tx({ id: "u", state: "reversed" })])).batch, binding);
    expect(result.ok && [result.batch.unsupported, result.blocking]).toEqual([
      [
        { sourceEventId: "d", reason: "Abgelehnt (declined); wird nie gebucht.", final: true },
        { sourceEventId: "u", bookingDate: "2026-11-10", reason: "Status reversed." },
      ],
      1,
    ]);
  });

  it("lässt Umsätze vor dem Fenster weg und hält einen nach dem Fenster nicht fest", () => {
    const { batch, statement } = vividAbruf(
      input([tx({ id: "vor", show_at: "2026-10-31T10:00:00Z" }), tx({ id: "nach", show_at: "2026-11-18T23:30:00Z" }), tx({ id: "drin" })]),
    );
    expect(batch.movements.map((m) => m.sourceEventId)).toEqual(["drin"]);
    expect(batch.unsupported).toEqual([
      { sourceEventId: "nach", bookingDate: "2026-11-19", reason: "Tag 2026-11-19 nach dem abgerufenen Fenster bis 2026-11-18." },
    ]);
    expect(statement.transactions.map((t) => t.bankReference)).toEqual(["drin"]);
    expect(validateBatch(batch, binding).ok && validateBatch(batch, binding)).toMatchObject({ blocking: 0 });
  });

  it("ordnet Erstattung und Gebühr als eigene Arten ein und nennt Überweisungen ohne erfundene Gegenseite", () => {
    const { batch } = vividAbruf(
      input([
        tx({ id: "r", type: "card_refund", amount: "12.50" }),
        tx({ id: "f", type: "fee", amount: "-1.00", merchant: null, card: null }),
        tx({ id: "t", type: "transfer", amount: "500.00", merchant: null, card: null }),
      ]),
    );
    expect(batch.movements.map((m) => [m.sourceEventId, m.kind, m.amount, m.counterpartyName, m.purpose])).toEqual([
      ["r", "refund", 1250, "Kaffee Beispiel", "Kartenerstattung, Karte …4242, Leipzig, DE"],
      ["f", "fee", -100, undefined, "Gebühr"],
      ["t", "payment", 50000, undefined, "Überweisung"],
    ]);
  });

  it("nennt den Betrag in der Währung der Zahlung im Verwendungszweck", () => {
    const { batch } = vividAbruf(input([tx({ amount: "-9.27", original_amount: "-10.00", original_currency: "USD" })]));
    expect(batch.movements[0]!.purpose).toBe("Kartenzahlung, Karte …4242, Leipzig, DE, -10.00 USD");
  });

  it("nimmt eine id, die auf zwei Seiten steht, einmal und sortiert den Auszug nach Tag", () => {
    const neu = tx({ id: "b", show_at: "2026-11-12T10:00:00Z", created_at: "2026-11-12T10:00:00Z" });
    const alt = tx({ id: "a", show_at: "2026-11-02T10:00:00Z", created_at: "2026-11-02T10:00:00Z" });
    const { batch, statement } = vividAbruf(input([neu, alt, alt]));
    expect(batch.movements.map((m) => m.sourceEventId)).toEqual(["b", "a"]);
    expect(statement.transactions.map((t) => [t.bankReference, t.index])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("lehnt einen Umsatz ohne gültigen Betrag ab, ohne die Lieferung zu verwerfen", () => {
    const { batch } = vividAbruf(input([tx({ amount: "zwölf" }), tx({ id: "ok" })]));
    expect(batch.movements.map((m) => m.sourceEventId)).toEqual(["ok"]);
    expect(batch.unsupported).toEqual([
      { sourceEventId: "0f8e0000-0000-4000-8000-0000000000a1", bookingDate: "2026-11-10", reason: "Ohne gültigen Zeitpunkt oder Betrag." },
    ]);
  });
});

describe("vividIban", () => {
  it("nimmt die IBAN für das Inland zuerst und lässt ein Konto ohne IBAN leer", () => {
    expect(vividIban(account)).toBe("DE89370400440532013000");
    expect(vividIban({ ...account, account_details: [account.account_details[0]!] })).toBe("DE02100110012620987654");
    expect(vividIban({ ...account, account_details: [] })).toBeUndefined();
  });
});
