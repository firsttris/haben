import { describe, expect, it } from "vitest";
import { findDuplicateCandidates } from "./duplicate-candidates.ts";

type Row = Parameters<typeof findDuplicateCandidates>[0][number];
const row = (id: string, purpose: string, over: Partial<Row> = {}): Row => ({
  id,
  purpose,
  accountId: "konto",
  bookingDate: "2026-09-12",
  amount: -4999,
  currency: "EUR",
  fetchIds: new Set([`abruf-${id}`]),
  stableReference: false,
  ...over,
});

describe("Verdacht auf doppelte Bankumsätze (#865)", () => {
  it("erkennt das anonymisierte Leerraum- und Schlusszeichenpaar ohne Gegen-IBAN", () => {
    const vorher = row("alt", "MUSTER PAYMENTS AMZN Mk tp DE REF KUNDENREFERENZ TEIL1 TEIL2 MANDATSREFERENZ MANDAT0");
    const nachher = row("neu", "muster payments amzn Mktp DE REF K UNDENREFERENZ TEIL1 TE IL2 MANDATSREFERENZ MANDAT", { counterpartyIban: "" });
    expect(findDuplicateCandidates([vorher, nachher], new Set(["neu"]))).toEqual([{ transactionId: "neu", originalTransactionId: "alt" }]);
  });

  it("vergleicht nur Richtung, Betrag, Währung, Buchungstag und Gegen-IBAN desselben Kontos", () => {
    const vorher = row("alt", "Rechnung", { counterpartyIban: "DE89 3704 0044 0532 0130 00" });
    expect(findDuplicateCandidates([vorher, row("neu", "Rechnung", { counterpartyIban: "de89370400440532013000" })])).toHaveLength(1);
    for (const over of [{ accountId: "anderes" }, { bookingDate: "2026-09-13" }, { amount: 4999 }, { counterpartyIban: "DE1" }, { currency: "USD" }]) {
      expect(findDuplicateCandidates([vorher, row("neu", "Rechnung", { counterpartyIban: vorher.counterpartyIban, ...over })])).toEqual([]);
    }
  });

  it("meldet keine gemeinsam abgerufene oder stabil referenzierte Zahlung als Dublette", () => {
    const vorher = row("alt", "Rechnung", { fetchIds: new Set(["erster", "nochmal"]) });
    expect(findDuplicateCandidates([vorher, row("neu", "Rechnung", { fetchIds: new Set(["nochmal"]) })])).toEqual([]);
    expect(findDuplicateCandidates([vorher, row("neu", "Rechnung", { stableReference: true })])).toEqual([]);
    expect(findDuplicateCandidates([vorher, row("neu", "Rechnung")], new Set())).toEqual([]);
  });

  it.each([
    ["ABCDEF", "ABXYEF", true],
    ["ABCDEF", "ABXYZEF", false],
    ["ABCDEF", "ABCD", true],
    ["ABCDEF", "ABC", false],
    ["ABCDEF", "ABXYCDEF", true],
    ["ABCDEF", "ABXYZCDEF", false],
  ])("prüft bis zu zwei Änderungen: %s / %s", (left, right, expected) => {
    expect(findDuplicateCandidates([row("alt", left), row("neu", right)]).length > 0).toBe(expected);
  });
});
