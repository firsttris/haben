import { describe, expect, it } from "vitest";
import { einkommensteuer } from "./income-tax.ts";

describe("review: einkommensteuer 2023", () => {
  it("rechnet die Zone 0,42 · x − 9.972,98 ohne Gleitkommafehler (§ 32a Abs. 1 Nr. 4 EStG 2023)", () => {
    // 0,42 · 78.069 − 9.972,98 = 32.788,98 − 9.972,98 = 22.816,00 exakt
    expect(einkommensteuer(78_069_00, 2023)).toBe(22_816_00);
    // Splitting: 2 · St(78.069) bei zvE 156.138 €
    expect(einkommensteuer(156_138_00, 2023, true)).toBe(2 * 22_816_00);
  });
});
