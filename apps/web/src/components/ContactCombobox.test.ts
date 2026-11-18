import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type ContactChoice, ContactCombobox } from "./ContactCombobox.tsx";

const kontakt: ContactChoice = {
  id: "k1",
  name: "Hetzner Online GmbH",
  ort: "Gunzenhausen",
  nummer: null,
  isCustomer: false,
  isSupplier: true,
  ustId: "DE812871812",
};

const render = (props: Partial<Parameters<typeof ContactCombobox>[0]>) =>
  renderToStaticMarkup(
    createElement(ContactCombobox, {
      id: "x",
      "aria-describedby": undefined,
      "aria-invalid": undefined,
      rolle: "lieferant",
      contacts: [kontakt],
      contactId: "",
      onChoose: () => {},
      ...props,
    }),
  );

describe("ContactCombobox", () => {
  it("zeigt ohne freitext den gewählten Kontakt mit Ort", () => {
    expect(render({ contactId: "k1" })).toContain('value="Hetzner Online GmbH · Gunzenhausen"');
  });

  it("zeigt mit freitext den eingetragenen Namen, auch ohne Kontakt, in einem einzigen Feld", () => {
    const html = render({ freitext: { value: "Kiosk am Markt", onInput: () => {} } });
    expect(html).toContain('value="Kiosk am Markt"');
    expect(html.match(/<input /g)).toHaveLength(1);
    expect(html).toContain('role="combobox"');
  });

  it("zeigt mit freitext und Kontakt den Namen am Beleg, nicht den Kontakt mit Ort", () => {
    expect(render({ contactId: "k1", freitext: { value: "Hetzner Online GmbH", onInput: () => {} } })).toContain('value="Hetzner Online GmbH"');
  });
});
