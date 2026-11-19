import { describe, expect, it } from "vitest";
import { PRIVATANTEIL_FEHLER, parseAnteil, parsePrivatanteil, privatanteilVorgabe } from "./anteil.ts";

describe("Anteil der Anteilseigner", () => {
  it("liest wie jedes Prozentfeld über parsePercent, ohne Kommazahl dazwischen (#1222)", () => {
    expect(parseAnteil("50")).toBe(5000);
    expect(parseAnteil("33,33 %")).toBe(3333);
    expect(parseAnteil("33.33")).toBe(3333);
    expect(parseAnteil("100")).toBe(10_000);
  });

  it("weist 0, mehr als 100 % und mehr als zwei Nachkommastellen zurück", () => {
    for (const text of ["0", "100,01", "33,333", "1e1", ""]) expect(parseAnteil(text), text).toBeNull();
  });
});

describe("Privatanteil am Beleg und in den Firmendaten", () => {
  it("liest ganze Prozent von 0 bis 100, auch mit „%“; leer ist 0 (#1221, #1222)", () => {
    for (const [text, anteil] of [
      ["20", 20],
      ["20 %", 20],
      ["", 0],
      ["100", 100],
    ] as const)
      expect(parsePrivatanteil(text), text).toBe(anteil);
  });

  it("setzt die Vorgabe der Kategorie als Text ein, ohne Vorgabe leer", () => {
    expect(privatanteilVorgabe({ telefon: 20 }, "telefon")).toBe("20");
    expect(privatanteilVorgabe({ telefon: 20 }, "buero")).toBe("");
    expect(privatanteilVorgabe({ internet: 0 }, "internet")).toBe("");
  });

  it("weist Kommazahlen, mehr als 100 und Negatives zurück", () => {
    for (const text of ["20,5", "101", "-5", "abc"]) expect(parsePrivatanteil(text), text).toBeNull();
    expect(PRIVATANTEIL_FEHLER).toBe("Trag eine ganze Zahl von 0 bis 100 ein.");
  });
});
