import { describe, expect, it } from "vitest";
import { haeltKurs, imDreieck } from "./zielkurs.ts";

// Leiste 64px, Flyout ab x = 72, oben auf Höhe des Symbols „Verkauf“ (y 148) und 300px hoch
const PANEL = { left: 72, top: 148, bottom: 448 };

describe("imDreieck", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  const c = { x: 0, y: 10 };
  it("erkennt Punkte innen, auf dem Rand und außen", () => {
    expect(imDreieck({ x: 2, y: 2 }, a, b, c)).toBe(true);
    expect(imDreieck({ x: 5, y: 5 }, a, b, c)).toBe(true);
    expect(imDreieck({ x: 6, y: 6 }, a, b, c)).toBe(false);
  });
  it("hängt nicht vom Umlaufsinn ab", () => {
    expect(imDreieck({ x: 2, y: 2 }, a, c, b)).toBe(true);
  });
});

describe("haeltKurs", () => {
  it("schräg nach rechts unten zum Flyout: Kurs, auch über das Symbol darunter hinweg", () => {
    expect(haeltKurs({ x: 40, y: 168 }, { x: 48, y: 190 }, PANEL)).toBe(true);
  });
  it("senkrecht nach unten in der Leiste: kein Kurs, das nächste Symbol darf öffnen", () => {
    expect(haeltKurs({ x: 32, y: 168 }, { x: 32, y: 200 }, PANEL)).toBe(false);
  });
  it("nach links weg vom Flyout: kein Kurs", () => {
    expect(haeltKurs({ x: 40, y: 168 }, { x: 30, y: 180 }, PANEL)).toBe(false);
  });
  it("stillstehend: kein Kurs, wer anhält, meint das Symbol unter dem Zeiger", () => {
    expect(haeltKurs({ x: 48, y: 190 }, { x: 48, y: 190 }, PANEL)).toBe(false);
  });
  it("flach nach rechts unter dem Flyout vorbei: kein Kurs", () => {
    expect(haeltKurs({ x: 40, y: 460 }, { x: 60, y: 470 }, PANEL)).toBe(false);
  });
});
