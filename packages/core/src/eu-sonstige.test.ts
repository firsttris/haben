import { describe, expect, it } from "vitest";
import { computeInvoiceTotals } from "./invoice.ts";
import { invoicePosting } from "./posting.ts";
import { kennzahlenAusJournal } from "./journal-kennzahlen.ts";
import { reservedAccountNumbers } from "./own-accounts.ts";

describe("Geklärte nicht steuerbare sonstige EU-Leistung", () => {
  const totals = computeInvoiceTotals([{ quantity: 1000, unitPrice: 10_000, taxRate: 0 }]);
  // DATEV-Kontenrahmen 2026: 8339/4339; keine B2B-RC-Kennzahl21, sondern übrige nicht steuerbare Umsätze45.
  // https://www.gesetze-im-internet.de/ustg_1980/__3a.html
  it.each([
    ["SKR03", "ist", "8339"],
    ["SKR04", "soll", "4339"],
  ] as const)("bucht %s/%s getrennt ohne deutsche Umsatzsteuer", (kontenrahmen, versteuerung, account) => {
    const lines = invoicePosting(totals, kontenrahmen, versteuerung, "eu_sonstige");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ account, debit: 0, credit: 10_000, taxCode: "NichtSteuerbar" });
    const figures = kennzahlenAusJournal(kontenrahmen, versteuerung, [lines]);
    expect(figures.kz45).toBe(10_000);
    expect(figures.kz21).toBe(0);
    expect(figures.tax81).toBe(0);
    expect(reservedAccountNumbers(kontenrahmen).has(account)).toBe(true);
  });
});
