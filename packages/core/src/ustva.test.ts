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
      kz41: 0,
      kz43: 0,
      kz89: 0,
      tax89: 0,
      kz93: 0,
      tax93: 0,
      kz61: 0,
      kz62: 0,
      kz39: 0,
      kz83: 37_745,
    });
  });

  it("zieht die Sondervorauszahlung ab (Kz 39, § 48 Abs. 4 UStDV)", () => {
    expect(computeUstva({ kz81: 290_000, kz86: 0, kz66: 17_355, kz39: 40_000 })).toMatchObject({ kz39: 40_000, kz83: -2_255 });
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

describe("Einfuhrumsatzsteuer", () => {
  it("Kz 62 mindert Kz 83 wie Vorsteuer, in Cent", () => {
    expect(computeUstva({ kz81: 100_000, kz86: 0, kz66: 1_900, kz62: 38_015 })).toMatchObject({ kz62: 38_015, kz83: 19_000 - 1_900 - 38_015 });
  });
});
