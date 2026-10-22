import { describe, expect, it } from "vitest";
import { findTransferCounterpart, suggestDirectBooking, type OwnAccount } from "./matching.ts";

const business: OwnAccount = { id: "g", name: "Geschäftskonto", iban: "DE02100100100006820101", purpose: "geschaeft" };
const tax: OwnAccount = { id: "s", name: "Steuerkonto", iban: "DE12120300001234567890", purpose: "steuer" };
const savings: OwnAccount = { id: "r", name: "Rücklagen", iban: "DE89370400440532013000", purpose: "ruecklage" };
const personal: OwnAccount = { id: "p", name: "Privat", iban: "DE75512108001245126199", purpose: "privat" };
const all = [business, tax, savings, personal];

const tx = (over: Partial<{ amount: number; counterpartyName: string; counterpartyIban: string | null; purpose: string }>) => ({
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
    expect(suggestDirectBooking(tx({ counterpartyName: "Finanzamt Regensburg", purpose: "USt 09.26 StNr 244/123/45678" }), tax, all)).toEqual({
      kind: "ustVorauszahlung",
      reasons: ["Lastschrift des Finanzamts auf dem Steuerkonto"],
    });
    expect(
      suggestDirectBooking(tx({ amount: 12_000, counterpartyName: "Landeshauptkasse Bayern", purpose: "Erstattung Umsatzsteuer 08/2026" }), tax, all)?.reasons,
    ).toEqual(["Erstattung des Finanzamts auf das Steuerkonto"]);
  });

  it("Einkommensteuer oder unklarer Zweck auf dem Steuerkonto: kein Umsatzsteuer-Vorschlag", () => {
    expect(suggestDirectBooking(tx({ counterpartyName: "Finanzamt Regensburg", purpose: "ESt-Vorauszahlung III/2026 StNr 244/123/45678" }), tax, all)).toBeNull();
    expect(suggestDirectBooking(tx({ counterpartyName: "Finanzamt Regensburg", purpose: "USt und ESt 2025" }), tax, all)).toBeNull();
    expect(suggestDirectBooking(tx({ counterpartyName: "Finanzamt Regensburg", purpose: "StNr 244/123/45678" }), tax, all)).toBeNull();
  });

  it("Finanzamt auf dem Geschäftskonto bleibt ohne Vorschlag (kann auch Einkommensteuer sein)", () => {
    expect(suggestDirectBooking(tx({ counterpartyName: "Finanzamt Regensburg", purpose: "USt 09.26" }), business, all)).toBeNull();
  });

  it("die eigene IBAN des Kontos selbst zählt nicht als Gegenkonto", () => {
    expect(suggestDirectBooking(tx({ counterpartyIban: business.iban }), business, all)).toBeNull();
  });
});

describe("findTransferCounterpart", () => {
  const source = "DE02 1001 0010 0006 8201 01";
  const candidates = [
    { id: "a", bookingDate: "2026-10-05", amount: 60_000, open: 60_000, counterpartyIban: "DE02100100100006820101" },
    { id: "b", bookingDate: "2026-10-02", amount: 60_000, open: 60_000, counterpartyIban: "DE02100100100006820101" },
    { id: "c", bookingDate: "2026-10-01", amount: 60_000, open: 0, counterpartyIban: "DE02100100100006820101" },
    { id: "d", bookingDate: "2026-10-01", amount: 59_999, open: 59_999, counterpartyIban: "DE02100100100006820101" },
    // Erstattung des Finanzamts über denselben Betrag am selben Tag: kein Geldtransit
    { id: "e", bookingDate: "2026-10-01", amount: 60_000, open: 60_000, counterpartyIban: "DE76750000000075001007" },
    { id: "f", bookingDate: "2026-10-01", amount: 60_000, open: 60_000, counterpartyIban: null },
  ];

  it("nimmt die zeitlich nächste ganz offene Gegenbuchung, deren Gegenkonto das Ausgangskonto ist", () => {
    expect(findTransferCounterpart({ bookingDate: "2026-10-01", amount: -60_000 }, source, candidates)?.id).toBe("b");
  });

  it("ohne Treffer mit IBAN eine Gegenbuchung ohne Gegen-IBAN, nie eine fremde Zahlung", () => {
    expect(findTransferCounterpart({ bookingDate: "2026-10-01", amount: -60_000 }, source, candidates.filter((c) => c.id === "e" || c.id === "f"))?.id).toBe("f");
    expect(findTransferCounterpart({ bookingDate: "2026-10-01", amount: -60_000 }, source, candidates.filter((c) => c.id === "e"))).toBeNull();
  });

  it("nichts innerhalb von fünf Tagen: kein Treffer", () => {
    expect(findTransferCounterpart({ bookingDate: "2026-10-20", amount: -60_000 }, source, candidates)).toBeNull();
  });
});
