import { expect, test } from "@playwright/test";
import { einrichten, gehe } from "./einrichtung.ts";

test("Kleinunternehmer-Ersteinrichtung: Übersicht ohne reguläre UStVA-Aufforderung in Hell/Dunkel und am Handy", async ({ page }) => {
  await einrichten(page, true);

  for (const viewport of [
    { width: 1280, height: 1000 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    for (const theme of ["wald", "nacht"]) {
      await gehe(page, "/");
      await page.evaluate((value) => {
        localStorage.setItem("haben-theme", value);
        document.documentElement.dataset.theme = value;
      }, theme);

      await expect(page.getByRole("heading", { name: "Übersicht", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Voranmeldung / })).toHaveCount(0);
      await expect(page.getByText(/^Voranmeldung .* senden$/)).toHaveCount(0);
      await expect(page.getByText(/^USt-Zahllast /)).toHaveCount(0);
      await expect(page.getByText(/Voranmeldung fällig/)).toHaveCount(0);
      await expect(page.getByText(/ERiC ist nicht eingerichtet/)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Letzte Voranmeldungen" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Neue Rechnung", exact: true })).toBeVisible();
      await expect(page.getByText("Offene Forderungen", { exact: true })).toBeVisible();
    }
  }
});
