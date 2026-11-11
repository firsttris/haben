import { expect, test } from "@playwright/test";
import { SESSION } from "./daten.ts";

/**
 * Umsatzliste im Bankabgleich (#681): Datum mit Jahr, Spaltenköpfe sortieren, der zweite Klick dreht die Richtung.
 * Mit den Umsätzen und der Sitzung aus app.spec.ts (Projekt „mit-daten“); geschrieben wird nichts.
 */

test.use({ storageState: SESSION });

test("Spaltenköpfe sortieren die Umsatzliste, das Datum steht mit Jahr", async ({ page }) => {
  await page.goto("/bank?filter=alle");
  await page.waitForLoadState("networkidle");
  const zeilen = page.locator(".tx-row");
  const ersteZeile = zeilen.first();
  await expect(ersteZeile.locator("> div").first()).toHaveText(/^\d{2}\.\d{2}\.\d{4}$/);
  await expect(page.getByRole("link", { name: "Datum aufsteigend sortieren, zurzeit absteigend sortiert" })).toHaveText("Datum ↓");

  await page.getByRole("link", { name: "Betrag absteigend sortieren" }).click();
  await expect(page).toHaveURL(/sort=betrag&dir=ab/);
  await expect(ersteZeile).toContainText("Nordwerk Software GmbH");
  await expect(ersteZeile).toContainText("+10.852,80 €");
  const betrag = page.getByRole("link", { name: "Betrag aufsteigend sortieren, zurzeit absteigend sortiert" });
  await expect(betrag).toHaveText("Betrag ↓");

  await betrag.click();
  await expect(page).toHaveURL(/sort=betrag&dir=auf/);
  await expect(ersteZeile).toContainText("Hafen Immobilien GmbH");
  await expect(page.getByRole("link", { name: "Betrag absteigend sortieren, zurzeit aufsteigend sortiert" })).toHaveText("Betrag ↑");
  // Der Filter bleibt beim Sortieren erhalten
  await expect(page).toHaveURL(/filter=alle/);

  // Nach Status, absteigend: oben steht, was zu tun ist (der offene Zahlungseingang mit Vorschlag)
  await page.getByRole("link", { name: "Status absteigend sortieren" }).click();
  await expect(page).toHaveURL(/sort=status&dir=ab/);
  await expect(ersteZeile).toContainText("Rheinpixel GmbH");
  await expect(zeilen.last()).toContainText("Zugeordnet");

  await page.getByRole("link", { name: "Gegenpartei · Verwendungszweck absteigend sortieren" }).click();
  await page.getByRole("link", { name: "Gegenpartei · Verwendungszweck aufsteigend sortieren, zurzeit absteigend sortiert" }).click();
  await expect(page).toHaveURL(/sort=gegenpartei&dir=auf/);
  await expect(ersteZeile).toContainText("Alpenblick Media AG");
});
