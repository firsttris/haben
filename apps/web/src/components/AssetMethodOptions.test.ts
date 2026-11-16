import { formatEuro, GWG_LIMIT, SAMMELPOSTEN_MAX, SAMMELPOSTEN_MIN, type AssetMethod } from "@haben/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssetMethodOptions, parseRatePercent } from "./AssetMethodOptions.tsx";

const render = (method: AssetMethod) =>
  renderToStaticMarkup(
    createElement(AssetMethodOptions, {
      method,
      acquisitionDate: "2026-02-10",
      lifeMonths: 72,
      rate: "",
      onRate: () => undefined,
      linearFrom: "",
      onLinearFrom: () => undefined,
      memo: false,
      onMemo: () => undefined,
      locked: false,
      switchEditable: true,
    }),
  );

describe("Erklärung der Methoden in Alltagssprache", () => {
  // Wie die Auswahl: „800 €“ statt „800,00 €“
  const euro = (cents: number) => formatEuro(cents).replace(",00", "");

  it("GWG und Sammelposten: erst die Erklärung, dann das Fachwort, Grenzen aus den Konstanten von @haben/core", () => {
    const gwg = render("gwg");
    expect(gwg).toContain(`bis ${euro(GWG_LIMIT)} netto`);
    expect(gwg).toMatch(/sofort als Kosten[\s\S]*\(GWG\)/);
    expect(gwg).toContain('id="method-hint"');
    const sammelposten = render("sammelposten");
    expect(sammelposten).toContain(`${euro(SAMMELPOSTEN_MIN)} bis ${euro(SAMMELPOSTEN_MAX)} netto`);
    expect(sammelposten).toMatch(/über fünf Jahre[\s\S]*Sammelposten\./);
  });

  it("degressiv: Erklärung vor dem Höchstsatz; linear braucht keine", () => {
    expect(render("degressiv")).toMatch(/festen Prozentsatz vom Restwert[\s\S]*Höchstens/);
    expect(render("linear")).not.toContain("field-hint");
  });
});

describe("Satz der degressiven AfA", () => {
  it("liest wie jedes Prozentfeld über parsePercent, auch mit „%“ (#1222)", () => {
    expect(parseRatePercent("25")).toBe(2500);
    expect(parseRatePercent("23,07")).toBe(2307);
    expect(parseRatePercent("23.07")).toBe(2307);
    expect(parseRatePercent("25 %")).toBe(2500);
  });

  it("leer heißt Höchstsatz, Ungültiges und 100 % und mehr sind NaN", () => {
    expect(parseRatePercent(" ")).toBeNull();
    for (const text of ["abc", "100", "23,075", "-5"]) expect(parseRatePercent(text), text).toBeNaN();
  });
});
