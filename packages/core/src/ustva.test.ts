import { describe, expect, it } from "vitest";
import { computeUstva } from "./ustva.ts";

describe("computeUstva", () => {
  it("rechnet Kz 83 aus 81, 86 und 66", () => {
    expect(computeUstva({ kz81: 290_000, kz86: 0, kz66: 17_355 })).toEqual({
      kz81: 290_000,
      tax81: 55_100,
      kz86: 0,
      tax86: 0,
      kz66: 17_355,
      kz83: 37_745,
    });
  });

  it("schneidet Cent der Bemessungsgrundlagen ab", () => {
    const result = computeUstva({ kz81: 290_099, kz86: 10_050, kz66: 0 });
    expect(result.kz81).toBe(290_000);
    expect(result.kz86).toBe(10_000);
    expect(result.tax86).toBe(700);
  });

  it("Erstattung ergibt negatives Kz 83", () => {
    expect(computeUstva({ kz81: 0, kz86: 0, kz66: 12_000 }).kz83).toBe(-12_000);
  });
});
