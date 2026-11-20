import { expect, test } from "@playwright/test";
import { SESSION } from "./daten.ts";
import { HANDY } from "./kopfzeile.ts";

/*
 * Liquiditätsvorschau (#1381) mit den Daten aus app.spec.ts (offene Rechnungen, Dauerbeleg Miete): über den Link der Auswertungen
 * öffnen, Horizont umschalten, einen Zeitraum aufklappen und von einem Posten zu seiner Quelle springen, überfällige Forderungen
 * ausblenden.
 */

test.use({ storageState: SESSION });

test("Liquidität: Horizont umschalten, Zeitraum aufklappen, Posten bis zur Quelle", async ({ page }) => {
  await page.goto("/auswertungen");
  await page.locator(".page-head").getByRole("link", { name: "Liquidität" }).click();
  await expect(page).toHaveURL(/\/auswertungen\/liquiditaet$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Liquiditätsvorschau");
  await expect(page.getByRole("table", { name: "Liquiditätsvorschau 13 Wochen" })).toBeVisible();

  await page.getByLabel("Horizont").selectOption("12m");
  await expect(page).toHaveURL(/horizont=12m/);
  const tabelle = page.getByRole("table", { name: "Liquiditätsvorschau 12 Monate" });
  await expect(tabelle.getByRole("columnheader", { name: "Monat" })).toBeVisible();
  await expect(tabelle.getByRole("rowheader", { name: "Gesamt" })).toBeVisible();

  // Der Dauerbeleg Miete aus app.spec.ts kommt jeden Monat: Der erste Zeitraum mit Posten klappt auf
  const umschalter = tabelle.locator("a[aria-expanded]").first();
  await umschalter.click();
  await expect(umschalter).toHaveAttribute("aria-expanded", "true");
  const posten = page.locator(".liq-posten");
  await expect(posten).toBeVisible();
  await expect(posten.getByRole("columnheader", { name: "Sicherheit" })).toBeVisible();
  await posten.locator('a[href*="/rechnungen/"], a[href*="/belege/"], a[href*="/dauerbelege/"]').first().click();
  await expect(page).toHaveURL(/\/(rechnungen|belege|dauerbelege)\/[0-9a-f-]{36}$/);
});

test("Liquidität: überfällige Forderungen ausblenden und 4 Wochen je Woche", async ({ page }) => {
  await page.goto("/auswertungen/liquiditaet?horizont=4w");
  const tabelle = page.getByRole("table", { name: "Liquiditätsvorschau 4 Wochen" });
  await expect(tabelle.getByRole("columnheader", { name: "Woche" })).toBeVisible();
  await page.getByLabel("Überfällige Forderungen einrechnen").uncheck();
  await expect(page).toHaveURL(/ueberfaellige=false/);
  await expect(page.getByLabel("Überfällige Forderungen einrechnen")).not.toBeChecked();
  await expect(tabelle.locator("tbody tr").first()).toBeVisible();
});

test("Liquidität am Handy: Horizont und Schalter stehen ganz im Bild", async ({ page }) => {
  await page.setViewportSize(HANDY);
  await page.goto("/auswertungen/liquiditaet");
  for (const element of [page.getByLabel("Horizont"), page.locator(".liq-wahl label.checkbox")]) {
    const box = await element.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(HANDY.width);
  }
});
