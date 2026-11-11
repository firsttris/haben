import { expect, test, type Page } from "@playwright/test";
import { ANONYMOUS } from "./daten.ts";
import { axeVerstoesse, durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";

/**
 * Firmen wechseln (#504) in eigener, leerer Datenbank (Projekt „firmen“, e2e/durchlaeufe.ts). Der Server hat
 * HABEN_FIRMEN mit sich selbst als „Studio Nord“ und einer zweiten Instanz „Werkstatt Süd“ (playwright.config.ts).
 * Der Inhaber sieht, in welcher Firma er ist, und wechselt über einen Link; die Steuerberatung sieht nur den Namen.
 * Der Name unter „Haben“ kommt aus den Firmendaten (firmenname.spec.ts), nicht aus HABEN_FIRMEN.
 */

test.describe.configure({ mode: "serial" });

const KANZLEI = { name: "Kanzlei Muster", email: "kanzlei@example.com", password: "kanzlei-passwort-e2e" };

let page: Page;
let pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
});

test.afterAll(async () => {
  expect(pageErrors).toEqual([]);
  await page.context().close();
});

const FIRMA = "Mustermann IT · Max Mustermann";

const nav = () => page.getByRole("navigation", { name: "Hauptnavigation" });

test("Inhaber sieht die eigene Firma und wechselt zur anderen", async () => {
  await einrichten(page);
  await gehe(page, "/");
  await expect(nav().getByRole("link", { name: `Haben ${FIRMA}` })).toBeVisible();
  await expect(nav().getByText("Studio Nord")).toHaveCount(0);
  const wechseln = nav().getByRole("group", { name: "Firma wechseln" });
  await expect(wechseln.getByRole("link")).toHaveCount(1);
  await expect(wechseln.getByRole("link", { name: "Werkstatt Süd" })).toHaveAttribute("href", "https://werkstatt.example.de");
  expect(await axeVerstoesse(page)).toEqual([]);
});

test("am Handy im Menü", async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gehe(page, "/");
  await expect(nav().getByText(FIRMA)).toBeVisible();
  await nav().getByRole("button", { name: "Menü" }).click();
  const link = nav().getByRole("group", { name: "Firma wechseln" }).getByRole("link", { name: "Werkstatt Süd" });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible();
  expect(await axeVerstoesse(page)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("Steuerberatung sieht den Namen der Firma, aber keine anderen Firmen", async ({ browser }) => {
  await gehe(page, "/einstellungen?bereich=sicherheit");
  await page.getByLabel("Bezeichnung").fill(KANZLEI.name);
  await page.getByRole("button", { name: "Einladungslink erzeugen" }).click();
  const feld = page.getByRole("textbox", { name: /Einladungslink für/ });
  await expect(feld).toHaveValue(/\/einladung\//);
  const url = await feld.inputValue();

  const context = await browser.newContext(ANONYMOUS);
  const stb = await context.newPage();
  await stb.goto(url);
  await stb.getByLabel("Name").fill(KANZLEI.name);
  await stb.getByLabel("E-Mail").fill(KANZLEI.email);
  await stb.getByLabel("Passwort (mindestens 12 Zeichen)").fill(KANZLEI.password);
  await stb.getByRole("button", { name: "Zugang anlegen" }).click();
  await stb.getByRole("button", { name: "Später" }).click();
  await stb.waitForURL(/\/steuerberatung$/);
  const stbNav = stb.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(stbNav.getByText(FIRMA)).toBeVisible();
  await expect(stbNav.getByRole("group", { name: "Firma wechseln" })).toHaveCount(0);
  await expect(stb.getByText("Werkstatt Süd")).toHaveCount(0);
  await context.close();
});

// Review: HABEN_FIRMEN erlaubt Namen bis 60 Zeichen; ein langes zusammengesetztes Wort darf die Navigation nicht sprengen
test("ein langer Firmenname passt in die Navigation", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gehe(page, "/");
  await nav()
    .getByRole("group", { name: "Firma wechseln" })
    .getByRole("link", { name: "Werkstatt Süd" })
    .evaluate((a) => {
      a.lastChild!.textContent = "Gebäudereinigungsgesellschaft Nord";
    });
  const ueberlauf = await page.evaluate(() => {
    const navigation = document.querySelector<HTMLElement>("nav.nav")!;
    const link = [...navigation.querySelectorAll<HTMLElement>("a.nav-link")].find((a) => a.textContent?.includes("Gebäude"))!;
    return { nav: navigation.scrollWidth - navigation.clientWidth, link: link.scrollWidth - link.clientWidth };
  });
  expect(ueberlauf).toEqual({ nav: 0, link: 0 });
});

// Review Runde 2: Der Seitenkopf klebt am Handy bei --nav-height (60px) unter der Navigation; mit dem Firmennamen unter
// „Haben“ darf die Leiste nicht höher werden, sonst verdeckt sie beim Scrollen den Kopf. Auch ein langer Name auf 320px
test("am Handy bleibt die Leiste mit dem Firmennamen so hoch wie --nav-height", async () => {
  const hoehen: Record<string, number> = {};
  let variable = 0;
  for (const [breite, name] of [
    [375, FIRMA],
    [320, "Garten- und Landschaftsbau Müller und Söhne GmbH & Co. KG"],
  ] as const) {
    await page.setViewportSize({ width: breite, height: 812 });
    await gehe(page, "/");
    await nav()
      .locator(".brand-firma")
      .evaluate((el, text) => {
        el.textContent = text;
      }, name);
    const gemessen = await page.evaluate(() => ({
      leiste: Math.round(document.querySelector<HTMLElement>("nav.nav")!.getBoundingClientRect().height),
      variable: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-height")),
    }));
    hoehen[`${breite}px`] = gemessen.leiste;
    variable = gemessen.variable;
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(variable).toBe(60);
  expect(hoehen).toEqual({ "375px": 60, "320px": 60 });
});
