import { describe, expect, it } from "vitest";
import { entfernungspauschale } from "./arbeitnehmer.ts";
import { fahrtBetrag, homeofficeSatz, PAUSCHALE_KONTEN, PAUSCHALE_LABEL, verpflegungBetrag, volleKilometer } from "./pauschalen.ts";

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

  // Wege Wohnung–Betriebsstätte (#895): § 4 Abs. 5 Satz 1 Nr. 6 Satz 2 EStG verweist für die Abgeltung auf § 9 Abs. 1 Satz 3 Nr. 4 EStG
  it("Entfernungspauschale: je Tag und vollem Kilometer, 2021, 2025 und 2026 verschieden", () => {
    // 15 Tage × 12 km: bis 2025 0,30 €, ab 2026 0,38 € ab dem ersten Kilometer
    expect(entfernungspauschale(2021, 15, 12)).toBe(5400);
    expect(entfernungspauschale(2025, 15, 12)).toBe(5400);
    expect(entfernungspauschale(2026, 15, 12)).toBe(6840);
    // 10 Tage × 25 km: ab dem 21. Kilometer 0,35 € (2021) bzw. 0,38 € (2025), 2026 überall 0,38 €
    expect(entfernungspauschale(2021, 10, 25)).toBe(7750);
    expect(entfernungspauschale(2025, 10, 25)).toBe(7900);
    expect(entfernungspauschale(2026, 10, 25)).toBe(9500);
    // nur volle Kilometer
    expect(entfernungspauschale(2026, 1, 12.9)).toBe(456);
  });

  // § 9 Abs. 1 Satz 3 Nr. 4 Satz 2 EStG: nur volle Kilometer; „12,5“ darf nie 125 km werden
  it("Kilometer aus der Eingabe: Komma als Dezimaltrenner, Punkt als Tausenderpunkt, nur volle Kilometer", () => {
    expect(volleKilometer("12")).toBe(12);
    expect(volleKilometer("12,5")).toBe(12);
    expect(volleKilometer("12,9")).toBe(12);
    expect(volleKilometer("1.200")).toBe(1200);
    expect(volleKilometer("0,5")).toBe(0);
    expect(volleKilometer("")).toBe(0);
    expect(volleKilometer("abc")).toBe(0);
  });

  it("Entfernungspauschale: eigene Art mit Konto 4678 (SKR03) und 6688 (SKR04), abziehbarer Anteil", () => {
    expect(PAUSCHALE_LABEL.entfernung).toBe("Wege zwischen Wohnung und Betriebsstätte");
    expect(PAUSCHALE_KONTEN.entfernung.SKR03.konto).toBe("4678");
    expect(PAUSCHALE_KONTEN.entfernung.SKR04.konto).toBe("6688");
    expect(PAUSCHALE_KONTEN.entfernung.SKR03.name).toMatch(/Wohnung und Betriebsstätte.*abziehbarer Anteil/);
  });
});
