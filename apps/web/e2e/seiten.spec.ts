import { expect, type Page, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { ANONYMOUS, day, fakeEigeneSeite, firstLink, fullPageScreenshot, SESSION, SHOTS, YEAR } from "./daten.ts";

/**
 * Von jeder Seite ein Screenshot (Desktop und Handy) unter test-results/screenshots, mit den Daten aus
 * app.spec.ts. Jede Seite muss laden, eine Überschrift haben und darf auf dem Handy nicht breiter sein als
 * der Bildschirm. Eine neue Seite gehört in ROUTES.
 */

test.use({ storageState: SESSION });

async function routes(page: Page): Promise<[string, string | null][]> {
  const details = {
    rechnung: await firstLink(page, "/rechnungen", /^\/rechnungen\/[0-9a-f-]{36}$/),
    beleg: await firstLink(page, "/belege", /^\/belege\/[0-9a-f-]{36}$/),
    kontakt: await firstLink(page, "/kontakte", /^\/kontakte\/[0-9a-f-]{36}$/),
    eigeneSeite: await firstLink(page, "/einstellungen?bereich=seiten", /^\/seiten\/[0-9a-f-]{36}$/),
  };
  const month = Number(day(-12).slice(5, 7));
  return [
    ["uebersicht", "/"],
    ["rechnungen", "/rechnungen"],
    ["rechnung-neu", "/rechnungen/neu"],
    ["angebote", "/angebote"],
    ["rechnung", details.rechnung],
    ["mahnwesen", "/rechnungen/mahnwesen"],
    ["wiederkehrend", "/rechnungen/wiederkehrend"],
    ["artikel", "/artikel"],
    ["textbausteine", "/textbausteine"],
    ["belege", "/belege"],
    ["beleg", details.beleg],
    ["ueberweisungen", "/ueberweisungen"],
    ["pauschalen", "/pauschalen"],
    ["kasse", "/kasse"],
    ["bank", "/bank"],
    ["anlagen", "/anlagen"],
    ["anlage-neu", "/anlagen/neu"],
    ["buchungen", `/buchungen?jahr=${YEAR}&monat=${month}`],
    ["buchung-erfassen", "/buchungen/neu"],
    ["jahresabschluss", `/abschluss/${YEAR - 1}`],
    ["ausschuettungen", "/ausschuettungen"],
    ["konten", `/konten?jahr=${YEAR}`],
    ["kontenblatt", `/konten/1200?jahr=${YEAR}`],
    ["umsatzsteuer", "/umsatzsteuer"],
    ["zusammenfassende-meldung", `/umsatzsteuer/zm/${YEAR + 1}-Q1`],
    ["jahreserklaerung", `/jahreserklaerung/${YEAR - 1}`],
    ["finanzamt", "/finanzamt"],
    ["fristen", "/fristen"],
    ["auswertungen", "/auswertungen"],
    ["kontakte", "/kontakte"],
    ["kontakt", details.kontakt],
    ["archiv", "/archiv"],
    ["einstellungen", "/einstellungen"],
    ["einstellungen-elster", "/einstellungen?bereich=elster"],
    ["einstellungen-email", "/einstellungen?bereich=email"],
    ["einstellungen-bank", "/einstellungen?bereich=bank"],
    ["einstellungen-ki", "/einstellungen?bereich=ki"],
    ["einstellungen-export", "/einstellungen?bereich=export"],
    ["einstellungen-seiten", "/einstellungen?bereich=seiten"],
    ["eigene-seite", details.eigeneSeite],
  ];
}

/** Zwei Hälften je Gerät, damit sich die Seiten auf die Worker verteilen */
const HALVES = [0, 1] as const;

for (const [device, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobil", { width: 390, height: 844 }],
] as const) {
  for (const half of HALVES) {
    test(`Screenshots aller Seiten (${device}, Teil ${half + 1})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await fakeEigeneSeite(page);
      mkdirSync(`${SHOTS}/${device}`, { recursive: true });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const all = await routes(page);
      const middle = Math.ceil(all.length / 2);
      for (const [index, [name, path]] of all.entries()) {
        if (!path || index < middle !== (half === 0)) continue;
        const response = await page.goto(path);
        expect(response?.status(), `${path} lädt`).toBeLessThan(400);
        await page.waitForLoadState("networkidle");
        await expect(page.getByRole("heading", { level: 1 }).first(), `${path} hat eine Überschrift`).toBeVisible();
        // Kein waagrechtes Scrollen der ganzen Seite auf dem Handy
        if (device === "mobil") {
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect.soft(overflow, `${path} ist nicht breiter als das Handy`).toBeLessThanOrEqual(1);
        }
        await fullPageScreenshot(page, { path: `${SHOTS}/${device}/${String(index + 1).padStart(2, "0")}-${name}.png` });
      }
      if (device === "mobil" && half === 1) {
        // Menü auf dem Handy: aufklappen, Seite wählen, schließt wieder
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "Menü" }).click();
        await expect(page.getByRole("link", { name: "Konten" })).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/mobil/00-menue.png` });
        await page.getByRole("link", { name: "Konten" }).click();
        await page.waitForURL(/\/konten/);
        await expect(page.getByRole("link", { name: "Einstellungen" })).toBeHidden();
      }
      expect(errors, `Fehler im Browser (${device})`).toEqual([]);
    });
  }
}

test("Screenshot der Anmeldeseite ohne Sitzung", async ({ browser }) => {
  const anonymous = await browser.newPage({ ...ANONYMOUS, viewport: { width: 1440, height: 900 } });
  mkdirSync(`${SHOTS}/desktop`, { recursive: true });
  await anonymous.goto("/login");
  await anonymous.screenshot({ path: `${SHOTS}/desktop/00-login.png` });
  await anonymous.close();
});
