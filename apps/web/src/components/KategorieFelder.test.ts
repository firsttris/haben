import { direktKategorienFuer } from "@haben/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KategorieFelder, type KategorieWahl } from "./KategorieFelder.tsx";

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
    expect(html).toMatch(/<option value="nichtSteuerbar" selected="">Nicht steuerbare Einnahme \(z\. B\. Schadenersatz\)<\/option>/);
    expect(html).not.toContain("Steuersatz");
    expect(html).toContain("Ob echter Schadenersatz vorliegt");
  });

  it("bietet sie Kleinunternehmern nicht an", () => {
    expect(render(true, { kategorie: "erloese", steuersatz: 0 })).not.toContain('value="nichtSteuerbar"');
  });

  it("zeigt eine schon gewählte nicht steuerbare Einnahme auch heute als Kleinunternehmer als gewählt", () => {
    const html = render(true, { kategorie: "nichtSteuerbar", steuersatz: 0 });
    expect(html).toMatch(/<option value="nichtSteuerbar" selected="">/);
    expect(html).toContain("Ob echter Schadenersatz vorliegt");
  });
});
