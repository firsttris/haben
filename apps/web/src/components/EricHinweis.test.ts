import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, search }: { children: ReactNode; to: string; search: { bereich: string } }) =>
    createElement("a", { href: `${to}?bereich=${search.bereich}` }, children),
}));
import { EricHinweis } from "./EricHinweis.tsx";

describe("ERiC-Hinweis auf den Sendeseiten", () => {
  it("nennt in Klartext, dass nichts ans Finanzamt geht, und verlinkt auf den ELSTER-Bereich der Einstellungen", () => {
    const html = renderToStaticMarkup(createElement(EricHinweis));
    expect(html).toContain("ERiC ist nicht eingerichtet. Prüfen und Senden laufen simuliert, nichts geht an das Finanzamt.");
    expect(html).toContain('<a href="/einstellungen?bereich=elster">ERiC einrichten</a>');
    expect(html).toContain('role="status"');
  });

  it("nennt auf Wunsch ein anderes Amt", () => {
    const html = renderToStaticMarkup(createElement(EricHinweis, { empfaenger: "Bundeszentralamt für Steuern" }));
    expect(html).toContain("nichts geht an das Bundeszentralamt für Steuern.");
    expect(html).not.toContain("Finanzamt");
  });
});
