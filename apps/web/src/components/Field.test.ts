import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Combobox } from "./Combobox.tsx";
import { Field, type FieldControlProps } from "./Field.tsx";

const input = (control: FieldControlProps) => createElement("input", control);

/** Rendert das Feld und liest die Verknüpfungen aus dem HTML; ein DOM braucht die Prüfung nicht */
function render(props: Omit<ComponentProps<typeof Field>, "label" | "children">, control: (control: FieldControlProps) => ReactNode = input) {
  const html = renderToStaticMarkup(createElement(() => Field({ label: "IBAN", ...props, children: control })));
  const attribute = (tag: string, name: string) => new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`).exec(html)?.[1];
  return {
    html,
    labelFor: attribute("label", "for"),
    controlId: attribute("input", "id"),
    describedBy: attribute("input", "aria-describedby"),
    invalid: attribute("input", "aria-invalid"),
    hintId: /id="([^"]*)" class="field-hint"/.exec(html)?.[1],
    errorId: /id="([^"]*)" class="field-error"/.exec(html)?.[1],
  };
}

describe("Field", () => {
  it("verbindet den Feldnamen über for und id mit dem Feld", () => {
    const { html, labelFor, controlId } = render({});
    expect(labelFor).toBeTruthy();
    expect(labelFor).toBe(controlId);
    expect(html).toContain('<label class="field-label"');
  });

  it("hält Hinweis und Feld aus dem label heraus: Nur der Feldname klickt, der Hinweis zählt nicht zum Namen", () => {
    const { html } = render({ hint: "Nur deutsche Konten" });
    expect(html).toMatch(/^<div class="field">/);
    expect(/<label[^>]*>(.*?)<\/label>/.exec(html)?.[1]).toBe("IBAN");
  });

  it("setzt ohne Hinweis und Fehler weder aria-describedby noch aria-invalid", () => {
    const { describedBy, invalid } = render({});
    expect(describedBy).toBeUndefined();
    expect(invalid).toBeUndefined();
  });

  it("verweist mit aria-describedby auf den Hinweis", () => {
    const { describedBy, hintId, invalid } = render({ hint: "Nur deutsche Konten" });
    expect(hintId).toBeTruthy();
    expect(describedBy).toBe(hintId);
    expect(invalid).toBeUndefined();
  });

  it("markiert einen Fehler mit aria-invalid und verweist auf die Meldung", () => {
    const { describedBy, errorId, invalid } = render({ error: "Prüfziffer stimmt nicht" });
    expect(errorId).toBeTruthy();
    expect(describedBy).toBe(errorId);
    expect(invalid).toBe("true");
  });

  it("nennt den Hinweis von außerhalb, den eigenen Hinweis und den Fehler zusammen", () => {
    const { describedBy, hintId, errorId } = render({ describedBy: "gemeinsam", hint: "Nur deutsche Konten", error: "Prüfziffer stimmt nicht" });
    expect(describedBy).toBe(`gemeinsam ${hintId} ${errorId}`);
  });

  it("zeigt leere Hinweise nicht und verweist nicht auf sie", () => {
    const { html, describedBy } = render({ hint: "", error: "" });
    expect(html).not.toContain("field-hint");
    expect(html).not.toContain("field-error");
    expect(describedBy).toBeUndefined();
  });

  it("lässt eigene Eigenschaften des Felds unberührt", () => {
    const { html } = render({}, (control) => createElement("select", { ...control, name: "land" }));
    expect(html).toContain('name="land"');
    expect(html).toContain("<select");
  });

  it("gibt className und style an die Hülle weiter", () => {
    const { html } = render({ className: "breit", style: { gridColumn: "1 / -1" } });
    expect(html).toMatch(/^<div class="field breit" style="grid-column:1 \/ -1">/);
  });

  it("meldet einen Fehler nur auf Wunsch als Alert", () => {
    expect(render({ error: "Fehlt" }).html).not.toContain('role="alert"');
    expect(render({ error: "Fehlt", announceError: true }).html).toContain('class="field-error" role="alert"');
  });

  it("verbindet auch die Combobox mit Name, Hinweis und Fehler", () => {
    const { labelFor, controlId, describedBy, hintId, errorId, invalid } = render({ hint: "Suche nach Name", error: "Fehlt" }, (control) =>
      createElement(Combobox<string>, {
        ...control,
        value: "",
        onInput: () => {},
        search: () => ({ hits: [], total: 0 }),
        describe: (item) => ({ key: item, label: item }),
        onPick: () => {},
      }),
    );
    expect(labelFor).toBe(controlId);
    expect(describedBy).toBe(`${hintId} ${errorId}`);
    expect(invalid).toBe("true");
  });
});
