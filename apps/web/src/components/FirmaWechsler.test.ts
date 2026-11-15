import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FirmaWechsler, ZumFirmenportal } from "./FirmaWechsler.tsx";
import { Icon } from "./Icon.tsx";

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

  // Rückmeldung in #1006: das Gebäude vor dem Text wie bei den Menüpunkten und eingeklappt, der Pfeil bleibt rechts
  it("zeigt das Gebäude vor dem Text und den Pfeil nach unten rechts", () => {
    const zeile = /<button[^>]*>(.*?)<\/button>/.exec(html(2))![1]!;
    const symbol = (name: "company" | "chevron-down", size?: number) => renderToStaticMarkup(createElement(Icon, { name, size }));
    expect(zeile).toBe(`${symbol("company")}<span class="firma-wechsler-text">Firma wechseln</span>${symbol("chevron-down", 16)}`);
  });
});

describe("ZumFirmenportal", () => {
  it("zeigt das Gebäude vor dem Text und den Pfeil nach rechts, Ziel mit ?von=haben", () => {
    const link = renderToStaticMarkup(createElement(ZumFirmenportal, { url: "https://firmenportal.example.de" }));
    const symbol = (name: "company" | "chevron-right", size?: number) => renderToStaticMarkup(createElement(Icon, { name, size }));
    expect(link).toContain('href="https://firmenportal.example.de/?von=haben"');
    expect(/<a[^>]*>(.*?)<\/a>/.exec(link)![1]).toBe(
      `${symbol("company")}<span class="firma-wechsler-text">Zum Firmenportal</span>${symbol("chevron-right", 16)}`,
    );
  });
});
