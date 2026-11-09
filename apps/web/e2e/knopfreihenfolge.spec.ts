import { expect, type Locator, type Page, test } from "@playwright/test";
import { firstLink, SESSION } from "./daten.ts";
import { gehe, neuenKontaktOeffnen } from "./einrichtung.ts";

/**
 * Reihenfolge der Knöpfe (#394, docs/entwicklung.md, Gestaltung der Oberfläche): In einer Knopfzeile mit genau einer
 * Hauptaktion steht `btn-primary` als letzter Knopf, Abbrechen und Nebenaktionen davor, `btn-danger` ganz vorn.
 * Geprüft wird die DOM-Reihenfolge, weil sie die Tab-Reihenfolge ist; `order` und `row-reverse` dürfen die Zeile
 * nicht umdrehen, sonst liefe der Fokus anders als das Auge (WCAG 2.4.3).
 */

test.use({ storageState: SESSION });

/** Abweichende Knopfzeilen der Seite, als lesbare Texte; leer, wenn alles passt */
async function abweichungen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sichtbar = (el: Element) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === "fixed";
    const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim() || (el.getAttribute("aria-label") ?? "?");
    const befunde: string[] = [];
    for (const zeile of document.querySelectorAll(".actions")) {
      if (!sichtbar(zeile)) continue;
      const knoepfe = [...zeile.children].filter((el) => el.classList.contains("btn") && sichtbar(el));
      const primaer = knoepfe.filter((el) => el.classList.contains("btn-primary"));
      if (knoepfe.length < 2 || primaer.length !== 1) continue;
      const folge = knoepfe.map(text).join(" · ");
      const stil = getComputedStyle(zeile);
      if (stil.flexDirection.endsWith("reverse") || knoepfe.some((el) => getComputedStyle(el).order !== "0")) {
        befunde.push(`umgedreht per CSS: ${folge}`);
      }
      if (knoepfe.at(-1) !== primaer[0]) befunde.push(`Hauptaktion nicht zuletzt: ${folge}`);
      const ersterNormaler = knoepfe.findIndex((el) => !el.classList.contains("btn-danger"));
      const letzterGefahr = knoepfe.findLastIndex((el) => el.classList.contains("btn-danger"));
      if (letzterGefahr > ersterNormaler) befunde.push(`Gefahrknopf nicht vorn: ${folge}`);
    }
    return befunde;
  });
}

/** Abstand der rechten Kante von `knopf` zum rechten Innenrand (ohne padding) von `zeile`, in Pixeln */
async function abstandZumRand(zeile: Locator, knopf: Locator): Promise<number> {
  const innen = await zeile.evaluate((el) => el.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(el).paddingRight));
  const box = await knopf.boundingBox();
  return innen - ((box?.x ?? 0) + (box?.width ?? 0));
}

test("Neuer Kontakt: Abbrechen links, Kontakt anlegen rechts, Tab in derselben Folge", async ({ page }) => {
  await gehe(page, "/kontakte/neu");
  const abbrechen = page.getByRole("link", { name: "Abbrechen" });
  const anlegen = page.getByRole("button", { name: "Kontakt anlegen" });
  const links = (await abbrechen.boundingBox())?.x ?? 0;
  expect((await anlegen.boundingBox())?.x ?? 0).toBeGreaterThan(links);
  await abbrechen.focus();
  await page.keyboard.press("Tab");
  await expect(anlegen).toBeFocused();
});

test("Kontaktdialog im Rechnungsentwurf: Hauptaktion zuletzt", async ({ page }) => {
  await gehe(page, "/rechnungen/neu");
  await neuenKontaktOeffnen(page);
  const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
  await expect(dialog).toBeVisible();
  const abbrechen = dialog.getByRole("button", { name: "Abbrechen" });
  const anlegen = dialog.getByRole("button", { name: "Kontakt anlegen" });
  expect((await anlegen.boundingBox())?.x ?? 0).toBeGreaterThan((await abbrechen.boundingBox())?.x ?? 0);
  await abbrechen.focus();
  await page.keyboard.press("Tab");
  await expect(anlegen).toBeFocused();
  expect(await abweichungen(page)).toEqual([]);
  // Im Dialog rechtsbündig: die Hauptaktion schließt mit dem Innenrand der Fußzeile ab
  expect(await abstandZumRand(dialog.locator(".form-footer"), anlegen)).toBeLessThanOrEqual(1);
});

test("Handy: Knöpfe füllen die Zeile, Hauptaktion rechts am Rand", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gehe(page, "/kontakte/neu");
  const footer = page.locator(".form-footer");
  const abbrechen = footer.getByRole("link", { name: "Abbrechen" });
  const anlegen = footer.getByRole("button", { name: "Kontakt anlegen" });
  const [a, b] = [await abbrechen.boundingBox(), await anlegen.boundingBox()];
  expect(Math.abs((a?.y ?? 0) - (b?.y ?? 1)), "beide in einer Zeile").toBeLessThan(1);
  expect(await abstandZumRand(footer, anlegen)).toBeLessThanOrEqual(1);
});

test("Formulare für Artikel und Textbausteine: Hauptaktion zuletzt", async ({ page }) => {
  for (const [url, name] of [
    ["/artikel", "Neuer Artikel"],
    ["/textbausteine", "Neuer Textbaustein"],
  ] as const) {
    await gehe(page, url);
    await page.getByRole("button", { name }).click();
    await expect(page.getByRole("form", { name })).toBeVisible();
    expect(await abweichungen(page), url).toEqual([]);
  }
});

test("Neues SEPA-Mandat: Hauptaktion zuletzt", async ({ page }) => {
  await gehe(page, "/kontakte");
  await page
    .getByRole("region", { name: "Kontaktliste" })
    .getByRole("link", { name: /Rheinpixel GmbH/ })
    .click();
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "SEPA-Lastschriftmandate" });
  await karte.getByRole("button", { name: "Mandat anlegen" }).click();
  await expect(karte.getByRole("form", { name: "Neues Mandat" })).toBeVisible();
  expect(await abweichungen(page)).toEqual([]);
});

test("Knopfzeilen auf den Seiten mit Formularen und Rückfragen", async ({ page }) => {
  const befunde: string[] = [];
  const beleg = await firstLink(page, "/belege", /^\/belege\/[0-9a-f-]{36}$/);
  for (const url of [
    "/kontakte/neu",
    "/rechnungen/neu",
    "/buchungen/neu",
    "/kontakte",
    "/belege",
    ...(beleg ? [beleg] : []),
    "/bank",
    "/anlagen",
    "/ueberweisungen",
    "/fristen",
    "/umsatzsteuer",
    "/einstellungen?bereich=email",
    "/einstellungen?bereich=seiten",
    "/einstellungen?bereich=export",
  ]) {
    await gehe(page, url);
    befunde.push(...(await abweichungen(page)).map((b) => `${url}: ${b}`));
  }
  expect(befunde).toEqual([]);
});
