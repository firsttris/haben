import { describe, expect, it } from "vitest";
import { arbeitslohnErgebnis } from "./arbeitnehmer.ts";

describe("Review arbeitslohnErgebnis", () => {
  it("tatsächliche Werbungskosten über dem Lohn, aber unter dem Pauschbetrag ergeben einen Verlust", () => {
    // Minijob-artiger Lohn 500 €, Werbungskosten 800 € (< 1.230 € Pauschbetrag): Einkünfte −300 €
    const r = arbeitslohnErgebnis(2025, { bescheinigungen: [{ brutto: 500_00 }], werbungskosten: { arbeitsmittel: 800_00 } });
    expect(r.abzug).toBe(800_00);
    expect(r.einkuenfte).toBe(-300_00);
  });
});
