import { expect, test, type Page } from "@playwright/test";

/**
 * Die Bilder in README und Doku (docs/screenshot-*.png), aufgenommen mit den Daten, die app.spec.ts
 * davor angelegt hat: Kunden, festgeschriebene Rechnungen, ein gebuchter Beleg, der Kontoauszug mit
 * dem noch offenen Zahlungseingang von Rheinpixel. Läuft nur mit DOKU_SCREENSHOTS=1
 * (pnpm docs:screenshots, Workflow „Update screenshots“); der Dateiname sorgt dafür, dass es nach
 * app.spec.ts drankommt.
 */

test.describe.configure({ mode: "serial" });
test.skip(!process.env.DOKU_SCREENSHOTS, "nur für pnpm docs:screenshots");

const USER = { email: "max@example.com", password: "ein-sehr-langes-e2e-passwort" };
const DOCS = "../../docs";
const DESKTOP = { width: 1440, height: 900 };
const MOBIL = { width: 390, height: 844 };

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: DESKTOP, locale: "de-DE", timezoneId: "Europe/Berlin" });
  await page.goto("/login");
  await page.getByRole("button", { name: "Passwort verwenden" }).click();
  await page.getByLabel("E-Mail").fill(USER.email);
  await page.getByLabel("Passwort").fill(USER.password);
  await page.getByRole("button", { name: "Mit Passwort anmelden" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
});

test.afterAll(async () => {
  await page.close();
});

async function go(path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

async function shot(name: string, fullPage = false) {
  // Kein blinkender Cursor, keine halb abgelaufene Animation im Bild
  await page.screenshot({ path: `${DOCS}/screenshot-${name}.png`, fullPage, animations: "disabled", caret: "hide" });
}

test("Übersicht", async () => {
  await go("/");
  await shot("uebersicht");
});

test("Rechnung schreiben mit Vorschau", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Kunde").selectOption({ label: "Alpenblick Media AG · München" });
  await page.getByLabel("Beschreibung Position 1").fill("Konzeption und Umsetzung Kundenportal");
  await page.getByLabel("Menge Position 1").fill("24");
  await page.getByLabel(/Einzelpreis Position 1/).fill("95,00");
  await page.getByRole("button", { name: "+ Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 2").fill("Hosting");
  await page.getByLabel("Menge Position 2").fill("1");
  await page.getByLabel(/Einzelpreis Position 2/).fill("49,00");
  await expect(page.getByLabel("Vorschau der Rechnung")).toContainText("2.329,00");
  // Oben anfangen: Kopf, Kunde und Vorschau gehören ins Bild
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await shot("rechnung");
});

test("Bankabgleich mit Vorschlag", async () => {
  await go("/bank");
  await page.getByRole("link", { name: /Rheinpixel GmbH/ }).first().click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Rheinpixel GmbH" })).toBeVisible();
  await expect(page.getByText("Bester Treffer")).toBeVisible();
  await shot("bank");
});

test("Beleg mit ausgelesenen Feldern", async () => {
  // Der einzige gebuchte Beleg ist die Mobilfunkrechnung; in der Liste steht der Lieferant, nicht die Datei
  await go("/belege");
  const href = await page.locator("a[href]").evaluateAll((links) =>
    links.map((a) => a.getAttribute("href") ?? "").find((h) => /^\/belege\/[0-9a-f-]{36}$/.test(h)),
  );
  expect(href, "ein Beleg in der Liste").toBeTruthy();
  await go(href!);
  await shot("belege");
});

test("Umsatzsteuer, Auswertungen und Archiv", async () => {
  await go("/umsatzsteuer");
  await shot("umsatzsteuer");
  await go("/auswertungen");
  await shot("auswertungen");
  await go("/archiv");
  await shot("archiv", true);
});

test("Übersicht auf dem Handy", async () => {
  await page.setViewportSize(MOBIL);
  await go("/");
  await shot("mobil");
});
