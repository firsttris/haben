import type { SelfAssessedTax } from "@haben/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BelegUmsatzsteuer } from "./BelegUmsatzsteuer.tsx";

const render = (value: SelfAssessedTax | null, looksLikeReverseCharge = false) =>
  renderToStaticMarkup(createElement(BelegUmsatzsteuer, { value, onChange: () => {}, looksLikeReverseCharge }));

/** Der Text im Hinweis am Feld, ohne die eingeklappten Details */
const hinweis = (html: string) => /class="field-hint">(.*?)<\/span>/.exec(html)?.[1] ?? "";
const details = (html: string) => /<details>(.*?)<\/details>/.exec(html)?.[1] ?? "";

describe("Umsatzsteuer am Beleg als Frage", () => {
  it("fragt in Alltagssprache und behält die Werte der Auswahl", () => {
    const html = render(null);
    expect(html).toContain("Wer schuldet die Umsatzsteuer?");
    expect(html).toContain("Der Lieferant (normaler Beleg)");
    expect(hinweis(html)).toContain("Kleinunternehmern");
    for (const value of ["", "eu", "drittland", "ig_erwerb"]) expect(html).toContain(`<option value="${value}"`);
    expect(details(html)).toBe("");
  });

  it("nennt Kennzahlen nur in den Details, den Fachbegriff aber im Hinweis", () => {
    for (const value of ["eu", "drittland", "ig_erwerb"] as const) {
      const html = render(value);
      expect(hinweis(html), value).not.toMatch(/Kz|Kennzahl/);
      expect(details(html), value).toMatch(/Kz \d+/);
    }
    expect(hinweis(render("eu"))).toContain("Reverse Charge");
    expect(hinweis(render("ig_erwerb"))).toContain("Erwerbsteuer");
  });

  it("nennt die Kennzahlen je Wahl wie die Voranmeldung", () => {
    expect(details(render("eu"))).toContain("Kz 46");
    expect(details(render("eu"))).toContain("Kz 47");
    expect(details(render("eu"))).toContain("Kz 67");
    expect(details(render("drittland"))).toContain("Kz 84");
    expect(details(render("drittland"))).toContain("Kz 85");
    expect(details(render("drittland"))).toContain("Kz 67");
    expect(details(render("ig_erwerb"))).toContain("Kz 89");
    expect(details(render("ig_erwerb"))).toContain("Kz 93");
    expect(details(render("ig_erwerb"))).toContain("Kz 61");
  });

  it("rät bei Lieferant aus der EU ohne Steuer zu Reverse Charge oder Erwerb", () => {
    expect(hinweis(render(null, true))).toContain("Reverse Charge (§ 13b)");
    expect(hinweis(render(null, false))).not.toContain("Reverse Charge");
  });
});
