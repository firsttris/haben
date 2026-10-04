import { describe, expect, it } from "vitest";
import { computeUstva } from "./ustva.ts";

describe("computeUstva", () => {
  it("rechnet Kz 83 aus 81, 86 und 66", () => {
    expect(computeUstva({ kz81: 290_000, kz86: 0, kz66: 17_355 })).toEqual({
      kz81: 290_000,
      tax81: 55_100,
      kz86: 0,
      tax86: 0,
      kz21: 0,
      kz45: 0,
      kz48: 0,
      kz66: 17_355,
      kz46: 0,
      kz47: 0,
      kz84: 0,
      kz85: 0,
      kz67: 0,
      kz83: 37_745,
    });
  });

  it("schneidet Cent der Bemessungsgrundlagen ab", () => {
    const result = computeUstva({ kz81: 290_099, kz86: 10_050, kz66: 0 });
    expect(result.kz81).toBe(290_000);
    expect(result.kz86).toBe(10_000);
    expect(result.tax86).toBe(700);
  });

  it("Umsätze ohne Steuer zählen nicht in Kz 83, Gutschriften dürfen negativ sein", () => {
    const result = computeUstva({ kz81: -10_000, kz86: 0, kz21: 500_050, kz45: 120_000, kz48: -3_000, kz66: 0 });
    expect(result).toMatchObject({ kz81: -10_000, tax81: -1_900, kz21: 500_000, kz45: 120_000, kz48: -3_000, kz83: -1_900 });
  });

  it("Erstattung ergibt negatives Kz 83", () => {
    expect(computeUstva({ kz81: 0, kz86: 0, kz66: 12_000 }).kz83).toBe(-12_000);
  });

  it("§ 13b: Steuer aus Kz 47/85 zählt, Vorsteuer Kz 67 zieht sie wieder ab", () => {
    const result = computeUstva({ kz81: 0, kz86: 0, kz66: 0, kz46: 10_050, kz47: 1_910, kz84: 20_000, kz85: 3_800, kz67: 5_710 });
    expect(result).toMatchObject({ kz46: 10_000, kz47: 1_910, kz84: 20_000, kz85: 3_800, kz67: 5_710, kz83: 0 });
    // Ohne Vorsteuerabzug (Kleinunternehmer) bleibt die Steuer als Zahllast
    expect(computeUstva({ kz81: 0, kz86: 0, kz66: 0, kz46: 10_000, kz47: 1_900 }).kz83).toBe(1_900);
  });
});
