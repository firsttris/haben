import { describe, expect, it } from "vitest";
import {
  naechstesPersonenkonto,
  PERSONENKONTO_BEREICH,
  parsePersonenkonto,
  personenkontenBetroffen,
  personenkontenIm,
  personenkontoProblem,
} from "./personenkonten.ts";

describe("DATEV-Personenkonten am Kontakt", () => {
  it("hat die Bereiche nach DATEV-Kontenrahmen SKR03 und SKR04 2026 bei vierstelligen Sachkonten", () => {
    expect(PERSONENKONTO_BEREICH.debitor).toEqual({ von: 10000, bis: 69999 });
    expect(PERSONENKONTO_BEREICH.kreditor).toEqual({ von: 70000, bis: 99999 });
  });

  it("nimmt Nummern an den Grenzen der Bereiche an", () => {
    for (const nr of [10000, 10042, 69999]) expect(personenkontoProblem("debitor", nr)).toBeNull();
    for (const nr of [70000, 70087, 99999]) expect(personenkontoProblem("kreditor", nr)).toBeNull();
  });

  it("lehnt Nummern außerhalb des Bereichs der Rolle ab, statt sie zu kürzen", () => {
    expect(personenkontoProblem("debitor", 9999)).toBe("Debitor: 10000 bis 69999 (fünfstellig, nach DATEV-Kontenrahmen)");
    expect(personenkontoProblem("debitor", 70087)).toMatch(/^Debitor: 10000 bis 69999/);
    expect(personenkontoProblem("kreditor", 69999)).toBe("Kreditor: 70000 bis 99999 (fünfstellig, nach DATEV-Kontenrahmen)");
    expect(personenkontoProblem("kreditor", 100000)).toMatch(/^Kreditor/);
    expect(personenkontoProblem("debitor", 10000.5)).toMatch(/^Debitor/);
  });

  it("liest eine Nummer aus Text: leer ist keine, nur Ziffern zählen", () => {
    expect(parsePersonenkonto("debitor", "")).toEqual({ ok: true, value: null });
    expect(parsePersonenkonto("debitor", " 10042 ")).toEqual({ ok: true, value: 10042 });
    expect(parsePersonenkonto("kreditor", "70087")).toEqual({ ok: true, value: 70087 });
    expect(parsePersonenkonto("debitor", "D-10042")).toEqual({ ok: false, error: "Debitor: „D-10042“ ist keine Nummer" });
    expect(parsePersonenkonto("debitor", "1004")).toEqual({ ok: false, error: "Debitor: 10000 bis 69999 (fünfstellig, nach DATEV-Kontenrahmen)" });
    expect(parsePersonenkonto("kreditor", "100000")).toMatchObject({ ok: false });
  });
});

describe("Schalter „DATEV-Personenkonten“ ab einem Jahr", () => {
  it("gilt ab dem Jahresbeginn des gewählten Jahres; null = Sammelkonten", () => {
    expect(personenkontenIm(2026, 2025)).toBe(false);
    expect(personenkontenIm(2026, 2026)).toBe(true);
    expect(personenkontenIm(2026, 2030)).toBe(true);
    expect(personenkontenIm(null, 2026)).toBe(false);
  });

  it("nennt die gebuchten Jahre bis heute, die sich änderten; künftige Jahre nie", () => {
    const gebucht = [2024, 2025, 2026, 2026];
    expect(personenkontenBetroffen(null, 2027, gebucht, 2026)).toEqual([]);
    expect(personenkontenBetroffen(null, 2026, gebucht, 2026)).toEqual([2026]);
    expect(personenkontenBetroffen(null, 2025, gebucht, 2026)).toEqual([2025, 2026]);
    expect(personenkontenBetroffen(2025, null, gebucht, 2026)).toEqual([2025, 2026]);
    expect(personenkontenBetroffen(2025, 2026, gebucht, 2026)).toEqual([2025]);
    expect(personenkontenBetroffen(2026, 2026, gebucht, 2026)).toEqual([]);
    // Ein Jahr ohne Buchungen hat keinen Stapel, der sich ändern könnte
    expect(personenkontenBetroffen(null, 2023, [2025], 2026)).toEqual([2025]);
    // Buchungen im nächsten Jahr (vorab erfasst) zählen nicht als schon abgegeben
    expect(personenkontenBetroffen(null, 2027, [2027], 2026)).toEqual([]);
  });
});

describe("Nächste freie Personenkontonummer", () => {
  it("fängt am Anfang des Bereichs an und zählt nach der höchsten je vergebenen weiter", () => {
    expect(naechstesPersonenkonto("debitor", [])).toBe(10000);
    expect(naechstesPersonenkonto("kreditor", [])).toBe(70000);
    expect(naechstesPersonenkonto("debitor", [10000, 10001, 10005])).toBe(10006);
    // Nummern der anderen Rolle zählen nicht
    expect(naechstesPersonenkonto("kreditor", [10042, 70087])).toBe(70088);
  });

  it("nimmt am Ende des Bereichs die erste nie vergebene Nummer und meldet einen vollen Bereich", () => {
    expect(naechstesPersonenkonto("debitor", [10000, 69999])).toBe(10001);
    expect(
      naechstesPersonenkonto(
        "kreditor",
        Array.from({ length: 30000 }, (_, i) => 70000 + i),
      ),
    ).toBeNull();
  });
});
