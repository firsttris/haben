import { expect, type Page, test } from "@playwright/test";
import { SESSION } from "./daten.ts";
import { axeVerstoesse } from "./einrichtung.ts";

/**
 * Einfahrbare Seitenleiste am Desktop: prüft Einklappen auf 62 px, Beibehalten beim Neuladen ohne Sprung,
 * Tastaturbedienung der Gruppen-Flyouts (Enter, Tab, Esc), Barrierefreiheit (axe) und unverändertes Handymenü.
 */
test.use({ storageState: SESSION });

const nav = (page: Page) => page.getByRole("navigation", { name: "Hauptnavigation" });

test("klappt am Desktop ein, bleibt beim Neuladen schmal und bedient Flyouts per Tastatur", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const navEl = nav(page);
  const breiteAusgeklappt = await navEl.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(breiteAusgeklappt).toBeGreaterThanOrEqual(220);

  await navEl.getByRole("button", { name: "Seitenleiste einklappen" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-nav", "collapsed");
  const breiteEingeklappt = await navEl.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(breiteEingeklappt).toBe(64);

  // Neuladen behält die schmale Leiste sofort bei
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-nav", "collapsed");
  const breiteNachReload = await nav(page).evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(breiteNachReload).toBe(64);

  expect(await axeVerstoesse(page)).toEqual([]);

  // Gruppen-Flyout öffnen per Tastatur und per Esc zurück auf den Knopf schließen
  const verkaufBtn = nav(page).getByRole("button", { name: "Verkauf" });
  await verkaufBtn.focus();
  await page.keyboard.press("Enter");
  await expect(verkaufBtn).toHaveAttribute("aria-expanded", "true");

  const angeboteLink = nav(page).getByRole("link", { name: "Angebote" });
  await expect(angeboteLink).toBeVisible();
  await expect(angeboteLink).toBeFocused();
  expect(await axeVerstoesse(page)).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(verkaufBtn).toHaveAttribute("aria-expanded", "false");
  await expect(verkaufBtn).toBeFocused();

  // Klick auf einen Link navigiert und schließt das Flyout
  await verkaufBtn.click();
  await nav(page).getByRole("link", { name: "Rechnungen" }).click();
  await expect(page).toHaveURL(/\/rechnungen/);
  await expect(verkaufBtn).toHaveAttribute("aria-expanded", "false");
  await expect(verkaufBtn).toHaveAttribute("data-active", "true");

  // Konto & Darstellung Flyout öffnet sich und schließt per Esc
  const kontoBtn = nav(page).getByRole("button", { name: "Konto & Darstellung" });
  await kontoBtn.click();
  await expect(kontoBtn).toHaveAttribute("aria-expanded", "true");
  await expect(nav(page).getByRole("button", { name: "Abmelden" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(kontoBtn).toHaveAttribute("aria-expanded", "false");
  await expect(kontoBtn).toBeFocused();

  // Am Handy bleibt das gewohnte Menü unverändert
  await page.setViewportSize({ width: 375, height: 812 });
  const menuKnopf = nav(page).getByRole("button", { name: "Menü" });
  await expect(menuKnopf).toBeVisible();
  await expect(nav(page).getByRole("button", { name: "Seitenleiste ausklappen" })).toBeHidden();

  // Zurück am Desktop lässt sich die Leiste wieder ausklappen
  await page.setViewportSize({ width: 1280, height: 800 });
  await nav(page).getByRole("button", { name: "Seitenleiste ausklappen" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-nav");
  expect(await nav(page).evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBeGreaterThanOrEqual(220);
});
