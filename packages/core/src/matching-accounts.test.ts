import { describe, expect, it } from "vitest";
import { findTransferCounterpart, suggestDirectBooking, type OwnAccount } from "./matching.ts";

const business: OwnAccount = { id: "g", name: "Geschäftskonto", iban: "DE02100100100006820101", purpose: "geschaeft" };
const tax: OwnAccount = { id: "s", name: "Steuerkonto", iban: "DE12120300001234567890", purpose: "steuer" };
const savings: OwnAccount = { id: "r", name: "Rücklagen", iban: "DE89370400440532013000", purpose: "ruecklage" };
const personal: OwnAccount = { id: "p", name: "Privat", iban: "DE75512108001245126199", purpose: "privat" };
const all = [business, tax, savings, personal];

const tx = (over: Partial<{ amount: number; counterpartyName: string; counterpartyIban: string | null }>) => ({
  bookingDate: "2026-10-01",
  amount: -60_000,
  counterpartyName: "",
  counterpartyIban: null,
  purpose: "",
  ...over,
});

describe("suggestDirectBooking", () => {
  it("Überweisung auf ein eigenes Konto ist Geldtransit, auch mit Leerzeichen in der IBAN", () => {
    expect(suggestDirectBooking(tx({ counterpartyIban: "DE12 1203 0000 1234 5678 90" }), business, all)).toEqual({
      kind: "geldtransit",
      reasons: ["Gegenkonto ist dein Konto Steuerkonto"],
      counterAccountId: "s",
    });
    expect(suggestDirectBooking(tx({ amount: 100_000, counterpartyIban: business.iban }), savings, all)?.kind).toBe("geldtransit");
  });

  it("Überweisung auf das Privatkonto ist Privatentnahme, nicht Geldtransit", () => {
    expect(suggestDirectBooking(tx({ counterpartyIban: personal.iban }), business, all)).toEqual({
      kind: "privat",
      reasons: ["Gegenkonto ist dein Privatkonto Privat"],
    });
  });

  it("Finanzamt auf dem Steuerkonto: Lastschrift und Erstattung als Umsatzsteuer", () => {
    expect(suggestDirectBooking(tx({ counterpartyName: "Finanzamt Regensburg" }), tax, all)).toEqual({
      kind: "ustVorauszahlung",
      reasons: ["Lastschrift des Finanzamts auf dem Steuerkonto"],
    });
    expect(suggestDirectBooking(tx({ amount: 12_000, counterpartyName: "Landeshauptkasse Bayern" }), tax, all)?.reasons).toEqual([
      "Erstattung des Finanzamts auf das Steuerkonto",
    ]);
  });

  it("Finanzamt auf dem Geschäftskonto bleibt ohne Vorschlag (kann auch Einkommensteuer sein)", () => {
    expect(suggestDirectBooking(tx({ counterpartyName: "Finanzamt Regensburg" }), business, all)).toBeNull();
  });

  it("die eigene IBAN des Kontos selbst zählt nicht als Gegenkonto", () => {
    expect(suggestDirectBooking(tx({ counterpartyIban: business.iban }), business, all)).toBeNull();
  });
});

describe("findTransferCounterpart", () => {
  const candidates = [
    { id: "a", bookingDate: "2026-10-09", amount: 60_000, open: 60_000 },
    { id: "b", bookingDate: "2026-10-02", amount: 60_000, open: 60_000 },
    { id: "c", bookingDate: "2026-10-01", amount: 60_000, open: 0 },
    { id: "d", bookingDate: "2026-10-01", amount: 59_999, open: 59_999 },
  ];

  it("nimmt die zeitlich nächste ganz offene Gegenbuchung mit gleichem Betrag", () => {
    expect(findTransferCounterpart({ bookingDate: "2026-10-01", amount: -60_000 }, candidates)?.id).toBe("b");
  });

  it("nichts innerhalb von fünf Tagen: kein Treffer", () => {
    expect(findTransferCounterpart({ bookingDate: "2026-10-20", amount: -60_000 }, candidates)).toBeNull();
  });
});
