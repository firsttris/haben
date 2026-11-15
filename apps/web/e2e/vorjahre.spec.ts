import { expect, test, type Page } from "@playwright/test";
import { currentYear } from "./daten.ts";
import { kontaktAnlegen, einrichten, rechnungFestschreiben } from "./einrichtung.ts";

/*
 * Was aus früheren Jahren noch offen ist (#1110): Die Tabellen der offenen Posten zeigen den Stand von heute,
 * unabhängig vom gewählten Jahr. Über der Tabelle steht, wie viele Posten aus früheren Jahren stammen, und die
 * Spalte „Jahr“ kennzeichnet sie. Am Handy gibt es die Spalte nicht, dort hängt der Vermerk an der Fälligkeit.
 * Eigener Durchlauf, damit die Rechnungen aus dem Vorjahr nicht die Zahlen der übrigen Tests verschieben.
 */

test.describe.configure({ mode: "serial" });

const CUSTOMER = { name: "Klintwerk Digital GmbH", street: "Werkstraße 8", zip: "24103", city: "Kiel" };
const JAHR = currentYear();
const KUNDE = `${CUSTOMER.name} · ${CUSTOMER.city}`;
const THEMES = ["light", "dark"] as const;
const BREITEN = {
  desktop: { width: 1440, height: 900 },
  handy: { width: 390, height: 844 },
} as const;

let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin", viewport: BREITEN.desktop })).newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await einrichten(page);
  await kontaktAnlegen(page, CUSTOMER);
  // Zwei Rechnungen aus früheren Jahren, beide ohne Zahlung: eine aus dem Vorjahr, eine aus dem Jahr davor
  await rechnungFestschreiben(page, { customer: KUNDE, date: `${JAHR - 1}-06-03`, lines: [["Wartung Altjahr", "1", "100,00"]], gross: "119,00" });
  await rechnungFestschreiben(page, { customer: KUNDE, date: `${JAHR - 2}-11-30`, lines: [["Lizenz Altjahr", "1", "200,00"]], gross: "238,00" });
});

test.afterAll(async () => {
  await page?.context().close();
  expect(errors).toEqual([]);
});

const forderungen = (p: Page) => p.getByRole("region", { name: "Offene Forderungen", exact: true });
const zeile = (p: Page, jahr: number) =>
  forderungen(p)
    .getByRole("row")
    .filter({ has: p.locator("td.jahr", { hasText: String(jahr) }) });

for (const theme of THEMES) {
  for (const [geraet, viewport] of Object.entries(BREITEN)) {
    test(`${theme}, ${geraet}: Vorjahresposten sind über der Tabelle gezählt und in der Zeile gekennzeichnet`, async () => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/auswertungen?jahr=${JAHR}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(`Auswertungen ${JAHR}`);

      // Die Zeile über der Tabelle nennt Zahl und Betrag, die Tabellen selbst bleiben beim Stand von heute
      const hinweis = forderungen(page).getByText(/offene[rn]? Posten? aus (einem |früheren )/);
      await expect(hinweis).toBeVisible();
      await expect(hinweis).toContainText("2 offene Posten aus früheren Jahren");
      await expect(hinweis).toContainText("357,00");

      for (const jahr of [JAHR - 1, JAHR - 2]) {
        await expect(zeile(page, jahr)).toHaveCount(1);
        if (geraet === "desktop") {
          // Die Spalte „Jahr“ trägt das Jahr des Postens und hebt das Vorjahr hervor
          await expect(zeile(page, jahr).locator("td.jahr")).toHaveText(String(jahr));
          await expect(zeile(page, jahr).locator("td.jahr")).toHaveClass(/vorjahr/);
        } else {
          // Am Handy fehlt die Spalte; der Vermerk steht an der Fälligkeit
          await expect(zeile(page, jahr)).toContainText(`aus ${jahr}`);
        }
      }
      // Nichts ist abgeschnitten, auch nicht am schmalen Handy
      const ueberstand = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ueberstand, "waagerechter Überstand").toBeLessThanOrEqual(0);
    });
  }
}

test("Ohne Vorjahresposten steht die Zeile nicht da", async () => {
  await page.setViewportSize(BREITEN.desktop);
  await page.emulateMedia({ colorScheme: "light" });
  // Im Jahr davor gibt es nur den Posten aus dem Jahr davor: für 2025 ist nichts vor 2025 offen
  await page.goto(`/auswertungen?jahr=${JAHR - 2}`);
  await page.waitForLoadState("networkidle");
  await expect(forderungen(page).getByText(/Posten? aus einem früheren Jahr|Posten aus früheren Jahren/)).toHaveCount(0);
});
