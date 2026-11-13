import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

/**
 * Knopfarten aus styles.css (DESIGN.md, Knöpfe): Ein gesperrter Knopf färbt sich beim Überfahren nicht, gleich welcher Art.
 * Braucht keinen Server: die Regeln kommen direkt aus der Datei, die Schriften fehlen dabei.
 */
const ARTEN = ["btn", "btn btn-primary", "btn btn-danger", "btn btn-destructive", "btn btn-dashed", "btn btn-ghost", "btn btn-ghost btn-icon"];

for (const theme of ["wald", "nacht"]) {
  test(`gesperrte Knöpfe färben sich beim Überfahren nicht (Theme ${theme})`, async ({ page }) => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const knoepfe = ARTEN.map((art) => `<button type="button" class="${art}" disabled>${art}</button>`).join("");
    await page.setContent(`<html data-theme="${theme}"><style>${css}</style><body><div class="actions" style="padding: 16px">${knoepfe}</div></body></html>`);
    // Ohne Übergang, sonst misst der Test eine Zwischenfarbe
    await page.addStyleTag({ content: "* { transition: none !important; }" });
    for (const art of ARTEN) {
      const knopf = page.locator(`button[class="${art}"]`);
      const vorher = await knopf.evaluate((el) => getComputedStyle(el).backgroundColor);
      await knopf.hover({ force: true });
      expect(await knopf.evaluate((el) => getComputedStyle(el).backgroundColor), `${art}: Fläche beim Überfahren`).toBe(vorher);
      await page.mouse.move(0, 0);
    }
  });
}
