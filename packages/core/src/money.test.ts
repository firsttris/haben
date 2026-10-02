import { describe, expect, it } from "vitest";
import { formatEuro, parseEuro, taxOf } from "./money.ts";

describe("parseEuro", () => {
  it.each([
    ["1.234,56", 123456],
    ["1234,5", 123450],
    ["0", 0],
    ["12 €", 1200],
    ["-3.000,00", -300000],
    ["−45,90", -4590],
  ])("%s → %i", (input, cents) => {
    expect(parseEuro(input)).toBe(cents);
  });

  it.each(["", "abc", "1,234", "12.34", "1.23,00"])("lehnt %j ab", (input) => {
    expect(parseEuro(input)).toBeNull();
  });
});

describe("formatEuro", () => {
  it("formatiert deutsch", () => {
    expect(formatEuro(2341872).replace(/\s/g, " ")).toBe("23.418,72 €");
  });
});

describe("taxOf", () => {
  it("rundet kaufmännisch", () => {
    expect(taxOf(290000, 1900)).toBe(55100);
    expect(taxOf(1, 1900)).toBe(0);
    expect(taxOf(3, 1900)).toBe(1);
    expect(taxOf(-3, 1900)).toBe(-1);
  });
});
