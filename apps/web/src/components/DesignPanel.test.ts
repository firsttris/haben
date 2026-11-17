import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_DESIGN } from "@haben/core";
import { describe, expect, it, vi } from "vitest";
import { DesignOptionFields } from "./DesignPanel.tsx";
import type { LayoutHints } from "./LayoutHint.tsx";

// Die Server-Funktion zum Speichern braucht die Umgebung der App; gerendert wird hier nur
vi.mock("../server/functions/logo.ts", () => ({ saveLetterheadDesign: () => undefined }));

/** aria-describedby der Gruppe mit diesem Namen, aus dem HTML gelesen; ein DOM braucht die Prüfung nicht */
function beschreibung(hints: LayoutHints, gruppe: string): string[] {
  const html = renderToStaticMarkup(
    createElement(() => DesignOptionFields({ design: DEFAULT_DESIGN, onChange: () => {}, logoUpload: null, hints })),
  );
  const tag = new RegExp(`<div[^>]*aria-label="${gruppe}"[^>]*>`).exec(html)?.[0] ?? "";
  return /aria-describedby="([^"]*)"/.exec(tag)?.[1]?.split(" ") ?? [];
}

describe("Hinweise der Gestaltung an den Einstellungen", () => {
  it("verbindet den Hinweis zu „Mitte“ mit der Stelle des Logos", () => {
    const hints = { logoMitte: { aus: false, text: "Wirkt nicht auf Rechnungen: … „Mitte“ steht dort rechts." } } as LayoutHints;
    expect(beschreibung(hints, "Stelle des Logos")).toContain("layout-hint-logoMitte");
  });

  it("nennt beide Hinweise, wenn das Layout einer Art die Stelle gar nicht liest und das einer anderen nur logoLeft", () => {
    const hints = {
      logoPosition: { aus: false, text: "Wirkt nicht auf Rechnungen: …" },
      logoMitte: { aus: false, text: "Wirkt nicht auf Mahnungen: … „Mitte“ steht dort rechts." },
    } as LayoutHints;
    expect(beschreibung(hints, "Stelle des Logos")).toEqual(["layout-hint-logoPosition", "layout-hint-logoMitte"]);
  });
});
