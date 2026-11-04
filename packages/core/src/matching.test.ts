import { describe, expect, it } from "vitest";
import { purposeContainsNumber, suggestMatches, transactionHasReference, type OpenItem } from "./matching.ts";

const invoice = (over: Partial<OpenItem> = {}): OpenItem => ({
  type: "invoice",
  id: "r31",
  number: "2026-031",
  date: "2026-09-05",
  dueDate: "2026-09-19",
  open: 476_000,
  partyName: "Nordwerk Software GmbH",
  partyIbans: ["DE89370400440532013000"],
  ...over,
});

const tx = {
  bookingDate: "2026-10-01",
  amount: 476_000,
  counterpartyName: "NORDWERK SOFTWARE GMBH",
  counterpartyIban: "DE89 3704 0044 0532 0130 00",
  purpose: "RE 2026 031 Leistungen August",
};

describe("suggestMatches", () => {
  it("bester Treffer mit allen Begründungen", () => {
    const [best] = suggestMatches(tx, [invoice(), invoice({ id: "r32", number: "2026-032", open: 595_000, partyIbans: [] })]);
    expect(best?.item.id).toBe("r31");
    expect(best?.reasons).toEqual(["Betrag stimmt exakt", "Rechnungsnummer im Verwendungszweck", "IBAN bekannt vom Kontakt", "Name passt"]);
    expect(best?.amount).toBe(476_000);
  });

  it("Teilzahlung mit Rechnungsnummer", () => {
    const [best] = suggestMatches({ ...tx, amount: 200_000, counterpartyIban: null }, [invoice()]);
    expect(best?.reasons).toContain("Teilbetrag des offenen Betrags");
    expect(best?.amount).toBe(200_000);
  });

  it("nur gleiche Richtung: Ausgang passt nicht auf Forderung", () => {
    expect(suggestMatches({ ...tx, amount: -476_000 }, [invoice()])).toEqual([]);
  });

  it("Beleg über Betrag und Datum", () => {
    const doc: OpenItem = {
      type: "document",
      id: "b1",
      number: "R0018834512",
      date: "2026-09-28",
      open: -3_856,
      partyName: "Hetzner Online GmbH",
      partyIbans: [],
    };
    const [best] = suggestMatches(
      { bookingDate: "2026-09-30", amount: -3_856, counterpartyName: "Hetzner Online GmbH", purpose: "Rechnung R0018834512 Server" },
      [doc],
    );
    expect(best?.reasons).toEqual(["Betrag stimmt exakt", "Rechnungsnummer im Verwendungszweck", "Name passt", "Datum passt (± 5 Tage)"]);
  });

  describe("Überweisung aus Haben (SEPA-Datei)", () => {
    const doc = (over: Partial<OpenItem> = {}): OpenItem => ({
      type: "document",
      id: "b2",
      number: "RE-0815",
      date: "2026-08-01",
      open: -11_900,
      partyName: "Büro Müller",
      partyIbans: ["DE02120300000000202051"],
      references: ["HABEN-0A1B2C3D4E5F6071"],
      ...over,
    });
    const debit = { bookingDate: "2026-11-06", amount: -11_662, counterpartyName: "Buero Mueller", counterpartyIban: null, purpose: "Sammler" };

    it("findet den Beleg an der EndToEndId, auch mit Skonto abgezogen und ohne Rechnungsnummer", () => {
      const [best] = suggestMatches({ ...debit, endToEndId: "HABEN-0A1B2C3D4E5F6071" }, [doc(), doc({ id: "b3", references: [] })]);
      expect(best?.item.id).toBe("b2");
      expect(best?.reasons).toEqual(["Teilbetrag des offenen Betrags", "Überweisung aus Haben (HABEN-0A1B2C3D4E5F6071)"]);
      expect(best?.amount).toBe(-11_662);
    });

    it("liest die Referenz auch aus Kundenreferenz und Verwendungszweck", () => {
      expect(transactionHasReference({ purpose: "", bankReference: "haben-0a1b2c3d4e5f6071" }, "HABEN-0A1B2C3D4E5F6071")).toBe(true);
      expect(transactionHasReference({ purpose: "RE-0815 EREF: HABEN 0A1B2C3D4E5F6071 SVWZ" }, "HABEN-0A1B2C3D4E5F6071")).toBe(true);
      expect(transactionHasReference({ purpose: "RE-0815" }, "HABEN-0A1B2C3D4E5F6071")).toBe(false);
      // Zu kurze Referenzen träfen zufällig
      expect(transactionHasReference({ purpose: "abc" }, "ABC")).toBe(false);
    });

    it("die IBAN des Lieferanten zählt auch bei Belegen", () => {
      const [best] = suggestMatches({ ...debit, amount: -11_900, counterpartyIban: "DE02 1203 0000 0000 2020 51" }, [doc({ references: [] })]);
      expect(best?.reasons).toEqual(["Betrag stimmt exakt", "IBAN des Lieferanten"]);
    });
  });

  it("schwache Treffer fallen weg", () => {
    expect(suggestMatches({ ...tx, amount: 1_000, purpose: "x", counterpartyIban: null, counterpartyName: "Fremd" }, [invoice()])).toEqual([]);
  });

  it("Rechnungsnummer ohne Trennzeichen", () => {
    expect(purposeContainsNumber("Rg.Nr. 2026031 vielen Dank", "2026-031")).toBe(true);
    expect(purposeContainsNumber("Abschlag 12", "12")).toBe(false);
  });
});

describe("suggestMatches mit Fremdwährung", () => {
  it("schlägt eine Fremdwährungsrechnung vor, wenn die Zahlung nur um die Kursdifferenz abweicht", () => {
    const item = {
      type: "invoice" as const,
      id: "r1",
      number: "RE-2026-0042",
      date: "2026-09-01",
      open: 9249,
      partyName: "Acme Inc.",
      partyIbans: [],
      currency: "USD",
    };
    const [match] = suggestMatches({ amount: 9180, bookingDate: "2026-09-20", counterpartyName: "ACME INC", counterpartyIban: null, purpose: "RE-2026-0042" }, [
      item,
    ]);
    expect(match).toMatchObject({ amount: 9180, exchangeDifference: -69 });
    expect(match!.reasons).toContain("Betrag passt bis auf eine Kursdifferenz (USD)");
    // In Euro gibt es keine Kursdifferenz
    const [euro] = suggestMatches({ amount: 9180, bookingDate: "2026-09-20", counterpartyName: "ACME INC", counterpartyIban: null, purpose: "RE-2026-0042" }, [
      { ...item, currency: "EUR" },
    ]);
    expect(euro!.exchangeDifference).toBeUndefined();
  });
});
