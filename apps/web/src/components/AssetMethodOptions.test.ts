import { describe, expect, it } from "vitest";
import { parseRatePercent } from "./AssetMethodOptions.tsx";

describe("Satz der degressiven AfA", () => {
  it("liest wie jedes Prozentfeld über parsePercent, auch mit „%“ (#1222)", () => {
    expect(parseRatePercent("25")).toBe(2500);
    expect(parseRatePercent("23,07")).toBe(2307);
    expect(parseRatePercent("23.07")).toBe(2307);
    expect(parseRatePercent("25 %")).toBe(2500);
  });

  it("leer heißt Höchstsatz, Ungültiges und 100 % und mehr sind NaN", () => {
    expect(parseRatePercent(" ")).toBeNull();
    for (const text of ["abc", "100", "23,075", "-5"]) expect(parseRatePercent(text), text).toBeNaN();
  });
});
