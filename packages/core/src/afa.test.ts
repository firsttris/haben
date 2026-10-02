import { describe, expect, it } from "vitest";
import { AssetError, assetAccount, depreciationAccount, depreciationSchedule } from "./afa.ts";

const sum = (rows: { depreciation: number; disposal: number }[]) => rows.reduce((s, r) => s + r.depreciation + r.disposal, 0);

describe("depreciationSchedule", () => {
  it("linear monatsgenau: Auto für 36.000 € im März, 6 Jahre", () => {
    const rows = depreciationSchedule({ acquisitionDate: "2026-03-15", cost: 3_600_000, method: "linear", usefulLifeMonths: 72 });
    expect(rows.map((r) => [r.year, r.depreciation])).toEqual([
      [2026, 500_000], // 10 Monate
      [2027, 600_000],
      [2028, 600_000],
      [2029, 600_000],
      [2030, 600_000],
      [2031, 600_000],
      [2032, 100_000], // Januar und Februar
    ]);
    expect(rows[0]).toMatchObject({ opening: 0, addition: 3_600_000, closing: 3_100_000 });
    expect(rows.at(-1)!.closing).toBe(0);
  });

  it("verteilt Rundungsreste so, dass genau die Anschaffungskosten abgeschrieben werden", () => {
    const rows = depreciationSchedule({ acquisitionDate: "2026-07-01", cost: 100_001, method: "linear", usefulLifeMonths: 36 });
    expect(sum(rows)).toBe(100_001);
  });

  it("Computer mit Nutzungsdauer 1 Jahr, GWG und Sammelposten", () => {
    expect(depreciationSchedule({ acquisitionDate: "2026-11-20", cost: 249_000, method: "digital", usefulLifeMonths: null })).toEqual([
      { year: 2026, opening: 0, addition: 249_000, depreciation: 249_000, disposal: 0, closing: 0 },
    ]);
    expect(depreciationSchedule({ acquisitionDate: "2026-11-20", cost: 79_900, method: "gwg", usefulLifeMonths: null })).toHaveLength(1);
    const pool = depreciationSchedule({ acquisitionDate: "2026-12-01", cost: 90_001, method: "sammelposten", usefulLifeMonths: null });
    expect(pool.map((r) => r.depreciation)).toEqual([18_000, 18_000, 18_001, 18_000, 18_000]);
  });

  it("Übernahme aus Lexoffice: Restbuchwert zum Stichtag über die Restnutzungsdauer", () => {
    const rows = depreciationSchedule({
      acquisitionDate: "2024-01-10",
      cost: 3_600_000,
      method: "linear",
      usefulLifeMonths: 72,
      opening: { date: "2026-01-01", bookValue: 2_400_000 },
    });
    expect(rows.map((r) => r.depreciation)).toEqual([600_000, 600_000, 600_000, 600_000]);
    expect(rows[0]).toMatchObject({ year: 2026, opening: 2_400_000, addition: 0 });
  });

  it("Abgang: Abschreibung bis zum Monat des Abgangs, Rest als Restbuchwert", () => {
    const rows = depreciationSchedule({
      acquisitionDate: "2026-01-05",
      cost: 1_200_000,
      method: "linear",
      usefulLifeMonths: 60,
      disposalDate: "2027-03-31",
    });
    expect(rows).toEqual([
      { year: 2026, opening: 0, addition: 1_200_000, depreciation: 240_000, disposal: 0, closing: 960_000 },
      { year: 2027, opening: 960_000, addition: 0, depreciation: 60_000, disposal: 900_000, closing: 0 },
    ]);
  });

  it("prüft Grenzen", () => {
    expect(() => depreciationSchedule({ acquisitionDate: "2026-01-01", cost: 90_000, method: "gwg", usefulLifeMonths: null })).toThrow(AssetError);
    expect(() => depreciationSchedule({ acquisitionDate: "2026-01-01", cost: 90_000, method: "linear", usefulLifeMonths: null })).toThrow("Nutzungsdauer");
  });
});

describe("Konten", () => {
  it("Fahrzeug und GWG", () => {
    expect(assetAccount("kfz", "linear", "SKR03")).toBe("0320");
    expect(depreciationAccount("kfz", "linear", "SKR04")).toBe("6222");
    expect(assetAccount("edv", "gwg", "SKR04")).toBe("0670");
    expect(depreciationAccount("edv", "digital", "SKR03")).toBe("4830");
  });
});
