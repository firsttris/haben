import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

/*
 * Portal (#504, Stufe 2) im SSO-Durchlauf (playwright.sso-only.config.ts): Das Portal auf Port 3217 kennt diese
 * Instanz als „Studio Nord“ (Inhaber-Gruppe haben-inhaber) und zwei andere, die es nicht geben muss. Die Instanz hat
 * HABEN_PORTAL_URL. Läuft nach sso-only.spec.ts (Dateiname), das eine frische Instanz braucht; die Anmeldung hier
 * richtet die Instanz ein, falls sie es noch nicht ist.
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
  await page.goto(`${PORTAL}/`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Mit Test-SSO anmelden" }).click();
  await anbieter(page, "person@example.de", groups);
  return page;
}

async function ohneVerstoesse(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await new AxeBuilder({ page }).analyze()).violations, colorScheme).toEqual([]);
  }
}

const firmen = (page: Page) => page.getByRole("region", { name: "Firma wählen" }).getByRole("listitem").getByRole("link");

test.describe.configure({ mode: "serial" });

test("Portal: Anmeldung zeigt nur die Firmen aus den eigenen Inhaber-Gruppen", async ({ browser }) => {
  const page = await portalAnmelden(browser, "familie, haben-inhaber, haben-sued-inhaber, haben-west-steuerberatung");
  await page.waitForURL(`${PORTAL}/`);
  await expect(firmen(page)).toHaveText(["Studio Nord", "Werkstatt Süd"]);
  await expect(firmen(page).first()).toHaveAttribute("href", BASE);
  await expect(page.getByText("Atelier West")).toHaveCount(0);
  await ohneVerstoesse(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await ohneVerstoesse(page);
  await page.context().close();
});

test("Portal: die Steuerberatung sieht keine Firma", async ({ browser }) => {
  const page = await portalAnmelden(browser, "haben-steuerberatung, haben-sued-steuerberatung");
  await page.waitForURL(`${PORTAL}/`);
  await expect(page.getByText("in keiner Firma als Inhaber")).toBeVisible();
  await expect(firmen(page)).toHaveCount(0);
  await page.context().close();
});

test("Portal: mit genau einer Firma geht es nach der Anmeldung direkt dorthin", async ({ browser }) => {
  const context = await browser.newContext();
  await context.route("https://sued.example.de/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>Süd</title>Werkstatt Süd" }));
  const page = await context.newPage();
  await page.goto(`${PORTAL}/`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Mit Test-SSO anmelden" }).click();
  await anbieter(page, "sued@example.de", "haben-sued-inhaber");
  await page.waitForURL("https://sued.example.de/");
  await context.close();
});

test("Haben: „Firma wechseln“ führt ins Portal, ohne aufzuklappen, und zurück zur Firma", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await habenAnmelden(page, "haben-inhaber");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  const wechseln = nav.getByRole("link", { name: "Firma wechseln" });
  await expect(wechseln).toHaveAttribute("href", PORTAL);
  await expect(wechseln).not.toHaveAttribute("target");
  await expect(nav.getByRole("button", { name: "Firma wechseln" })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await wechseln.click();
  await page.waitForURL(`${PORTAL}/`);
  await page.getByRole("link", { name: "Mit Test-SSO anmelden" }).click();
  await anbieter(page, "inhaberin@example.de", "haben-inhaber, haben-sued-inhaber");
  await page.waitForURL(`${PORTAL}/`);
  await firmen(page).filter({ hasText: "Studio Nord" }).click();
  await page.waitForURL(`${BASE}/`);
  await expect(nav.getByRole("link", { name: "Firma wechseln" })).toBeVisible();

  // Abmelden im Portal: danach wieder die Anmeldung
  await page.goto(`${PORTAL}/`);
  await page.getByRole("button", { name: "Abmelden" }).click();
  await page.goto(`${PORTAL}/`);
  await expect(page.getByRole("link", { name: "Mit Test-SSO anmelden" })).toBeVisible();
  await context.close();
});
