import { describe, expect, it } from "vitest";
import { splitPrivateShare } from "./money.ts";
import { privateUseMonth, privateUseMonths, privateUsePosting, suggestedPrivateUseRate } from "./private-use.ts";

const balanced = (lines: { debit: number; credit: number }[]) =>
  lines.reduce((s, l) => s + l.debit, 0) === lines.reduce((s, l) => s + l.credit, 0);

describe("Kfz-Privatnutzung", () => {
  it("Verbrenner: 1 % vom abgerundeten Listenpreis, USt auf 80 %", () => {
    const month = privateUseMonth({ listPrice: 4_589_990, drive: "verbrenner", rate: 100, vat: true });
    expect(month).toEqual({ withdrawal: 45_800, vatBase: 36_640, vat: 6_962 });
    const lines = privateUsePosting(month, "SKR03");
    expect(lines).toEqual([
      { account: "1800", debit: 52_762, credit: 0, taxCode: null },
      { account: "8921", debit: 0, credit: 36_640, taxCode: "USt19" },
      { account: "8924", debit: 0, credit: 9_160, taxCode: null },
      { account: "1776", debit: 0, credit: 6_962, taxCode: "USt19" },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it("Elektro: 0,25 % für die Einkommensteuer, Umsatzsteuer trotzdem vom vollen Listenpreis", () => {
    const month = privateUseMonth({ listPrice: 5_890_000, drive: "elektro", rate: 25, vat: true });
    expect(month).toEqual({ withdrawal: 14_725, vatBase: 47_120, vat: 8_953 });
    const lines = privateUsePosting(month, "SKR04");
    expect(lines.map((l) => l.account)).toEqual(["2100", "4645", "3806"]);
    expect(balanced(lines)).toBe(true);
  });

  it("ohne Umsatzsteuer", () => {
    expect(privateUseMonth({ listPrice: 5_000_000, drive: "elektro", rate: 25, vat: false })).toEqual({ withdrawal: 12_500, vatBase: 0, vat: 0 });
  });

  it("Satzvorschlag nach Antrieb, Preisgrenze und Anschaffung", () => {
    expect(suggestedPrivateUseRate("verbrenner", 3_000_000, "2025-01-01")).toBe(100);
    expect(suggestedPrivateUseRate("hybrid", 5_000_000, "2025-01-01")).toBe(50);
    expect(suggestedPrivateUseRate("elektro", 6_500_000, "2023-05-01")).toBe(50);
    expect(suggestedPrivateUseRate("elektro", 6_500_000, "2024-05-01")).toBe(25);
    expect(suggestedPrivateUseRate("elektro", 9_000_000, "2025-08-01")).toBe(25);
  });

  it("Monate ab Anschaffung bzw. Übernahme bis zum Abgang", () => {
    expect(privateUseMonths({ acquisitionDate: "2026-03-20" }, 2026)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(privateUseMonths({ acquisitionDate: "2023-03-20", openingDate: "2026-01-01", disposalDate: "2026-05-02" }, 2026)).toEqual([1, 2, 3, 4, 5]);
    expect(privateUseMonths({ acquisitionDate: "2023-03-20", openingDate: "2026-01-01" }, 2025)).toEqual([]);
  });
});

describe("splitPrivateShare", () => {
  it("teilt nach Prozent", () => {
    expect(splitPrivateShare(4_999, 20)).toEqual({ business: 3_999, private: 1_000 });
    expect(splitPrivateShare(-1_000, 25)).toEqual({ business: -750, private: -250 });
  });
});
