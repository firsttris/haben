import type { Suggestion } from "@haben/core";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children: ReactNode; params: { id: string } }) => createElement("a", { href: `/belege/${params.id}` }, children),
}));
import { DauerbelegVorschlaege } from "./DauerbelegVorschlaege.tsx";

type Vorschlag = Suggestion & { selfAssessed: boolean };

const vorschlag = (selfAssessed: boolean): Vorschlag => ({
  item: {
    type: "document",
    id: "beleg-1",
    number: "MV-2026-17",
    date: "2026-10-31",
    dueDate: "2026-11-03",
    open: -100_000,
    partyName: "Hafen Immobilien GmbH",
    partyIbans: [],
  },
  score: 100,
  reasons: ["Betrag stimmt genau"],
  amount: -100_000,
  selfAssessed,
});

const render = (suggestions: Vorschlag[]) => renderToStaticMarkup(createElement(DauerbelegVorschlaege, { suggestions, busy: false, onBook: () => {} }));

/*
 * #1595: Einen Beleg mit § 13b oder innergemeinschaftlichem Erwerb bucht nur die Belegseite, deren Rückfrage bei § 13b EU
 * und Erwerb die USt-IdNr. beim BZSt prüft (#1568). Im Bankabgleich bleibt dafür nur „Beleg prüfen“.
 */
describe("Dauerbeleg, noch zu prüfen", () => {
  it("bietet ohne § 13b oder Erwerb Prüfen und Buchen an", () => {
    const html = render([vorschlag(false)]);
    expect(html).toContain('<a href="/belege/beleg-1">Beleg prüfen</a>');
    expect(html).toContain("Buchen und zuordnen");
    expect(html).toContain("Bucht den Beleg wie „Bestätigen und buchen“");
  });

  it("bietet mit selbst geschuldeter Steuer nur „Beleg prüfen“ an und sagt, wo gebucht wird", () => {
    const html = render([vorschlag(true)]);
    expect(html).toContain('<a href="/belege/beleg-1">Beleg prüfen</a>');
    expect(html).not.toContain("Buchen und zuordnen");
    expect(html).not.toContain("Bucht den Beleg wie");
    expect(html).toContain("Mit § 13b oder innergemeinschaftlichem Erwerb buchst du den Beleg auf der Belegseite.");
  });
});
