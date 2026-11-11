import { describe, expect, it } from "vitest";
import { ACCENT_PATTERN, accentPalette, contrastOnWhite, DEFAULT_ACCENT, inkOnAccent, MIN_TEXT_CONTRAST, oklch } from "./accent.ts";

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

// Mehrere Firmen (#504): Das „H“ in der Navigation steht auf der Akzentfarbe und muss darauf lesbar bleiben
describe("inkOnAccent", () => {
  it("nimmt Weiß auf dunklen und Dunkel auf hellen Farben", () => {
    expect(inkOnAccent("#1D4ED8")).toBe("#FFFFFF");
    expect(inkOnAccent("#000000")).toBe("#FFFFFF");
    expect(inkOnAccent("#F5D90A")).toBe("#16211C");
    expect(inkOnAccent("#ffffff")).toBe("#16211C");
  });

  it("wählt die Schrift mit dem höheren Kontrast nach WCAG, auch bei mittleren Tönen", () => {
    // #767676 hat zu Weiß 4,54 : 1, zu #16211C 3,64 : 1
    expect(inkOnAccent("#767676")).toBe("#FFFFFF");
    // #8A8A8A hat zu Weiß nur 3,45 : 1, zu #16211C 4,8 : 1
    expect(inkOnAccent("#8A8A8A")).toBe("#16211C");
  });

  // Das „H“ der Navigation (16 px, 600) ist kleine Schrift; barrierefreiheit.spec.ts prüft color-contrast auf jeder Seite
  it("hält für jede Farbe 4,5 : 1 nach WCAG 1.4.3, auch für mittlere Töne um #7E7E7E", () => {
    const lum = (hex: string) => {
      const c = (o: number) => {
        const v = parseInt(hex.slice(o, o + 2), 16) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5);
    };
    const kontrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const zuWenig: string[] = [];
    for (let g = 0; g < 256; g++) {
      for (const hex of [
        `#${g.toString(16).padStart(2, "0").repeat(3)}`,
        `#${g.toString(16).padStart(2, "0")}8000`,
        `#00${g.toString(16).padStart(2, "0")}FF`,
      ]) {
        const ratio = kontrast(hex, inkOnAccent(hex));
        if (ratio < MIN_TEXT_CONTRAST) zuWenig.push(`${hex.toUpperCase()} ${ratio.toFixed(2)}`);
      }
    }
    expect(zuWenig).toEqual([]);
  });
});
