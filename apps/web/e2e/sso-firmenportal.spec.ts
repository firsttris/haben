import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

/*
 * Firmenportal (#504, Stufe 2) im SSO-Durchlauf (playwright.sso-only.config.ts): Das Firmenportal auf Port 3217 kennt diese
 * Instanz als „Studio Nord“ (Inhaber-Gruppe haben-inhaber) und zwei andere, die es nicht geben muss. Die Instanz hat
 * HABEN_FIRMENPORTAL_URL. Läuft nach sso-only.spec.ts (Projekt mit Abhängigkeit in der Konfiguration), das eine frische
 * Instanz braucht; die Anmeldung hier richtet die Instanz ein, falls sie es noch nicht ist.
 */

const BASE = `${process.env.E2E_SERVER_COMMAND ? "https" : "http"}://localhost:3218`;
/** Wie in playwright.sso-only.config.ts */
const PORTAL = "http://localhost:3217";

/** Better Auth lässt je Adresse nur 3 Anmeldeversuche in 10 Sekunden zu (wie in sso-only.spec.ts) */
let letzterStart = 0;
async function habenAnmelden(page: Page, groups: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120_000 });
  const warten = letzterStart + 10_500 - Date.now();
  if (warten > 0) await page.waitForTimeout(warten);
  letzterStart = Date.now();
  await page.getByRole("button", { name: /^Mit Test-SSO (einrichten|anmelden)$/ }).click();
  await anbieter(page, "inhaberin@example.de", groups);
  await page.waitForURL(`${BASE}/`);
}

async function anbieter(page: Page, email: string, groups: string) {
  await expect(page.getByRole("heading", { name: "Testanbieter" })).toBeVisible();
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Gruppen").fill(groups);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
}

async function portalAnmelden(browser: Browser, groups: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  // Ohne Sitzung geht das Firmenportal gleich zum Anmeldedienst, ohne eigene Seite davor
  await page.goto(`${PORTAL}/`);
  await anbieter(page, "person@example.de", groups);
  return page;
}

async function ohneVerstoesse(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Knöpfe blenden ihre Fläche über --fade (0,15 s) über; axe soll den Endzustand messen
    await page.waitForTimeout(300);
    expect((await new AxeBuilder({ page }).analyze()).violations, colorScheme).toEqual([]);
  }
}

/**
 * Kanten auf der Seite: Marke, Überschrift und Kacheln der Firmen links am Inhalt der Karte, Knöpfe rechts daran
 * (Rückmeldung in #1006); `knopf` ist der Knopf, der rechts stehen soll
 */
async function kanten(page: Page, knopf: string) {
  return page.evaluate((auswahl) => {
    const rechteck = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const karte = document.querySelector(".karte")!;
    const stil = getComputedStyle(karte);
    const k = karte.getBoundingClientRect();
    const links = k.left + Number.parseFloat(stil.borderLeftWidth) + Number.parseFloat(stil.paddingLeft);
    const rechts = k.right - Number.parseFloat(stil.borderRightWidth) - Number.parseFloat(stil.paddingRight);
    const kacheln = document.querySelector(".firma-zeichen");
    return {
      zeichen: Math.round(rechteck(".zeichen").left - links),
      ueberschrift: Math.round(rechteck("h1").left - links),
      kachel: kacheln ? Math.round(kacheln.getBoundingClientRect().left - links) : 0,
      knopf: Math.round(rechteck(auswahl).right - rechts),
    };
  }, knopf);
}

const firmen = (page: Page) => page.getByRole("region", { name: "Firma wählen" }).getByRole("listitem").getByRole("link");

test.describe.configure({ mode: "serial" });

test("Firmenportal: Anmeldung zeigt nur die Firmen aus den eigenen Inhaber-Gruppen", async ({ browser }) => {
  const page = await portalAnmelden(browser, "familie, haben-inhaber, haben-sued-inhaber, haben-west-steuerberatung");
  await page.waitForURL(`${PORTAL}/`);
  // Die Initiale vor dem Namen ist nur Schmuck (aria-hidden), der Name des Links bleibt der Name der Firma
  await expect(firmen(page)).toHaveCount(2);
  await expect(firmen(page).nth(0)).toHaveAccessibleName("Studio Nord");
  await expect(firmen(page).nth(1)).toHaveAccessibleName("Werkstatt Süd");
  // Der Link startet in Haben gleich die SSO-Anmeldung
  await expect(firmen(page).first()).toHaveAttribute("href", `${BASE}/login?anmelden=sso`);
  await expect(page.getByText("Angemeldet als person@example.de")).toBeVisible();
  await expect(page.getByText("Atelier West")).toHaveCount(0);
  await ohneVerstoesse(page);
  expect(await kanten(page, ".fuss .btn")).toEqual({ zeichen: 0, ueberschrift: 0, kachel: 0, knopf: 0 });
  await page.setViewportSize({ width: 375, height: 812 });
  await ohneVerstoesse(page);
  // Am Handy bricht der Fuß um, „Abmelden“ bleibt rechts
  expect(await kanten(page, ".fuss .btn")).toEqual({ zeichen: 0, ueberschrift: 0, kachel: 0, knopf: 0 });
  await page.context().close();
});

test("Firmenportal: die Steuerberatung sieht keine Firma", async ({ browser }) => {
  const page = await portalAnmelden(browser, "haben-steuerberatung, haben-sued-steuerberatung");
  await page.waitForURL(`${PORTAL}/`);
  await expect(page.getByText("in keiner Firma als Inhaber")).toBeVisible();
  await expect(firmen(page)).toHaveCount(0);
  await page.context().close();
});

test("Firmenportal: mit genau einer Firma geht es nach der Anmeldung direkt dorthin", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${PORTAL}/`);
  // Die Instanz gibt es nicht: Geprüft wird, dass der Browser sie aufruft, nicht was er dort lädt. Eine abgefangene
  // Route auf die fremde Adresse lud in der CI nach der Weiterleitung statt der Seite chrome-error://
  const ziel = page.waitForRequest("https://sued.example.de/login?anmelden=sso");
  await anbieter(page, "sued@example.de", "haben-sued-inhaber");
  await ziel;
  await context.close();
});

test("Aus dem Firmenportal in eine Firma, ohne Klick auf der Login-Seite von Haben", async ({ browser }) => {
  const page = await portalAnmelden(browser, "haben-inhaber, haben-sued-inhaber");
  await page.waitForURL(`${PORTAL}/`);
  const warten = letzterStart + 10_500 - Date.now();
  if (warten > 0) await page.waitForTimeout(warten);
  letzterStart = Date.now();
  await firmen(page).filter({ hasText: "Studio Nord" }).click();
  // Haben startet die Anmeldung selbst; der Testanbieter fragt ohne eigene Sitzung noch einmal
  await anbieter(page, "inhaberin@example.de", "haben-inhaber");
  await page.waitForURL(`${BASE}/`);
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Zum Firmenportal" })).toBeVisible();
  await page.context().close();
});

test("Haben: „Zum Firmenportal“ führt ins Firmenportal, ohne aufzuklappen, und zurück zur Firma", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await habenAnmelden(page, "haben-inhaber");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  // Mit Firmenportal heißt die Zeile nicht „Firma wechseln“: Sie klappt nichts auf, sondern führt aus Haben hinaus
  const wechseln = nav.getByRole("link", { name: "Zum Firmenportal" });
  await expect(wechseln).toHaveAttribute("href", `${PORTAL}/?von=haben`);
  await expect(nav.getByText("Firma wechseln")).toHaveCount(0);
  // Mit dem Gebäude davor steht der Text bündig mit „Übersicht“ und den Menüpunkten (Rückmeldung in #1006)
  const links = (ort: import("@playwright/test").Locator) => ort.evaluate((el) => Math.round(el.getBoundingClientRect().left));
  expect(await links(wechseln.locator(".firma-wechsler-text"))).toBe(await links(nav.getByRole("link", { name: "Übersicht" }).locator(".nav-collapse-label")));
  await expect(wechseln).not.toHaveAttribute("target");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // In der eingeklappten Seitenleiste (#939) ein einzelnes Symbol mit demselben Ziel, ohne Flyout
  await nav.getByRole("button", { name: "Seitenleiste einklappen" }).click();
  const symbol = nav.getByRole("link", { name: "Zum Firmenportal" });
  await expect(symbol).toHaveAttribute("href", `${PORTAL}/?von=haben`);
  // Hinweis statt title wie bei den übrigen Symbolen ohne Unterpunkte (#1018)
  await symbol.hover();
  await expect(symbol.getByText("Zum Firmenportal")).toBeVisible();
  await expect(nav.getByRole("button", { name: /Firma wechseln|Zum Firmenportal/ })).toHaveCount(0);
  await nav.getByRole("button", { name: "Seitenleiste ausklappen" }).click();

  await wechseln.click();
  await anbieter(page, "inhaberin@example.de", "haben-inhaber, haben-sued-inhaber");
  await page.waitForURL(`${PORTAL}/`);
  await firmen(page).filter({ hasText: "Studio Nord" }).click();
  await page.waitForURL(`${BASE}/`);
  await expect(nav.getByRole("link", { name: "Zum Firmenportal" })).toBeVisible();

  // Abmelden im Firmenportal: danach eine Seite „abgemeldet“, keine sofortige neue Anmeldung
  await page.goto(`${PORTAL}/`);
  await page.getByRole("button", { name: "Abmelden" }).click();
  await page.waitForURL(`${PORTAL}/?abgemeldet`);
  // Der Testanbieter bietet keine Abmeldung an: Die Seite sagt, dass man dort angemeldet bleibt
  await expect(page.getByText("Du bist im Firmenportal abgemeldet. Bei Test-SSO bist du weiter angemeldet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Wieder anmelden" })).toBeVisible();
  // „Wieder anmelden“ steht rechts wie die Aktion eines Dialogs, auch am Handy
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    expect(await kanten(page, ".aktionen .btn"), `${width}px`).toEqual({ zeichen: 0, ueberschrift: 0, kachel: 0, knopf: 0 });
  }
  await context.close();
});

test("Haben: aus Haben zeigt das Firmenportal auch mit nur einer Firma die Liste, statt zurückzuleiten", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await habenAnmelden(page, "haben-inhaber");
  await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Zum Firmenportal" }).click();
  await anbieter(page, "inhaberin@example.de", "haben-inhaber");
  await page.waitForURL(`${PORTAL}/`);
  await expect(firmen(page)).toHaveCount(1);
  await expect(firmen(page).first()).toHaveAccessibleName("Studio Nord");
  await context.close();
});
