import { expect, test } from "@playwright/test";
import { SESSION } from "./daten.ts";

/**
 * Befehlspalette (#617): Strg+K und Knopf in der Navigation öffnen sie auf jeder Seite,
 * Seiten erscheinen sofort, Kontakte/Rechnungen/Angebote/Belege ab zwei Zeichen mit Link
 * zur gefilterten Liste (?suche=...), andere offene Dialoge werden nicht überlagert.
 */

test.use({ storageState: SESSION });

test("Knopf in der Navigation und Strg+K öffnen die Befehlspalette und navigieren zu Seiten", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("button", { name: /Suchen/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Befehlspalette" });
  await expect(dialog).toBeVisible();

  const input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.fill("Dauerbe");
  await expect(dialog.getByRole("option", { name: /Dauerbelege/ })).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(dialog).toBeHidden();
  await page.waitForURL(/\/dauerbelege$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dauerbelege" })).toBeVisible();
});

test("findet eine Rechnung über ihre Nummer und öffnet „Alle in Rechnungen anzeigen“ mit Suchfilter", async ({ page }) => {
  await page.goto("/rechnungen", { waitUntil: "networkidle" });
  const ersteZeile = page.locator("section[aria-label='Rechnungsliste'] a.table-row").first();
  const nummer = (await ersteZeile.locator(".mono").textContent())?.trim() ?? "";
  expect(nummer).toMatch(/\d/);

  await page.goto("/belege", { waitUntil: "networkidle" });
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Befehlspalette" });
  const input = dialog.getByRole("combobox");
  await input.fill(nummer);

  const rechnungTreffer = dialog.getByRole("option", { name: new RegExp(nummer) });
  await expect(rechnungTreffer).toBeVisible();
  const alle = dialog.getByRole("option", { name: "Alle in Rechnungen anzeigen" });
  await expect(alle).toBeVisible();

  await alle.click();
  await expect(dialog).toBeHidden();
  await page.waitForURL(new RegExp(`/rechnungen\\?suche=${encodeURIComponent(nummer)}`));
  await expect(page.getByLabel("Rechnungen durchsuchen")).toHaveValue(nummer);
  await expect(page.locator("section[aria-label='Rechnungsliste'] a.table-row")).toHaveCount(1);

  // Derselbe Suchbegriff über die Palette direkt öffnet die Detailseite der Rechnung
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await input.fill(nummer);
  await expect(rechnungTreffer).toBeVisible();
  await rechnungTreffer.click();
  await page.waitForURL(/\/rechnungen\/[0-9a-f-]+$/);
});

test("öffnet nicht über einem anderen bereits offenen Dialog", async ({ page }) => {
  await page.goto("/kontakte", { waitUntil: "networkidle" });
  // Prüfen über das offene Hilfe-/Bestätigungs- oder Formular-Dialogmuster auf Kontakte bzw. Einstellungen
  await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Neuen Kontakt anlegen" }).click();
  const kontaktDialog = page.getByRole("dialog", { name: "Neuer Kontakt" });
  await expect(kontaktDialog).toBeVisible();

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Befehlspalette" })).toBeHidden();
  await expect(kontaktDialog).toBeVisible();
});
