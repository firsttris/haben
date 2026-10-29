import { describe, expect, it } from "vitest";
import { formatInvoiceNumber } from "./invoice.ts";
import { purposeContainsNumber, suggestMatches } from "./matching.ts";

describe("Review Rechnungsnummer im Verwendungszweck", () => {
  it("Rechnung 2026-100 steckt nicht in „Rechnung 2026-1000“", () => {
    expect(purposeContainsNumber(`Rechnung ${formatInvoiceNumber(2026, 1000)}`, formatInvoiceNumber(2026, 100))).toBe(false);
  });

  it("Zahlung auf 2026-1000 wird nicht der Rechnung 2026-100 mit gleichem Betrag zugeordnet", () => {
    const tx = { bookingDate: "2026-10-01", amount: 500_00, counterpartyName: "Kunde A", purpose: "Rechnung 2026-1000" };
    const item = (number: string, id: string) => ({ type: "invoice" as const, id, number, date: "2026-09-01", open: 500_00, partyName: "Kunde B", partyIbans: [] });
    const [best] = suggestMatches(tx, [item("2026-100", "a"), item("2026-1000", "b")]);
    expect(best!.item.id).toBe("b");
    expect(suggestMatches(tx, [item("2026-100", "a")])[0]!.reasons).not.toContain("Rechnungsnummer im Verwendungszweck");
  });
});
