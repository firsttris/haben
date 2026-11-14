import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FirmaWechsler } from "./FirmaWechsler.tsx";

const firmen = (anzahl: number) => Array.from({ length: anzahl }, (_, i) => ({ name: `Filiale ${i + 1}`, url: `https://filiale${i + 1}.example.de` }));
const html = (anzahl: number) => renderToStaticMarkup(createElement(FirmaWechsler, { andere: firmen(anzahl) }));

describe("FirmaWechsler", () => {
  it("hat bis 19 anderen Firmen kein Suchfeld, ab 20 eins", () => {
    expect(html(19)).not.toContain("<input");
    expect(html(20)).toContain('type="search"');
  });

  it("ist zugeklappt und nennt der Zeile die Liste, die sie aufklappt", () => {
    const zeile = /<button[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"/.exec(html(2));
    expect(zeile).not.toBeNull();
    expect(html(2)).toMatch(new RegExp(`<div[^>]*id="${zeile![1]}"[^>]*hidden=""`));
    expect(html(2).match(/<a /g)).toHaveLength(2);
  });
});
