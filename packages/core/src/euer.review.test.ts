import { describe, expect, it } from "vitest";
import { computeEuer } from "./euer.ts";

const amount = (euer: ReturnType<typeof computeEuer>, key: string) =>
  [...euer.einnahmen, ...euer.ausgaben].find((l) => l.key === key)?.amount ?? 0;

describe("review: computeEuer Bewirtung", () => {
  it("70 % abziehbar, kaufmännisch gerundet: 51,95 € → 36,37 € abziehbar, 15,58 € nicht abziehbar (§ 4 Abs. 5 Nr. 2 EStG)", () => {
    const essen = { net: 5195, tax: 987, gross: 6182, taxes: [{ rate: 1900, base: 5195, tax: 987 }] };
    const euer = computeEuer(2026, [{ kind: "document", date: "2026-03-02", paid: essen.gross, totals: essen, category: "bewirtung" }]);
    // 5195 · 0,7 = 3636,5 → 3637 (kaufmännisch)
    expect(amount(euer, "ausgabe:bewirtung")).toBe(3637);
    expect(euer.bewirtungNichtAbziehbar).toBe(1558);
  });
});
