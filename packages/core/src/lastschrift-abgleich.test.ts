import { describe, expect, it } from "vitest";
import { findDirectDebitBatch, findDirectDebitReturn, returnReason, type CollectedDirectDebit } from "./lastschrift-abgleich.ts";

const item = (overrides: Partial<CollectedDirectDebit> = {}): CollectedDirectDebit => ({
  id: "i1",
  invoiceId: "r1",
  invoiceNumber: "2026-041",
  paymentInfoId: "HABEN-AAAA-1",
  endToEndId: "HABEN-AAAA000011112222",
  mandateReference: "KD-1042-01",
  collectionDate: "2026-11-16",
  amount: 29_750,
  debtorIban: "DE02120300000000202051",
  state: "eingereicht",
  ...overrides,
});

const tx = (overrides: Record<string, unknown> = {}) => ({
  amount: 41_650,
  bookingDate: "2026-11-16",
  purpose: "SEPA-Lastschrift Sammler HABEN-AAAA-1",
  bankReference: null,
  endToEndId: null,
  counterpartyIban: null,
  ...overrides,
});

describe("Sammelgutschrift", () => {
  const items = [item(), item({ id: "i2", invoiceId: "r2", invoiceNumber: "2026-042", endToEndId: "HABEN-BBBB", amount: 11_900 })];

  it("findet den Sammler, dessen offene Lastschriften zusammen den Betrag ergeben", () => {
    expect(findDirectDebitBatch(tx(), items)?.map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  it("nicht bei anderem Betrag, vor dem Einzugstag oder bei schon zugeordneten Lastschriften", () => {
    expect(findDirectDebitBatch(tx({ amount: 41_649 }), items)).toBeNull();
    expect(findDirectDebitBatch(tx({ bookingDate: "2026-11-12" }), items)).toBeNull();
    expect(findDirectDebitBatch(tx({ amount: 11_900 }), [items[0]!, { ...items[1]!, state: "gutgeschrieben" }])).toBeNull();
  });

  it("eine einzelne Lastschrift ist kein Sammler (die findet der normale Vorschlag)", () => {
    expect(findDirectDebitBatch(tx({ amount: 29_750 }), [item()])).toBeNull();
  });

  it("Sammler mit gleichem Einzugstag aus einer Datei, die die Bank zusammen gutschreibt", () => {
    const frst = item({ paymentInfoId: "HABEN-AAAA-1" });
    const rcur = item({ id: "i2", invoiceId: "r2", paymentInfoId: "HABEN-AAAA-2", endToEndId: "HABEN-BBBB", amount: 11_900 });
    const andererTag = item({
      id: "i3",
      invoiceId: "r3",
      paymentInfoId: "HABEN-AAAA-3",
      endToEndId: "HABEN-CCCC",
      amount: 5_000,
      collectionDate: "2026-11-20",
    });
    expect(findDirectDebitBatch(tx(), [frst, rcur, andererTag])?.map((i) => i.id)).toEqual(["i1", "i2"]);
  });
});

describe("Rücklastschrift", () => {
  const items = [item({ state: "gutgeschrieben" })];

  it("erkennt die Rückgabe an der EndToEndId, mit Gebühr", () => {
    expect(findDirectDebitReturn(tx({ amount: -30_050, endToEndId: "HABEN-AAAA000011112222", purpose: "RETURN AM04" }), items)).toEqual({
      item: items[0],
      fee: 300,
      reason: { code: "AM04", text: "Rückgabe mangels Deckung" },
    });
  });

  it("erkennt sie am Text mit Mandatsreferenz oder Rechnungsnummer", () => {
    const result = findDirectDebitReturn(tx({ amount: -29_750, purpose: "RUECKLASTSCHRIFT MD01 KD-1042-01 Rechnung 2026-041" }), items);
    expect(result).toMatchObject({ fee: 0, reason: { code: "MD01", text: "Kein gültiges Mandat" } });
    expect(findDirectDebitReturn(tx({ amount: -29_750, purpose: "Rücklastschrift Rechnung 2026-041" }), items)?.item.id).toBe("i1");
  });

  it("nicht ohne Bezug, nicht bei kleinerem Betrag, nicht bei Eingängen und nicht vor der Gutschrift", () => {
    expect(findDirectDebitReturn(tx({ amount: -29_750, purpose: "Rücklastschrift" }), items)).toBeNull();
    expect(findDirectDebitReturn(tx({ amount: -20_000, endToEndId: "HABEN-AAAA000011112222" }), items)).toBeNull();
    expect(findDirectDebitReturn(tx({ amount: 29_750, endToEndId: "HABEN-AAAA000011112222" }), items)).toBeNull();
    expect(findDirectDebitReturn(tx({ amount: -29_750, endToEndId: "HABEN-AAAA000011112222" }), [item()])).toBeNull();
  });

  it("Gründe nach EPC173-14 und Anlage 3 der DK, unbekannte nur mit Code", () => {
    expect(returnReason("RETURN MS02 Widerspruch")).toEqual({ code: "MS02", text: "Rückgabe durch den Zahler" });
    expect(returnReason("REJECT AC04 Konto aufgeloest")).toEqual({ code: "AC04", text: "Konto aufgelöst" });
    expect(returnReason("RUECKLASTSCHRIFT MD06")).toEqual({ code: "MD06", text: "Erstattung auf Verlangen des Zahlers" });
    expect(returnReason("RETURN BE05")).toEqual({ code: "BE05", text: null });
    expect(returnReason("Rücklastschrift")).toBeNull();
    // Der Anfang einer IBAN ist kein Grund
    expect(returnReason("Rücklastschrift DE02 1203 0000 0000 2020 51")).toBeNull();
  });
});

describe("Review #481", () => {
  it("ordnet eine Rücklastschrift nur mit Mandatsreferenz nicht der ersten Lastschrift desselben Mandats zu", () => {
    // Zwei Monatsrechnungen auf dasselbe Mandat; zurück kommt die zweite (297,50 € + 3,00 € Entgelt), im Text nur die
    // Mandatsreferenz. Die erste (119,00 €) passt auch dem Betrag nach (Rest wäre ein „Entgelt“ von 181,50 €).
    const items = [
      item({ id: "i1", invoiceId: "r1", invoiceNumber: "2026-041", endToEndId: "HABEN-AAAA", amount: 11_900, state: "gutgeschrieben" }),
      item({ id: "i2", invoiceId: "r2", invoiceNumber: "2026-042", endToEndId: "HABEN-BBBB", amount: 29_750, state: "gutgeschrieben" }),
    ];
    const found = findDirectDebitReturn(tx({ amount: -30_050, purpose: "RUECKLASTSCHRIFT MREF KD-1042-01" }), items);
    expect(found?.item.id).not.toBe("i1");
  });

  it("erkennt die Rückgabegründe für SDD aus EPC173-14 (AC13, CNOR, DNOR, ED05)", () => {
    for (const code of ["AC13", "CNOR", "DNOR", "ED05"]) expect(returnReason(`RETURN ${code}`)?.code).toBe(code);
  });
});
