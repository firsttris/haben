import { describe, expect, it } from "vitest";
import { formatEuro, taxOf } from "./money.ts";

describe("review: negative Null", () => {
  it("Steuer auf eine Storno-Zeile zu 0 % wird als 0,00 € angezeigt, nicht als -0,00 €", () => {
    // Storno einer Kleinunternehmer- oder Reverse-Charge-Rechnung: Netto negativ, Satz 0 %
    expect(formatEuro(taxOf(-50_000, 0))).toBe("0,00 €");
    // Kleine Gutschrift zu 19 %: −0,01 € netto → Steuer −0,0019 € → 0,00 €
    expect(formatEuro(taxOf(-1, 1900))).toBe("0,00 €");
  });
});
