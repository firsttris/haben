import { describe, expect, it } from "vitest";
import { parseSkontoRows, toSkontoRows } from "./SkontoFields.tsx";

describe("Skontostufen im Formular", () => {
  it("zeigt Sätze mit Komma und lässt nur ,00 weg", () => {
    const rows = toSkontoRows([
      { days: 10, percent: 200 },
      { days: 14, percent: 250 },
    ]);
    expect(rows.map((r) => [r.percent, r.days])).toEqual([
      ["2", "10"],
      ["2,50", "14"],
    ]);
  });

  it("liest die Zeilen wieder als Basispunkte", () => {
    expect(parseSkontoRows(toSkontoRows([{ days: 14, percent: 250 }]))).toEqual({ stufen: [{ days: 14, percent: 250 }], valid: true });
  });
});
