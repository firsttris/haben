import { describe, expect, it } from "vitest";
import { parseAnteil } from "./anteil.ts";

describe("Anteil der Anteilseigner", () => {
  it("liest wie jedes Prozentfeld über parsePercent, ohne Kommazahl dazwischen (#1222)", () => {
    expect(parseAnteil("50")).toBe(5000);
    expect(parseAnteil("33,33 %")).toBe(3333);
    expect(parseAnteil("33.33")).toBe(3333);
    expect(parseAnteil("100")).toBe(10_000);
  });

  it("weist 0, mehr als 100 % und mehr als zwei Nachkommastellen zurück", () => {
    for (const text of ["0", "100,01", "33,333", "1e1", ""]) expect(parseAnteil(text), text).toBeNull();
  });
});
