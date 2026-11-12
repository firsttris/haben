import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

/**
 * Die Startseite der Doku (docs/index.md) zeigt jedes Bild hell und dunkel, ausgewählt per `#only-light` und
 * `#only-dark` am Bild. Ausgeblendet wird mit den Regeln des Themes; docs/assets/stylesheets/startseite.css darf
 * sie nicht überstimmen. Die beiden Regeln stehen wörtlich so im gebauten Theme von Zensical 0.1.0
 * (requirements-docs.txt): site/assets/stylesheets/modern/main.*.min.css und palette.*.min.css.
 */
const THEME = `[data-md-color-scheme=default] img[src$="#gh-dark-mode-only"],[data-md-color-scheme=default] img[src$="#only-dark"]{display:none}
[data-md-color-scheme=slate] img[src$="#gh-light-mode-only"],[data-md-color-scheme=slate] img[src$="#only-light"]{display:none}`;

/** Die Bildflächen der Startseite, wie docs/index.md sie anlegt */
const FLAECHEN = ["showcase-shot showcase-shot--hero", "showcase-shot", "showcase-shot showcase-shot--crop", "showcase-phone"];

for (const [scheme, sichtbar, versteckt] of [
  ["default", "only-light", "only-dark"],
  ["slate", "only-dark", "only-light"],
] as const) {
  test(`Startseite der Doku: im Farbschema ${scheme} nur die Bilder mit #${sichtbar}`, async ({ page }) => {
    const css = await readFile(new URL("../../../docs/assets/stylesheets/startseite.css", import.meta.url), "utf8");
    const flaechen = FLAECHEN.map(
      (klasse) => `<div class="${klasse}"><img src="bild.png#only-light" alt=""><img src="bild-dunkel.png#only-dark" alt=""></div>`,
    ).join("");
    await page.setContent(
      `<style>${THEME}</style><style>${css}</style><body data-md-color-scheme="${scheme}"><article class="md-typeset">${flaechen}</article></body>`,
    );
    const anzeige = (endung: string) =>
      page.evaluate((e) => [...document.querySelectorAll(`img[src$="#${e}"]`)].map((img) => getComputedStyle(img).display), endung);
    expect(await anzeige(versteckt), `#${versteckt} ausgeblendet`).toEqual(FLAECHEN.map(() => "none"));
    expect(await anzeige(sichtbar), `#${sichtbar} sichtbar`).toEqual(FLAECHEN.map(() => "block"));
  });
}
