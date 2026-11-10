import { describe, expect, it } from "vitest";
import { outdatedAfterRender, renderDelay, rendersOnDemand } from "./vorschau-render.ts";

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
    expect(outdatedAfterRender("alt", "neu", 2500)).toBe(true);
  });

  it("verschwindet, wenn das Blatt zum Formular passt", () => {
    expect(outdatedAfterRender("neu", "neu", 2500)).toBe(false);
  });

  it("entfällt bei schnellen Läufen, dann setzt die Entprellung neu", () => {
    expect(outdatedAfterRender("alt", "neu", 300)).toBe(false);
  });
});
