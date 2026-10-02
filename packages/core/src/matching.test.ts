import { describe, expect, it } from "vitest";
import { purposeContainsNumber, suggestMatches, type OpenItem } from "./matching.ts";

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
    expect(best?.reasons).toEqual([
      "Betrag stimmt exakt",
      "Rechnungsnummer im Verwendungszweck",
      "IBAN bekannt vom Kontakt",
      "Name passt",
    ]);
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

  it("schwache Treffer fallen weg", () => {
    expect(suggestMatches({ ...tx, amount: 1_000, purpose: "x", counterpartyIban: null, counterpartyName: "Fremd" }, [invoice()])).toEqual([]);
  });

  it("Rechnungsnummer ohne Trennzeichen", () => {
    expect(purposeContainsNumber("Rg.Nr. 2026031 vielen Dank", "2026-031")).toBe(true);
    expect(purposeContainsNumber("Abschlag 12", "12")).toBe(false);
  });
});
