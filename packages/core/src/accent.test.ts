import { describe, expect, it } from "vitest";
import { ACCENT_PATTERN, accentPalette, contrastOnWhite, DEFAULT_ACCENT, MIN_TEXT_CONTRAST, oklch } from "./accent.ts";

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

describe("accentPalette", () => {
  const hue = (hex: string) => oklch(hex).h;

  it("ergibt ab Werk die bisherigen Grautöne der Vorlage", () => {
    expect(accentPalette(DEFAULT_ACCENT)).toEqual({ ink: "#16211C", muted: "#5B6B63", rule: "#D5DDD8" });
  });

  it("färbt die Grautöne im Farbton der Akzentfarbe, nicht mehr grün", () => {
    const palette = accentPalette("#1D4ED8");
    for (const grey of Object.values(palette)) expect(Math.abs(hue(grey) - hue("#1D4ED8"))).toBeLessThan(20);
  });

  it("behält die Helligkeit, damit Text gleich gut lesbar bleibt", () => {
    const blau = accentPalette("#1D4ED8");
    const gruen = accentPalette(DEFAULT_ACCENT);
    expect(contrastOnWhite(blau.ink)).toBeCloseTo(contrastOnWhite(gruen.ink), 0);
    expect(contrastOnWhite(blau.muted)).toBeGreaterThan(MIN_TEXT_CONTRAST);
  });

  it("bleibt bei einer grauen Akzentfarbe neutral grau", () => {
    const { ink, muted } = accentPalette("#333333");
    expect(oklch(ink).c).toBeLessThan(0.002);
    expect(oklch(muted).c).toBeLessThan(0.002);
  });

  it("liefert für jede Farbe gültige Hex-Werte", () => {
    for (const color of ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#000000", "#FFFFFF"]) {
      for (const grey of Object.values(accentPalette(color))) expect(grey).toMatch(ACCENT_PATTERN);
    }
  });
});
