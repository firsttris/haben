import { expect, type Page, test } from "@playwright/test";
import { SESSION } from "./daten.ts";
import { axeVerstoesse } from "./einrichtung.ts";

/**
 * Mehrere Firmen (#504): Unter „Haben“ steht der Name aus den Firmendaten, damit man sieht, in welcher Instanz man
 * bucht. Mit den Daten und der Sitzung aus app.spec.ts (Projekt „mit-daten“); geschrieben wird nichts, lange Namen
 * setzt der Test nur in die Seite. Dass die Steuerberatung den Namen sieht, prüft steuerberatung.spec.ts.
 */

test.use({ storageState: SESSION });

const FIRMA = "Mustermann IT · Max Mustermann";
const LANG = "Garten- und Landschaftsbau Müller und Söhne GmbH & Co. KG";

const nav = (page: Page) => page.getByRole("navigation", { name: "Hauptnavigation" });

/** Firmenname in der Seite ersetzen; die Firmendaten bleiben, wie app.spec.ts sie angelegt hat */
async function nameSetzen(page: Page, name: string): Promise<void> {
  await nav(page)
    .locator(".brand-firma")
    .evaluate((el, text) => {
      el.textContent = text;
    }, name);
}

test("zeigt den Namen der Firma unter „Haben“", async ({ page }) => {
  await page.goto("/");
  const marke = nav(page).getByRole("link", { name: `Haben ${FIRMA}` });
  await expect(marke).toBeVisible();
  await expect(marke.locator(".brand-firma")).toHaveAttribute("title", FIRMA);
  expect(await axeVerstoesse(page)).toEqual([]);
});

test("ein langer Firmenname wird gekürzt und läuft nicht aus der Navigation", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page).getByText(FIRMA)).toBeVisible();
  await nameSetzen(page, LANG);
  const ueberlauf = await page.evaluate(() => {
    const navigation = document.querySelector<HTMLElement>("nav.nav")!;
    const marke = navigation.querySelector<HTMLElement>(".brand")!;
    return { nav: navigation.scrollWidth - navigation.clientWidth, marke: marke.scrollWidth - marke.clientWidth };
  });
  expect(ueberlauf).toEqual({ nav: 0, marke: 0 });
});

// Der Seitenkopf klebt am Handy bei --nav-height (60px) unter der Navigation; mit dem Firmennamen darf die Leiste
// nicht höher werden, sonst verdeckt sie beim Scrollen den Kopf. Auch ein langer Name auf 320px
test("am Handy steht der Name neben „Haben“, und die Leiste bleibt so hoch wie --nav-height", async ({ page }) => {
  const gemessen: Record<string, { leiste: number; ueberlauf: number }> = {};
  let variable = 0;
  for (const [breite, name] of [
    [375, FIRMA],
    [320, LANG],
  ] as const) {
    await page.setViewportSize({ width: breite, height: 812 });
    await page.goto("/");
    await expect(nav(page).getByText(FIRMA)).toBeVisible();
    await nameSetzen(page, name);
    const werte = await page.evaluate(() => ({
      leiste: Math.round(document.querySelector<HTMLElement>("nav.nav")!.getBoundingClientRect().height),
      ueberlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      variable: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-height")),
    }));
    gemessen[`${breite}px`] = { leiste: werte.leiste, ueberlauf: werte.ueberlauf };
    variable = werte.variable;
  }
  expect(variable).toBe(60);
  expect(gemessen).toEqual({ "375px": { leiste: 60, ueberlauf: 0 }, "320px": { leiste: 60, ueberlauf: 0 } });
});
