import { describe, expect, it } from "vitest";
import { likePattern, parseEuroSearchCents } from "./search.ts";

describe("likePattern", () => {
  it("maskiert % und _ und Backslash", () => {
    expect(likePattern("100% _test\\x")).toBe("%100\\% \\_test\\\\x%");
  });
});

describe("parseEuroSearchCents", () => {
  it("erkennt ganze und dezimale Euro-Beträge", () => {
    expect(parseEuroSearchCents("119")).toBe(11900);
    expect(parseEuroSearchCents("119,50")).toBe(11950);
    expect(parseEuroSearchCents("1.234,56 €")).toBe(123456);
    expect(parseEuroSearchCents("-42,5")).toBe(-4250);
    expect(parseEuroSearchCents("19.99")).toBe(1999);
  });

  it("gibt null für Nummern, Text und Beträge oberhalb des int4-Bereichs zurück", () => {
    expect(parseEuroSearchCents("")).toBeNull();
    expect(parseEuroSearchCents("RE-2026-001")).toBeNull();
    expect(parseEuroSearchCents("12.345.67")).toBeNull();
    expect(parseEuroSearchCents("99999999")).toBeNull();
  });
});
