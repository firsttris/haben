import { describe, expect, it } from "vitest";
import { PERSONENKONTO_BEREICH, personenkontoProblem, parsePersonenkonto } from "./personenkonten.ts";

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
