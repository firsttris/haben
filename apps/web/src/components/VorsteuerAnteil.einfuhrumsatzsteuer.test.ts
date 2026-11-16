import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VorsteuerAnteil } from "./VorsteuerAnteil.tsx";

function preview(patch: Partial<ComponentProps<typeof VorsteuerAnteil>> = {}) {
  const html = renderToStaticMarkup(
    createElement(VorsteuerAnteil, {
      value: "100",
      rows: [{ key: 1, taxRate: 0, net: 38_000, tax: 0, vorsteuerAnteil: "" }],
      company: { kleinunternehmer: false, ohneVorsteuerabzug: false },
      booked: false,
      storedDeduction: true,
      privateShare: 0,
      asset: false,
      onChange() {},
      onRateChange() {},
      ...{ importVat: true },
      ...patch,
    }),
  );
  return html.match(/<p[^>]*aria-label="Vorsteuervorschau"[^>]*>(.*?)<\/p>/s)![1]!;
}

describe("Vorsteuervorschau eines Einfuhrabgabenbescheids", () => {
  it("weist den Steuerbetrag des Zolls als Vorsteuer und ohne Aufwand aus", () => {
    const html = preview();
    expect(html).toContain('Abziehbare Vorsteuer <strong class="amount">380,00 €</strong>');
    expect(html).toContain('Aufwand <span class="amount">0,00 €</span>');
    expect(html).toContain('Nicht abziehbare Steuer <span class="amount">0,00 €</span>');
  });

  it("erhält bei einer Gutschrift den negativen Steuerbetrag ohne negativen Aufwand", () => {
    const html = preview({ rows: [{ key: 1, taxRate: 0, net: -38_000, tax: 0, vorsteuerAnteil: "" }] });
    expect(html).toContain('Abziehbare Vorsteuer <strong class="amount">-380,00 €</strong>');
    expect(html).toContain('Aufwand <span class="amount">0,00 €</span>');
  });

  it.each([
    { name: "halber Belegabzug", patch: { value: "50" } },
    { name: "halber Satzabzug", patch: { rows: [{ key: 1, taxRate: 0, net: 38_000, tax: 0, vorsteuerAnteil: "50" }] } },
    { name: "Kleinunternehmer", patch: { company: { kleinunternehmer: true, ohneVorsteuerabzug: false } } },
    { name: "Firmenvorgabe ohne Abzug", patch: { value: "", company: { kleinunternehmer: false, ohneVorsteuerabzug: true } } },
    { name: "Privatanteil", patch: { privateShare: 20 } },
    { name: "Steuer auf den Zollbetrag", patch: { rows: [{ key: 1, taxRate: 1900, net: 38_000, tax: 7_220, vorsteuerAnteil: "" }] } },
  ])("zeigt bei $name die bestehende EUSt-Grenze ohne berechnete Beträge", ({ patch }) => {
    const html = preview(patch);
    expect(html).toContain("Einfuhrumsatzsteuer");
    expect(html).toContain("vollständigem Vorsteuerabzug");
    expect(html).not.toContain('class="amount"');
  });

  it.each([{ value: "100,01" }, { rows: [{ key: 1, taxRate: 0, net: null, tax: 0, vorsteuerAnteil: "" }] }])(
    "zeigt für ungültige Eingaben keine Zahlen",
    (patch) => {
      const html = preview(patch);
      expect(html).toContain("Vorschau nach gültiger Eingabe");
      expect(html).not.toContain('class="amount"');
    },
  );

  it("verwendet bei gebuchten Altbelegen den gespeicherten Abzug trotz heutiger KU-Firma", () => {
    const html = preview({ value: "", booked: true, company: { kleinunternehmer: true, ohneVorsteuerabzug: true } });
    expect(html).toContain('Abziehbare Vorsteuer <strong class="amount">380,00 €</strong>');
    expect(html).toContain('Aufwand <span class="amount">0,00 €</span>');
  });

  it("berechnet aus einem alten gebuchten Beleg ohne Abzug keine gültige EUSt-Vorschau", () => {
    const html = preview({ value: "", booked: true, storedDeduction: false });
    expect(html).toContain("Einfuhrumsatzsteuer");
    expect(html).not.toContain('class="amount"');
  });
});
