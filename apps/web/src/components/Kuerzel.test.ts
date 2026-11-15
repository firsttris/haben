import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Kuerzel } from "./Kuerzel.tsx";

describe("Kuerzel", () => {
  it("zeigt auf dem Server Strg, je Taste ein Kästchen", () => {
    // Der Server kennt das System nicht; erst der Browser tauscht am Mac gegen ⌘
    const html = renderToStaticMarkup(createElement(Kuerzel, { tasten: ["mod", "K"] }));
    expect(html).toBe('<span class="kuerzel"><kbd>Strg</kbd><kbd>K</kbd></span>');
  });

  it("übernimmt Klasse und weitere Attribute", () => {
    const html = renderToStaticMarkup(createElement(Kuerzel, { tasten: ["Esc"], className: "nav-kbd", "aria-hidden": true }));
    expect(html).toBe('<span aria-hidden="true" class="kuerzel nav-kbd"><kbd>Esc</kbd></span>');
  });
});
