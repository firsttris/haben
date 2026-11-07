import { expect, type Page, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { ANONYMOUS, day, fakeEigeneSeite, firstLink, fullPageScreenshot, SESSION, SHOTS, YEAR } from "./daten.ts";

/**
 * Lädt jede Seite (Desktop und Handy) mit den Daten aus app.spec.ts: Jede Seite muss laden, eine Überschrift
 * haben und darf auf dem Handy nicht breiter sein als der Bildschirm. Mit SEITEN_SCREENSHOTS=1 (CI auf main)
 * legt der Test von jeder Seite einen Screenshot unter test-results/screenshots ab; im Pull Request spart das
 * Fotografieren der ganzen Seiten rund eine halbe Minute. Eine neue Seite gehört in ROUTES.
 */

test.use({ storageState: SESSION });

const SCREENSHOTS = Boolean(process.env.SEITEN_SCREENSHOTS);

async function routes(page: Page): Promise<[string, string | null][]> {
  const details = {
    rechnung: await firstLink(page, "/rechnungen", /^\/rechnungen\/[0-9a-f-]{36}$/),
    beleg: await firstLink(page, "/belege", /^\/belege\/[0-9a-f-]{36}$/),
    kontakt: await firstLink(page, "/kontakte", /^\/kontakte\/[0-9a-f-]{36}$/),
    eigeneSeite: await firstLink(page, "/einstellungen?bereich=seiten", /^\/seiten\/[0-9a-f-]{36}$/),
    mitarbeiter: await firstLink(page, "/lohn", /^\/lohn\/mitarbeiter\/[0-9a-f-]{36}$/),
    dauerbeleg: await firstLink(page, "/dauerbelege", /^\/dauerbelege\/[0-9a-f-]{36}$/),
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
    ["dauerbelege", "/dauerbelege"],
    ["dauerbeleg-neu", "/dauerbelege/neu"],
    ["dauerbeleg", details.dauerbeleg],
    ["ueberweisungen", "/ueberweisungen"],
    ["pauschalen", "/pauschalen"],
    ["kasse", "/kasse"],
    ["darlehen", "/darlehen"],
    ["bank", "/bank"],
    ["anlagen", "/anlagen"],
    ["anlage-neu", "/anlagen/neu"],
    ["csv-import", "/csv-import?art=kontakte"],
    ["buchungen", `/buchungen?jahr=${YEAR}&monat=${month}`],
    ["buchung-erfassen", "/buchungen/neu"],
    ["jahresabschluss", `/abschluss/${YEAR - 1}`],
    ["ausschuettungen", "/ausschuettungen"],
    ["lohnsteuerbescheinigung", `/lohn/bescheinigung/${YEAR}`],
    ["lohn", "/lohn"],
    ["mitarbeiter-neu", "/lohn/mitarbeiter/neu"],
    ["lohnsteuer-anmeldung", `/lohn/anmeldung/${YEAR}`],
    ["mitarbeiter", details.mitarbeiter],
    ["sv-meldeportal", "/sv-meldeportal"],
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
    ["archiv-auftraege", "/archiv?ansicht=auftraege"],
    ["archiv-auftrag", "/archiv/auftrag/723bf34b-f8ab-48f0-b391-656af4b72a96"],
    ["einstellungen", "/einstellungen"],
    ["einstellungen-elster", "/einstellungen?bereich=elster"],
    ["einstellungen-email", "/einstellungen?bereich=email"],
    ["einstellungen-bank", "/einstellungen?bereich=bank"],
    ["einstellungen-ki", "/einstellungen?bereich=ki"],
    ["einstellungen-export", "/einstellungen?bereich=export"],
    ["einstellungen-seiten", "/einstellungen?bereich=seiten"],
    ["einstellungen-sicherheit", "/einstellungen?bereich=sicherheit"],
    ["steuerberatung", "/steuerberatung"],
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
    test(`Alle Seiten laden (${device}, Teil ${half + 1})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await fakeEigeneSeite(page);
      if (SCREENSHOTS) mkdirSync(`${SHOTS}/${device}`, { recursive: true });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const all = await routes(page);
      const middle = Math.ceil(all.length / 2);
      for (const [index, [name, path]] of all.entries()) {
        if (!path || index < middle !== (half === 0)) continue;
        const response = await page.goto(path);
        expect(response?.status(), `${path} lädt`).toBeLessThan(400);
        // Die Seite kommt fertig vom Server; auf Ruhe im Netz (500 ms je Seite) wartet nur der Screenshot
        if (SCREENSHOTS) await page.waitForLoadState("networkidle");
        await expect(page.getByRole("heading", { level: 1 }).first(), `${path} hat eine Überschrift`).toBeVisible();
        // Kein waagrechtes Scrollen der ganzen Seite auf dem Handy
        if (device === "mobil") {
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect.soft(overflow, `${path} ist nicht breiter als das Handy`).toBeLessThanOrEqual(1);
        }
        if (SCREENSHOTS) await fullPageScreenshot(page, { path: `${SHOTS}/${device}/${String(index + 1).padStart(2, "0")}-${name}.png` });
      }
      if (device === "mobil" && half === 1) {
        // Menü auf dem Handy: aufklappen, Seite wählen, schließt wieder
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "Menü" }).click();
        await expect(page.getByRole("link", { name: "Konten" })).toBeVisible();
        if (SCREENSHOTS) await page.screenshot({ path: `${SHOTS}/mobil/00-menue.png` });
        await page.getByRole("link", { name: "Konten" }).click();
        await page.waitForURL(/\/konten/);
        await expect(page.getByRole("link", { name: "Einstellungen" })).toBeHidden();
      }
      expect(errors, `Fehler im Browser (${device})`).toEqual([]);
    });
  }
}

test("Screenshot der Anmeldeseite ohne Sitzung", async ({ browser }) => {
  test.skip(!SCREENSHOTS, "nur mit SEITEN_SCREENSHOTS=1");
  const anonymous = await browser.newPage({ ...ANONYMOUS, viewport: { width: 1440, height: 900 } });
  mkdirSync(`${SHOTS}/desktop`, { recursive: true });
  await anonymous.goto("/login");
  await anonymous.screenshot({ path: `${SHOTS}/desktop/00-login.png` });
  await anonymous.close();
});

/** Gültige UUID, zu der es nichts gibt */
const UNBEKANNT = "00000000-0000-4000-8000-000000000000";

test("Unbekannter Datensatz oder kaputte Adresse: 404 mit deutscher Seite im Layout", async ({ page }) => {
  const detailseiten = [
    "/belege",
    "/rechnungen",
    "/kontakte",
    "/angebote",
    "/anlagen",
    "/dauerbelege",
    "/rechnungen/wiederkehrend",
    "/archiv/beleg",
    "/archiv/auftrag",
    "/lohn/mitarbeiter",
    "/seiten",
  ];
  for (const path of [...detailseiten.flatMap((seite) => [`${seite}/${UNBEKANNT}`, `${seite}/kaputt`]), "/rechnungen/mahnwesen/kaputt", "/abschluss/1999"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Seite nicht gefunden" }), path).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Hauptnavigation" }), path).toBeVisible();
  }
  await page.getByRole("link", { name: "Zur Übersicht" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("Mahnung zu einer unbekannten Rechnung: 404 wie bei den anderen Detailseiten", async ({ page }) => {
  const response = await page.goto(`/rechnungen/mahnwesen/${UNBEKANNT}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Seite nicht gefunden" })).toBeVisible();
});

test("Ungültiger Wert in der Adresse: deutsche Fehlerseite statt englischer Meldung", async ({ page }) => {
  for (const path of ["/auswertungen?jahr=1999", "/buchungen?jahr=1999&monat=1"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Seite konnte nicht geladen werden" }), path).toBeVisible();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  }
});

test("Jahres- und Monatswechsel enden an den Grenzen der gültigen Jahre", async ({ page }) => {
  await page.goto("/auswertungen?jahr=2000");
  await expect(page.getByRole("link", { name: "Folgejahr 2001" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Vorjahr 1999" })).toHaveCount(0);
  await page.goto("/auswertungen?jahr=2100");
  await expect(page.getByRole("link", { name: "Vorjahr 2099" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Folgejahr 2101" })).toHaveCount(0);
  await page.goto("/buchungen?jahr=2000&monat=1");
  await expect(page.getByRole("link", { name: /1999/ })).toHaveCount(0);
  await page.goto("/buchungen?jahr=2100&monat=12");
  await expect(page.getByRole("link", { name: /2101/ })).toHaveCount(0);
});
