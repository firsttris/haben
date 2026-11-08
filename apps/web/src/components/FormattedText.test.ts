import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormattedText } from "./FormattedText.tsx";

describe("Formatierter Belegtext", () => {
  it("stellt dieselben drei Auszeichnungen wie das PDF dar", () => {
    const html = renderToStaticMarkup(createElement(FormattedText, { text: "*Fett* _Kursiv_ __Unterstrichen__" }));
    expect(html).toContain("<strong>Fett</strong>");
    expect(html).toContain("<em>Kursiv</em>");
    expect(html).toContain("<u>Unterstrichen</u>");
  });

  it("führt HTML und Ereignishandler in Eingaben nicht aus", () => {
    const html = renderToStaticMarkup(createElement(FormattedText, { text: '*<img src=x onerror="alert(1)">*' }));
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).toContain("<strong>");
  });
});
