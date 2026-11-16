import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field } from "./Field.tsx";
import { MonthPicker } from "./MonthPicker.tsx";

describe("MonthPicker", () => {
  it("verbindet Auslöser über Field mit Name, Hinweis und Fehler", () => {
    const html = renderToStaticMarkup(
      createElement(() =>
        Field({
          label: "Monat",
          hint: "Zeitraum der Pauschale",
          error: "Wähle den Monat.",
          children: (control) => createElement(MonthPicker, { ...control, value: "2026-11", onChange: () => {} }),
        }),
      ),
    );
    const labelFor = /<label[^>]*\sfor="([^"]*)"/.exec(html)?.[1];
    const buttonId = /<button[^>]*\sid="([^"]*)"/.exec(html)?.[1];
    const invalid = /<button[^>]*\saria-invalid="([^"]*)"/.exec(html)?.[1];
    const describedBy = /<button[^>]*\saria-describedby="([^"]*)"/.exec(html)?.[1];
    expect(labelFor).toBeTruthy();
    expect(labelFor).toBe(buttonId);
    expect(invalid).toBe("true");
    expect(describedBy).toContain("-hint");
    expect(describedBy).toContain("-error");
    expect(html).toContain("November 2026");
  });

  it("zeigt den Platzhalter, wenn noch kein Monat gewählt ist", () => {
    const html = renderToStaticMarkup(createElement(MonthPicker, { value: "", onChange: () => {} }));
    expect(html).toContain("Monat wählen");
    expect(html).toContain("month-picker-placeholder");
  });

  it("gibt bei gesetztem name ein verstecktes Eingabefeld mit", () => {
    const html = renderToStaticMarkup(createElement(MonthPicker, { name: "month", value: "2026-05", onChange: () => {} }));
    expect(html).toContain('<input type="hidden" name="month" value="2026-05"/>');
    expect(html).toContain("Mai 2026");
  });
});
