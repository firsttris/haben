import type { VatFrequencySetting } from "@haben/core";
import { describe, expect, it } from "vitest";
import { fehlendeMonate } from "./fehlende-voranmeldungen.ts";

/**
 * Reine Funktionstests, ohne Datenbank: `fehlendeMonate` bekommt die Einstellungen und die gesendeten
 * Monate übergeben. Sie laufen deshalb auch ohne Postgres und nicht im `skipIf`-Block von annual.test.ts.
 */

const KEINE = new Set<number>();

const setting = (year: number, fromMonth: number, frequency: VatFrequencySetting["frequency"]): VatFrequencySetting => ({
  year,
  fromMonth,
  frequency,
});

describe("fehlendeMonate", () => {
  it("meldet ohne Einstellung alle zwölf Monate, wenn nichts gesendet wurde", () => {
    expect(fehlendeMonate([], 2025, KEINE)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("lässt gesendete Monate aus", () => {
    const gesendet = new Set([1, 2, 3]);
    expect(fehlendeMonate([], 2025, gesendet)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("zählt Monate ohne Voranmeldepflicht nicht", () => {
    const settings = [setting(2025, 1, "keine")];
    expect(fehlendeMonate(settings, 2025, KEINE)).toEqual([]);
  });

  it("beginnt mit dem ersten Eintrag des Jahres, nicht mit Januar", () => {
    // Tätigkeit im Oktober angemeldet: Januar bis September waren nicht voranmeldepflichtig
    const settings = [setting(2025, 10, "monatlich")];
    expect(fehlendeMonate(settings, 2025, KEINE)).toEqual([10, 11, 12]);
  });

  it("hält einen Wechsel des Zeitraums im Jahr nicht für den Beginn der Tätigkeit", () => {
    // Seit 2024 monatlich, ab Juli 2025 vierteljährlich. Die Tätigkeit begann nicht im Juli,
    // Januar bis Juni bleiben prüfbar (#869, Review-Befund)
    const settings = [setting(2024, 1, "monatlich"), setting(2025, 7, "vierteljaehrlich")];
    expect(fehlendeMonate(settings, 2025, KEINE)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("zählt beim Wechsel im Jahr die gesendeten Monate weiter ab", () => {
    const settings = [setting(2024, 1, "monatlich"), setting(2025, 7, "vierteljaehrlich")];
    const gesendet = new Set([1, 2, 3, 4, 5, 6, 9]);
    expect(fehlendeMonate(settings, 2025, gesendet)).toEqual([7, 8, 10, 11, 12]);
  });

  it("nimmt den frühesten Eintrag, wenn im Jahr mehrere stehen", () => {
    const settings = [setting(2025, 7, "vierteljaehrlich"), setting(2025, 3, "monatlich")];
    expect(fehlendeMonate(settings, 2025, KEINE)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("behandelt Jahre ohne Eintrag als monatlich, auch wenn andere Jahre Einträge haben", () => {
    const settings = [setting(2024, 1, "monatlich")];
    expect(fehlendeMonate(settings, 2025, KEINE)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
