import { describe, expect, it } from "vitest";
import { niceTicks } from "./chart.ts";

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
