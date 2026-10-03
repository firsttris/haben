import { describe, expect, it } from "vitest";
import { altersvorsorgeQuote, arbeitnehmerPauschbetrag, arbeitslohnErgebnis, entfernungspauschale, homeofficeWerbungskosten } from "./arbeitnehmer.ts";

describe("Arbeitslohn", () => {
  it("rechnet die Entfernungspauschale je Jahr", () => {
    // 220 Tage, 30 km: 20 × 0,30 € + 10 × 0,38 € = 9,80 € je Tag
    expect(entfernungspauschale(2025, 220, 30)).toBe(2_156_00);
    expect(entfernungspauschale(2021, 220, 30)).toBe(2_090_00);
    expect(entfernungspauschale(2020, 220, 30)).toBe(1_980_00);
    // Ab 2026 0,38 € ab dem ersten Kilometer; angefangene Kilometer zählen nicht
    expect(entfernungspauschale(2026, 220, 30.9)).toBe(2_508_00);
    expect(entfernungspauschale(2025, 0, 30)).toBe(0);
  });

  it("deckelt Homeoffice-Tage und kennt Pauschbetrag und Altersvorsorge-Quote", () => {
    expect(homeofficeWerbungskosten(2025, 250)).toBe(1_260_00);
    expect(homeofficeWerbungskosten(2022, 100)).toBe(500_00);
    expect(homeofficeWerbungskosten(2019, 100)).toBe(0);
    expect(arbeitnehmerPauschbetrag(2025)).toBe(1_230_00);
    expect(arbeitnehmerPauschbetrag(2022)).toBe(1_200_00);
    expect(altersvorsorgeQuote(2022)).toBeCloseTo(0.94);
    expect(altersvorsorgeQuote(2025)).toBe(1);
  });

  it("zieht Werbungskosten oder den Pauschbetrag ab und summiert den Steuerabzug", () => {
    const bescheinigungen = [{ brutto: 42_000_00, lohnsteuer: 6_123_40, kirchensteuer: 489_87 }, { brutto: 6_000_00, lohnsteuer: 800_00 }];
    const pauschal = arbeitslohnErgebnis(2025, { bescheinigungen, werbungskosten: { arbeitsmittel: 300_00 } });
    expect(pauschal).toEqual({ brutto: 48_000_00, werbungskosten: 300_00, abzug: 1_230_00, einkuenfte: 46_770_00, steuerabzug: 7_413_27 });
    const echt = arbeitslohnErgebnis(2025, { bescheinigungen, werbungskosten: { wege: { tage: 180, km: 23 }, homeofficeTage: 40, sonstige: 16_00 } });
    // 180 × (20 × 0,30 + 3 × 0,38) + 40 × 6 € + 16 €
    expect(echt.werbungskosten).toBe(1_285_20 + 240_00 + 16_00);
    expect(echt.einkuenfte).toBe(48_000_00 - 1_541_20);
    // Der Pauschbetrag erzeugt keinen Verlust
    expect(arbeitslohnErgebnis(2025, { bescheinigungen: [{ brutto: 500_00 }], werbungskosten: {} }).einkuenfte).toBe(0);
  });
});
