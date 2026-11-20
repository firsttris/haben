import { describe, expect, it } from "vitest";
import { hochrechnungAufsJahr } from "./hochrechnung.ts";

describe("Hochrechnung aufs Jahr", () => {
  it("rechnet taggenau hoch und rundet auf volle Euro", () => {
    // 1. Juli 2026 ist Tag 182 von 365
    expect(hochrechnungAufsJahr(1_820_000, "2026-07-01")).toBe(3_650_000);
    expect(hochrechnungAufsJahr(1_000_000, "2026-12-31")).toBe(1_000_000);
    // 2028 ist ein Schaltjahr: 1. Juli ist Tag 183 von 366
    expect(hochrechnungAufsJahr(1_830_000, "2028-07-01")).toBe(3_660_000);
    expect(hochrechnungAufsJahr(12_345, "2026-01-01")).toBe(4_505_900);
  });

  it("rechnet einen Verlust ebenso hoch", () => {
    expect(hochrechnungAufsJahr(-1_820_000, "2026-07-01")).toBe(-3_650_000);
  });
});
