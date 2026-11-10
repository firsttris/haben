import { describe, expect, it } from "vitest";
import { renderDelay, rendersOnDemand } from "./vorschau-render.ts";

describe("Takt der echten Vorschau", () => {
  it("wartet mindestens eine halbe Sekunde", () => {
    expect(renderDelay(0)).toBe(500);
    expect(renderDelay(20)).toBe(500);
    expect(renderDelay(250)).toBe(500);
  });

  it("wartet bei langsamen Rechnern das Doppelte der letzten Renderzeit", () => {
    expect(renderDelay(600)).toBe(1200);
  });

  it("rendert erst über zwei Sekunden nur noch auf Knopfdruck", () => {
    expect(rendersOnDemand(2000)).toBe(false);
    expect(rendersOnDemand(2001)).toBe(true);
  });
});
