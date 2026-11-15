import { expect, test } from "@playwright/test";
import { SESSION } from "./daten.ts";

/**
 * Datumsfelder sind so hoch wie die Felder daneben. Mit der Standarddarstellung zeichnet iOS Safari sie als Menüknopf und
 * überschreibt dabei min-height und box-sizing (WebKit, RenderThemeIOS). Das lässt sich in Chromium nicht nachstellen,
 * deshalb prüft der Test die Ursache: appearance: none. Mit der Sitzung aus app.spec.ts (Projekt „mit-daten“).
 */

test.use({ storageState: SESSION });

test("Feld vom Typ date nutzt nicht die Standarddarstellung des Browsers und ist so hoch wie sein Nachbar", async ({ page }) => {
  await page.goto("/rechnungen/neu");
  await page.waitForLoadState("networkidle");
  const nachbar = await page.getByLabel("Zahlungsziel in Tagen").boundingBox();
  // In einem Schritt, sonst kann React das Feld zwischen Umstellen und Lesen neu zeichnen
  const feld = await page.getByLabel("Rechnungsdatum").evaluate((el: HTMLInputElement) => {
    el.type = "date";
    return { appearance: getComputedStyle(el).appearance, hoehe: el.getBoundingClientRect().height };
  });
  expect(feld).toEqual({ appearance: "none", hoehe: nachbar?.height });
});
