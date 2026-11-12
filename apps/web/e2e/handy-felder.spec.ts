import { expect, type Page, test } from "@playwright/test";
import { SESSION } from "./daten.ts";
import { HANDY } from "./kopfzeile.ts";

/**
 * Safari auf dem iPhone vergrößert die Seite beim Fokus in ein Feld mit einer Schrift unter 16 px und bleibt danach
 * vergrößert: Die Seite lässt sich seitlich verschieben und ist links und rechts abgeschnitten. Chromium zoomt nicht,
 * darum prüft der Test die Ursache, die berechnete Schriftgröße der Felder auf einem Touch-Gerät, und dass die größere
 * Schrift nichts über den Rand schiebt. Mit den Daten und der Sitzung aus app.spec.ts (Projekt „mit-daten“).
 */

test.use({ storageState: SESSION, viewport: HANDY, hasTouch: true, isMobile: true });

/** Kleinstes Handy, für das die Oberfläche gedacht ist (WCAG 1.4.10) */
const SCHMAL = { width: 320, height: 640 };

const FORMULARE = [
  "/rechnungen/neu",
  "/buchungen/neu",
  "/dauerbelege/neu",
  "/anlagen/neu",
  "/kontakte/neu",
  "/lohn/mitarbeiter/neu",
  "/einstellungen?bereich=firma",
  "/einstellungen?bereich=gestaltung",
];

/** Felder, in die getippt wird oder die eine Auswahl öffnen; Häkchen und Datei-Wähler zoomen nicht */
function zuKleineFelder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>("input, select, textarea")]
      .filter((feld) => feld.getClientRects().length > 0 && !["checkbox", "radio", "file", "hidden"].includes(feld.type))
      .map((feld) => ({ feld, groesse: Number.parseFloat(getComputedStyle(feld).fontSize) }))
      .filter(({ groesse }) => groesse < 16)
      .map(({ feld, groesse }) => `${feld.tagName.toLowerCase()}.${feld.className || feld.name}: ${groesse}px`),
  );
}

function ueberstand(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function laden(page: Page, pfad: string): Promise<void> {
  await page.goto(pfad);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

for (const pfad of FORMULARE) {
  test(`${pfad}: kein Feld zoomt die Seite beim Fokus`, async ({ page }) => {
    await laden(page, pfad);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "Touch-Gerät").toBe(true);
    expect(await zuKleineFelder(page)).toEqual([]);
  });

  test(`${pfad}: größere Schrift schiebt nichts über den Rand, auch auf dem schmalsten Handy`, async ({ page }) => {
    await laden(page, pfad);
    expect(await ueberstand(page)).toBeLessThanOrEqual(1);
    await page.setViewportSize(SCHMAL);
    expect(await ueberstand(page)).toBeLessThanOrEqual(1);
  });
}

test("Die Themenauswahl im Handy-Menü zoomt die Seite nicht", async ({ page }) => {
  await laden(page, "/");
  await page.getByRole("button", { name: "Menü" }).click();
  await expect(page.locator(".nav-theme select")).toBeVisible();
  expect(await zuKleineFelder(page)).toEqual([]);
});
