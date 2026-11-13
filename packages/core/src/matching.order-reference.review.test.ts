import { describe, expect, it } from "vitest";
import { type OpenItem, purposeContainsNumber, suggestMatches } from "./matching.ts";

describe("Review: eindeutige Bestellnummer bei gleichem Betrag", () => {
  it("behält die bisherige Rechnungsnummernsuche mit direkt vorangestelltem RE bei", () => {
    expect(purposeContainsNumber("Zahlung RE2026-0042", "2026-0042")).toBe(true);
  });

  it("verwechselt eine Auftragsnummer nicht mit dem Anfang einer Nummer mit Buchstabensuffix", () => {
    const invoice = (id: string, date: string, order: string): OpenItem => ({
      type: "invoice",
      id,
      number: `RE-${id}`,
      date,
      open: 2200,
      partyName: "Kunde",
      partyIbans: [],
      orderReferences: [order],
    });
    const [best] = suggestMatches({ bookingDate: "2026-10-05", amount: 2200, counterpartyName: "Plattform", purpose: "Payment for Order #AU2026042A" }, [
      invoice("alt", "2026-10-01", "AU2026042"),
      invoice("richtig", "2026-10-02", "AU2026042A"),
    ]);
    expect(best?.item.id).toBe("richtig");
  });
});
