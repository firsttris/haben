import { describe, expect, it } from "vitest";
import { dauerfristActive, sondervorauszahlung, sondervorauszahlungFor, type DauerfristSetting } from "./dauerfrist.ts";

describe("sondervorauszahlung (§ 47 UStDV)", () => {
  it("ein Elftel der Vorauszahlungen des Vorjahres, zuzüglich der angerechneten Sondervorauszahlung", () => {
    // 39.000 € Vorauszahlungen und 5.000 € im Dezember angerechnet: 44.000 € / 11 = 4.000 €
    expect(sondervorauszahlung({ vorauszahlungen: 3_900_000, angerechnet: 500_000, months: 12 })).toBe(400_000);
  });
  it("volle Euro, abgeschnitten (Kz 38)", () => {
    // 35.000 € / 11 = 3.181,81 € → 3.181 €
    expect(sondervorauszahlung({ vorauszahlungen: 3_000_000, angerechnet: 500_000, months: 12 })).toBe(318_100);
  });
  it("nur einen Teil des Vorjahres tätig: auf ein Jahr hochgerechnet (Abs. 2)", () => {
    // 11.000 € in vier Monaten → 33.000 € im Jahr → 3.000 €
    expect(sondervorauszahlung({ vorauszahlungen: 1_100_000, angerechnet: 0, months: 4 })).toBe(300_000);
  });
  it("Überschuss: keine Sondervorauszahlung", () => {
    expect(sondervorauszahlung({ vorauszahlungen: -500_000, angerechnet: 0, months: 12 })).toBe(0);
  });
  it("lehnt unmögliche Monate ab", () => {
    expect(() => sondervorauszahlung({ vorauszahlungen: 0, angerechnet: 0, months: 0 })).toThrow();
  });
});

describe("dauerfristActive", () => {
  const settings: DauerfristSetting[] = [
    { year: 2025, active: true, sondervorauszahlung: 300_000 },
    { year: 2027, active: false, sondervorauszahlung: null },
  ];
  it("gilt bis zum Widerruf, auch in Folgejahren", () => {
    expect(dauerfristActive(settings, 2024)).toBe(false);
    expect(dauerfristActive(settings, 2025)).toBe(true);
    expect(dauerfristActive(settings, 2026)).toBe(true);
    expect(dauerfristActive(settings, 2027)).toBe(false);
  });
  it("Sondervorauszahlung nur für das Jahr, für das sie angemeldet ist", () => {
    expect(sondervorauszahlungFor(settings, 2025)).toBe(300_000);
    expect(sondervorauszahlungFor(settings, 2026)).toBe(0);
  });
});
