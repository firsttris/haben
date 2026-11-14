import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VorsteuerAnteil, parseVorsteuerAnteil } from "./VorsteuerAnteil.tsx";

function render(patch: Partial<ComponentProps<typeof VorsteuerAnteil>> = {}) {
  return renderToStaticMarkup(
    createElement(VorsteuerAnteil, {
      value: "50",
      rows: [{ key: 1, taxRate: 1900, net: 10_000, tax: 1_900, vorsteuerAnteil: "" }],
      company: { kleinunternehmer: false, ohneVorsteuerabzug: false },
      booked: false,
      storedDeduction: true,
      privateShare: 0,
      asset: false,
      onChange() {},
      onRateChange() {},
      ...patch,
    }),
  );
}

describe("Vorsteueranteil im Beleg", () => {
  it.each([
    ["0", 0],
    ["100", 10_000],
    ["12,34", 1234],
    ["0,01", 1],
    [" 50,5 ", 5050],
  ])("liest %s direkt als Basispunkte", (text, points) => {
    expect(parseVorsteuerAnteil(text as string)).toBe(points);
  });
  it.each(["", "100,01", "-1", "12,345", "1.5", "1.000", "1e2"])("weist ungültigen Prozenttext %s zurück", (text) => {
    expect(parseVorsteuerAnteil(text)).toBeNull();
  });
  it("zeigt bei 50 % nur 9,50 € Vorsteuer und 109,50 € Aufwand", () => {
    const html = render();
    expect(html).toContain("9,50 €");
    expect(html).toContain("109,50 €");
    expect(html).toContain("Wirtschaftlich zugeordneter Anteil, unabhängig vom Privatanteil.");
  });
  it("übernimmt die Firmenvorgabe und lässt den Satz den Beleg überschreiben", () => {
    expect(render({ value: "", company: { kleinunternehmer: false, ohneVorsteuerabzug: true } })).toContain("119,00 €");
    expect(render({ rows: [{ key: 1, taxRate: 1900, net: 10_000, tax: 1_900, vorsteuerAnteil: "25" }] })).toContain("4,75 €");
  });
  it("sperrt KU auch bei eigenen Beleg- und Satzanteilen", () => {
    const html = render({
      company: { kleinunternehmer: true, ohneVorsteuerabzug: false },
      rows: [{ key: 1, taxRate: 1900, net: 10_000, tax: 1_900, vorsteuerAnteil: "100" }],
    });
    expect(html).toMatch(/<input[^>]*value="0"[^>]*disabled/);
    expect(html).toContain("119,00 €");
    expect(html).not.toContain("Abweichend je Steuersatz");
  });
  it("liest alte gebuchte Belege aus ihrem Boolean und ignoriert heutige Firmendaten", () => {
    const html = render({ value: "", booked: true, storedDeduction: false, company: { kleinunternehmer: false, ohneVorsteuerabzug: false } });
    expect(html).toContain("Gespeicherter Beleganteil: 0 %.");
    expect(html).toContain("119,00 €");
    expect(html).toContain("disabled");
    const full = render({ value: "", booked: true, company: { kleinunternehmer: true, ohneVorsteuerabzug: true } });
    expect(full).toContain("Gespeicherter Beleganteil: 100 %.");
    expect(full).toContain("19,00 €");
    expect(full).toContain("100,00 €");
  });
  it("zieht den Privatanteil zuerst ab und rundet negative Steuer symmetrisch", () => {
    expect(render({ privateShare: 20 })).toContain("87,60 €");
    expect(render({ rows: [{ key: 1, taxRate: 1900, net: -10_000, tax: -1_901, vorsteuerAnteil: "" }] })).toContain("-9,51 €");
  });
  it("zeigt bei ungültigem Anteil keine scheinbar gültige Vorschau", () => {
    const html = render({ value: "100,01" });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Vorschau nach gültiger Eingabe");
  });
});
