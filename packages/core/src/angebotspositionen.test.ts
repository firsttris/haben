import { describe, expect, it } from "vitest";
import { alternativeMain, chosenLines, choiceProblem, countsInTotal, quoteLineKindProblem } from "./angebotspositionen.ts";

const lines = [
  { position: 1, kind: null },
  { position: 2, kind: "alternative" as const },
  { position: 3, kind: "alternative" as const },
  { position: 4, kind: null },
  { position: 5, kind: "optional" as const },
  { position: 6, kind: "optional" as const },
];

describe("Optionale und alternative Positionen", () => {
  it("zählen nicht zur Summe des Angebots", () => {
    expect(lines.filter(countsInTotal).map((l) => l.position)).toEqual([1, 4]);
  });

  it("eine Alternative gehört zur Hauptposition davor", () => {
    expect(alternativeMain(lines, 2)).toBe(1);
    expect(alternativeMain(lines, 3)).toBe(1);
    expect(alternativeMain(lines, 4)).toBeNull();
  });

  it("Alternative braucht eine Hauptposition, mindestens eine Position zählt", () => {
    expect(quoteLineKindProblem(lines)).toBeNull();
    expect(quoteLineKindProblem([{ position: 1, kind: "alternative" }])).toBe("Position 1: Eine Alternative steht unter ihrer Hauptposition");
    expect(
      quoteLineKindProblem([
        { position: 1, kind: null },
        { position: 2, kind: "optional" },
        { position: 3, kind: "alternative" },
      ]),
    ).toBe("Position 3: Eine Alternative steht unter ihrer Hauptposition");
    expect(quoteLineKindProblem([{ position: 1, kind: "optional" }])).toBe("Mindestens eine Position muss zur Angebotssumme zählen");
  });

  it("ohne Auswahl gelten die Hauptpositionen, keine optionale", () => {
    expect(chosenLines(lines, []).map((l) => l.position)).toEqual([1, 4]);
  });

  it("gewählte Alternative ersetzt ihre Hauptposition, optionale kommen dazu", () => {
    expect(chosenLines(lines, [3, 6]).map((l) => l.position)).toEqual([3, 4, 6]);
  });

  it("je Hauptposition höchstens eine Alternative, nur Positionen des Angebots", () => {
    expect(choiceProblem(lines, [2, 3])).toBe("Zu Position 1 ist nur eine Alternative wählbar");
    expect(choiceProblem(lines, [1])).toBe("Position 1 ist weder optional noch Alternative");
    expect(choiceProblem(lines, [9])).toBe("Position 9 gibt es im Angebot nicht");
    expect(choiceProblem(lines, [2, 5, 6])).toBeNull();
  });
});
