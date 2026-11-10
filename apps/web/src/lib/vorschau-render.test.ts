import { describe, expect, it } from "vitest";
import { afterRender, renderDelay, rendersOnDemand } from "./vorschau-render.ts";

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

describe("Hinweis auf einen veralteten Stand nach dem Rendern", () => {
  it("bleibt, wenn sich das Formular während eines langsamen Laufs geändert hat", () => {
    expect(afterRender("alt", "neu", 2500)).toBe("knopf");
  });

  it("verschwindet, wenn das Blatt zum Formular passt", () => {
    expect(afterRender("neu", "neu", 2500)).toBe("fertig");
  });

  it("setzt nach einem schnellen Lauf gleich neu, wenn das Formular weiter ist", () => {
    expect(afterRender("alt", "neu", 300)).toBe("neu");
  });
});
