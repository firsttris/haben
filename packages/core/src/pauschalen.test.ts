import { describe, expect, it } from "vitest";
import { fahrtBetrag, homeofficeSatz, verpflegungBetrag } from "./pauschalen.ts";

describe("Pauschalen", () => {
  it("Homeoffice: 6 € für bis zu 210 Tage ab 2023, davor 5 € für 120 Tage", () => {
    expect(homeofficeSatz(2025)).toEqual({ proTag: 600, maxTage: 210 });
    expect(homeofficeSatz(2022)).toEqual({ proTag: 500, maxTage: 120 });
    expect(homeofficeSatz(2019)).toBeNull();
  });

  it("Fahrten: 0,30 € je km mit dem Auto, 0,20 € mit anderen Fahrzeugen", () => {
    expect(fahrtBetrag(124, "pkw")).toBe(3720);
    expect(fahrtBetrag(12.5, "andere")).toBe(250);
    expect(fahrtBetrag(0, "pkw")).toBe(0);
    expect(fahrtBetrag(-3, "pkw")).toBe(0);
  });

  it("Verpflegung: 14 €, 28 € voller Tag, Kürzung bei gestellten Mahlzeiten", () => {
    expect(verpflegungBetrag(2025, "eintaegig")).toBe(1400);
    expect(verpflegungBetrag(2025, "anreise")).toBe(1400);
    expect(verpflegungBetrag(2025, "ganztag")).toBe(2800);
    // Frühstück im Hotel: 28 € − 5,60 €
    expect(verpflegungBetrag(2025, "ganztag", { fruehstueck: true })).toBe(2240);
    // Abreisetag mit Frühstück: 14 € − 5,60 €
    expect(verpflegungBetrag(2025, "abreise", { fruehstueck: true })).toBe(840);
    // Alle Mahlzeiten gestellt: nichts übrig, nie negativ
    expect(verpflegungBetrag(2025, "eintaegig", { mittag: true, abend: true })).toBe(0);
    expect(verpflegungBetrag(2019, "ganztag")).toBe(2400);
  });
});
