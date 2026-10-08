import { describe, expect, it } from "vitest";
import { daysOverdue, dunningAmounts, lateInterest } from "./dunning.ts";
import { computeEuer } from "./euer.ts";
import { directPosting } from "./posting.ts";

describe("Mahnung", () => {
  it("Verzugstage ab dem Tag nach der Fälligkeit", () => {
    expect(daysOverdue("2026-09-16", "2026-10-16")).toBe(30);
    expect(daysOverdue("2026-10-20", "2026-10-16")).toBe(0);
  });

  it("Zinsen taggenau auf 365 Tage", () => {
    // 10.000 € zu 10,27 % für 30 Tage = 84,41 €
    expect(lateInterest(1_000_000, 1_027, 30)).toBe(8_441);
    expect(lateInterest(1_000_000, 0, 30)).toBe(0);
  });

  it("Gesamtforderung: Gebühr wird auf die Pauschale angerechnet (§ 288 Abs. 5 Satz 3 BGB)", () => {
    expect(dunningAmounts({ open: 119_000, dueDate: "2026-09-01", date: "2026-10-01", fee: 500, flatFee: true, interestRate: 1_027 })).toEqual({
      open: 119_000,
      fee: 0,
      flatFee: 4_000,
      interest: 1_004,
      interestRate: 1_027,
      interestDays: 30,
      total: 124_004,
    });
    // Übersteigt die Gebühr die Pauschale, wird nur der Mehrbetrag zusätzlich gefordert
    const hoch = dunningAmounts({ open: 100_000, dueDate: "2026-09-01", date: "2026-10-01", fee: 5_000, flatFee: true, interestRate: null });
    expect(hoch).toMatchObject({ fee: 1_000, flatFee: 4_000, total: 105_000 });
    expect(dunningAmounts({ open: 100_000, dueDate: "2026-09-01", date: "2026-10-01", fee: 1_000, flatFee: false, interestRate: null }).total).toBe(101_000);
    expect(dunningAmounts({ open: 119_000, dueDate: "2026-09-01", date: "2026-10-01", fee: 0, flatFee: false, interestRate: null }).total).toBe(119_000);
  });

  it("Zahlung von Gebühren und Zinsen: Bank an Zinserträge, in der EÜR ohne Umsatzsteuer", () => {
    expect(directPosting("mahnerloes", 4_500, "SKR03")).toEqual([
      { account: "1200", debit: 4_500, credit: 0, taxCode: null },
      { account: "2650", debit: 0, credit: 4_500, taxCode: null },
    ]);
    const euer = computeEuer(2026, [{ kind: "mahnerloes", date: "2026-10-05", amount: 4_500 }]);
    expect(euer.einnahmen.find((l) => l.key === "einnahmenSteuerfrei")?.amount).toBe(4_500);
  });
});
