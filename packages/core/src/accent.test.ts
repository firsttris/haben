import { describe, expect, it } from "vitest";
import { contrastOnWhite, DEFAULT_ACCENT, MIN_TEXT_CONTRAST } from "./accent.ts";

describe("contrastOnWhite", () => {
  it("rechnet wie WCAG: Schwarz 21 : 1, Weiß 1 : 1", () => {
    expect(contrastOnWhite("#000000")).toBeCloseTo(21, 5);
    expect(contrastOnWhite("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("lässt das Standardgrün durch und warnt bei hellem Gelb", () => {
    expect(contrastOnWhite(DEFAULT_ACCENT)).toBeGreaterThan(MIN_TEXT_CONTRAST);
    expect(contrastOnWhite("#f5d90a")).toBeLessThan(MIN_TEXT_CONTRAST);
  });
});
