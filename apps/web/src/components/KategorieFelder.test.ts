import { direktKategorienFuer } from "@haben/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aufladungWahl, KategorieFelder, kategorieAngebot, type KategorieWahl } from "./KategorieFelder.tsx";

/*
 * Kategorie und Steuersatz unter „Direkt buchen“ (#1131): Kleinunternehmer bekommen die nicht steuerbare Einnahme nicht
 * angeboten; ist sie schon gewählt (gelernter Vorschlag aus einem Monat mit Regelbesteuerung), steht sie trotzdem in der
 * Auswahl, sonst zeigte das Feld „Erlöse“, gebucht würde aber ohne Umsatzsteuer. Alle Daten sind erfunden.
 */

const render = (kleinunternehmer: boolean, value: KategorieWahl) =>
  renderToStaticMarkup(
    createElement(() =>
      KategorieFelder({ options: { kategorien: direktKategorienFuer(), kleinunternehmer }, value, amount: 12_50, onChange: () => undefined }),
    ),
  );

describe("KategorieFelder", () => {
  it("bietet die nicht steuerbare Einnahme bei Regelbesteuerung an, ohne Feld für den Steuersatz", () => {
    const html = render(false, { kategorie: "nichtSteuerbar", steuersatz: 0 });
    expect(html).toContain('value="Nicht steuerbare Einnahme (z. B. Schadenersatz)"');
    expect(html).not.toContain("Steuersatz");
    expect(html).toContain("Ob echter Schadenersatz vorliegt");
  });

  it("bietet sie Kleinunternehmern nicht an", () => {
    const optionen = { kategorien: direktKategorienFuer(), kleinunternehmer: true };
    expect(kategorieAngebot(optionen, "erloese").map((e) => e.value)).not.toContain("nichtSteuerbar");
    expect(kategorieAngebot({ ...optionen, kleinunternehmer: false }, "erloese").map((e) => e.value)).toContain("nichtSteuerbar");
  });

  it("zeigt eine schon gewählte nicht steuerbare Einnahme auch heute als Kleinunternehmer als gewählt", () => {
    const html = render(true, { kategorie: "nichtSteuerbar", steuersatz: 0 });
    expect(html).toContain('value="Nicht steuerbare Einnahme (z. B. Schadenersatz)"');
    expect(kategorieAngebot({ kategorien: direktKategorienFuer(), kleinunternehmer: true }, "nichtSteuerbar").map((e) => e.value)).toContain("nichtSteuerbar");
    expect(html).toContain("Ob echter Schadenersatz vorliegt");
  });
});

/*
 * Aufladung eines Guthabens (#1356): nur Ausgaben, immer ohne Steuersatz. Ein gelernter Vorschlag (#295) kann noch eine
 * Einnahme oder einen Satz mitbringen; Anzeige und Buchung lesen beide aufladungWahl.
 */
describe("aufladungWahl", () => {
  it("lässt eine Ausgabe stehen, mit 0 %", () => {
    expect(aufladungWahl({ kategorie: "kfzBetrieb", steuersatz: 0 })).toEqual({ kategorie: "kfzBetrieb", steuersatz: 0 });
  });

  it("macht aus einer Einnahme „Sonstiger Aufwand“", () => {
    expect(aufladungWahl({ kategorie: "erloese", steuersatz: 0 })).toEqual({ kategorie: "sonstiges", steuersatz: 0 });
  });

  it("setzt einen mitgebrachten Steuersatz auf 0", () => {
    expect(aufladungWahl({ kategorie: "erloese", steuersatz: 1900 })).toEqual({ kategorie: "sonstiges", steuersatz: 0 });
    expect(aufladungWahl({ kategorie: "kfzBetrieb", steuersatz: 1900 })).toEqual({ kategorie: "kfzBetrieb", steuersatz: 0 });
  });
});
