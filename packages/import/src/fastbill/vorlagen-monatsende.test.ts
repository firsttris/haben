import { dueDates } from "@haben/core";
import { describe, expect, it } from "vitest";
import type { FbRecurring } from "./types.ts";
import { mapFbRecurring } from "./vorlagen.ts";

// Vorlage wie in vorlagen.test.ts, nur die Felder des Verdachts geändert
const vorlage = (fields: Partial<FbRecurring> = {}): FbRecurring => ({
  INVOICE_ID: "5001",
  CUSTOMER_ID: "601",
  INVOICE_TITLE: "Wartung Website",
  CURRENCY_CODE: "EUR",
  FREQUENCY: "monthly",
  START_DATE: "2027-03-01",
  OCCURENCES: "0",
  IS_GROSS: "0",
  VAT_CASE: "0",
  PAYMENT_TYPE: "1",
  DISCOUNT_PERCENT: "",
  DISCOUNT_AMOUNT: "",
  ITEMS: [{ DESCRIPTION: "Wartung", QUANTITY: 1, UNIT: "Monat", UNIT_PRICE: "120.00", VAT_PERCENT: "19.00" }],
  ...fields,
});

describe("mapFbRecurring", () => {
  it.each([
    ["2027-02-28", "2"],
    ["2027-04-30", "2"],
    ["2027-06-30", "3"],
  ])("Start %s am Monatsende mit %s Rechnungen: Haben erzeugt genau so viele", (start, occurrences) => {
    const mapped = mapFbRecurring(vorlage({ START_DATE: start, OCCURENCES: occurrences }));
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    const { nextDate, intervalMonths, anchorDay, endDate } = mapped.template;
    expect(dueDates(nextDate, intervalMonths, anchorDay, "2099-12-31", endDate)).toHaveLength(Number(occurrences));
  });

  it("rundet einen Einzelpreis mit Bruchteilen von Cent nicht stillschweigend", () => {
    // FastBill speichert Preise mit vier Nachkommastellen (artikel.ts: „84,0336“); 10 000 × 0,0450 € = 450,00 €
    const mapped = mapFbRecurring(
      vorlage({ ITEMS: [{ DESCRIPTION: "SMS-Versand", QUANTITY: 10000, UNIT: "Stk.", UNIT_PRICE: "0.0450", VAT_PERCENT: "19.00" }] }),
    );
    const silent = mapped.ok && !mapped.hints.some((h) => h.includes("Position 1") && /Preis|Cent/.test(h));
    expect(silent).toBe(false);
  });
});
