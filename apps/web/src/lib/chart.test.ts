import { describe, expect, it } from "vitest";
import { barPath, niceTicks } from "./chart.ts";

describe("niceTicks", () => {
  it("runde Werte, die min und max einschließen", () => {
    expect(niceTicks(0, 1_225_000)).toEqual([0, 500_000, 1_000_000, 1_500_000]);
    expect(niceTicks(-30_000, 80_000)).toEqual([-50_000, 0, 50_000, 100_000]);
  });

  it("ohne Werte (alles 0) mindestens zwei Achsenwerte, sonst teilt das Diagramm durch null und zeichnet NaN", () => {
    const ticks = niceTicks(0, 0);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)!).toBeGreaterThan(0);
  });

  it("auch bei kleinen Beträgen eine Spanne", () => {
    const ticks = niceTicks(500, 500);
    expect(ticks[0]!).toBeLessThanOrEqual(500);
    expect(ticks.at(-1)!).toBeGreaterThan(ticks[0]!);
  });
});

describe("barPath", () => {
  it("positiv nach oben: runde Datenkante oben, eckig an der Grundlinie", () => {
    expect(barPath(10, 100, 40, 20)).toBe("M10,100V44Q10,40 14,40H26Q30,40 30,44V100Z");
  });

  it("negativ nach unten: runde Datenkante unten", () => {
    expect(barPath(10, 100, 160, 20)).toBe("M10,100V156Q10,160 14,160H26Q30,160 30,156V100Z");
  });

  it("flache Balken: Radius höchstens die Höhe, ohne Höhe kein Balken", () => {
    expect(barPath(0, 50, 48, 20)).toBe("M0,50V50Q0,48 2,48H18Q20,48 20,50V50Z");
    expect(barPath(0, 50, 50, 20)).toBe("");
  });
});
