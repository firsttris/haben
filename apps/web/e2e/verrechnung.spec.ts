import { expect, test, type Browser, type Page } from "@playwright/test";
import { currentDay, day } from "./daten.ts";
import { axeVerstoesse, bestaetigen, durchlaufSeite, einrichten, gehe, ohneAxeVerstoesse } from "./einrichtung.ts";

/**
 * Verrechnung zweier Eingangsbelege ohne Zahlung (#274), eigener Durchlauf mit leerer Datenbank (e2e/durchlaeufe.ts,
 * Projekt „verrechnung“): Rechnung und Gutschrift desselben Lieferanten entstehen über die Oberfläche, verrechnet und
 * wieder aufgehoben wird in der Karte der Beleg-Detailseite. axe prüft die Seite mit der Karte (WCAG 2.2 AA, Desktop
 * und Handy), damit die Karte nicht nur im Code, sondern auch im Browser ohne Verstoß bleibt.
 */

test.describe.configure({ mode: "serial" });

let page: Page;
let pageErrors: string[] = [];
let rechnung: string;
let gutschrift: string;

const LIEFERANT = "Telekom Deutschland GmbH";
const RECHNUNG = { nummer: "VR-1001", datum: day(-20), netto: "100,00", betrag: "119,00 €" };
const GUTSCHRIFT = { nummer: "VR-1002", datum: day(-6), netto: "-30,00", betrag: "-35,70 €" };
/** Teilbetrag der Verrechnung: danach bleiben auf beiden Belegen Reste offen */
const VERECHNET = "20,00 €";
const GRUND = "Gutschrift VR-1002";

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
});

test.afterAll(async () => {
  await page.context().close();
});

/** Die Karte der Beleg-Detailseite (section mit aria-labelledby auf den Titel „Verrechnung“) */
const karte = () => page.getByRole("region", { name: "Verrechnung" });
/** Der offene Rest, den die Karte oben nennt */
const offen = () => karte().locator("p.small.muted .mono");

/**
 * Beleg als JPEG im Browser rendern, über die Ablagefläche der Belegliste ablegen, die Felder füllen und buchen;
 * liefert die Beleg-ID. Nummer und Art stehen auch im Bild, damit die beiden Belege nicht als Dublette gelten.
 */
async function belegAnlegen(browser: Browser, beleg: { nummer: string; datum: string; netto: string; art: string }): Promise<string> {
  const bild = await browser.newPage({ viewport: { width: 620, height: 460 } });
  await bild.setContent(`<body style="font: 15px sans-serif; padding: 36px">
    <h2>${LIEFERANT}</h2><p>${beleg.art} ${beleg.nummer} · ${beleg.datum}</p>
    <p>Mobilfunk Business · 1 Monat</p><p><strong>${beleg.netto} €</strong></p></body>`);
  const jpeg = await bild.screenshot({ type: "jpeg", quality: 80 });
  await bild.close();

  await gehe(page, "/belege");
  await page.locator("input[type=file][multiple]").setInputFiles([{ name: `${beleg.nummer}.jpg`, mimeType: "image/jpeg", buffer: jpeg }]);
  await expect(page.getByText(`${beleg.nummer}.jpg: abgelegt.`)).toBeVisible();
  await page
    .getByRole("link", { name: new RegExp(beleg.nummer) })
    .first()
    .click();
  await page.waitForURL(/\/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const id = page.url().match(/\/belege\/([0-9a-f-]{36})/)![1]!;

  await page.getByLabel("Lieferant", { exact: true }).fill(LIEFERANT);
  await page.getByLabel("Rechnungsnummer").fill(beleg.nummer);
  await page.getByLabel("Belegdatum").fill(beleg.datum);
  await page.getByLabel("Kategorie").selectOption("telefon");
  await page.getByLabel("Netto", { exact: true }).fill(beleg.netto);
  await page.locator(".doc-actions").getByRole("button", { name: "Bestätigen und buchen" }).click();
  await bestaetigen(page, "Buchen");
  await expect(page.locator(".page-head").getByText("Gebucht", { exact: true })).toBeVisible();
  return id;
}

test("Einrichtung", async () => {
  await einrichten(page);
});

test("Rechnung und Gutschrift desselben Lieferanten anlegen", async ({ browser }) => {
  rechnung = await belegAnlegen(browser, { ...RECHNUNG, art: "Rechnung" });
  gutschrift = await belegAnlegen(browser, { ...GUTSCHRIFT, art: "Gutschrift" });
  expect(rechnung).not.toBe(gutschrift);
});

test("Verrechnen: Gegenbeleg wählen, Teilbetrag und Grund eintragen, Datum stehen lassen", async () => {
  await gehe(page, `/belege/${rechnung}`);
  await expect(karte()).toBeVisible();
  await expect(offen()).toHaveText(RECHNUNG.betrag);

  await karte().getByRole("button", { name: "Mit einem Beleg verrechnen" }).click();
  await karte().getByLabel("Gegenbeleg").selectOption(gutschrift);
  // den ganzen Rest schlägt die Karte vor; verrechnet wird hier nur ein Teil, damit ein Rest offen bleibt
  await expect(karte().getByLabel("Betrag")).toHaveValue("35,70");
  await karte().getByLabel("Betrag").fill("20,00");
  // Pflichtfeld, vorbelegt mit heute: unangetastet absenden
  await expect(karte().getByLabel("Tag der Aufrechnung")).toHaveValue(currentDay());
  await karte().getByLabel("Grund", { exact: true }).fill(GRUND);
  await karte().getByRole("button", { name: "Verrechnen", exact: true }).click();

  await expect(karte().getByRole("status")).toContainText("Verrechnet: 20,00 EUR");
  const zeile = karte().getByRole("listitem");
  await expect(zeile).toHaveCount(1);
  await expect(zeile).toContainText(GRUND);
  await expect(zeile).toContainText(VERECHNET);
  await expect(offen()).toHaveText("99,00 €");

  // Die Gegenrichtung: die Gutschrift ist um denselben Betrag ausgeglichen
  await gehe(page, `/belege/${gutschrift}`);
  await expect(offen()).toHaveText("-15,70 €");
  await expect(karte().getByRole("listitem")).toContainText(VERECHNET);
});

test("Karte mit offenem Formular ohne axe-Verstöße", async () => {
  // Der Entwicklungsserver lädt beim ersten Aufruf Module nach und lädt die Seite dabei neu; dann noch einmal
  for (let versuch = 1; ; versuch++) {
    await gehe(page, `/belege/${rechnung}`);
    await karte().getByRole("button", { name: "Mit einem Beleg verrechnen" }).click();
    await expect(karte().getByLabel("Gegenbeleg")).toBeVisible();
    try {
      expect(await axeVerstoesse(page), "Verrechnungsformular").toEqual([]);
      return;
    } catch (error) {
      if (versuch >= 3 || !String(error).includes("Execution context was destroyed")) throw error;
    }
  }
});

test("Karte mit Verrechnung ohne axe-Verstöße und ohne Scrollen am Handy", async () => {
  await ohneAxeVerstoesse(page, [`/belege/${rechnung}`]);
});

test("Aufheben: der offene Rest ist wieder der volle Betrag", async () => {
  await gehe(page, `/belege/${rechnung}`);
  await expect(offen()).toHaveText("99,00 €");
  const zeile = karte().getByRole("listitem");
  await zeile.getByRole("button", { name: "aufheben" }).click();
  const formular = zeile.locator("form");
  // Pflichtfeld, vorbelegt mit heute: unangetastet absenden, dazu ein optionaler Grund
  await expect(formular.getByLabel("Tag der Aufhebung")).toHaveValue(currentDay());
  await formular.getByLabel("Grund (optional)").fill("versehentlich verrechnet");
  await formular.getByRole("button", { name: "Aufheben", exact: true }).click();

  await expect(karte().getByRole("status")).toContainText("Verrechnung aufgehoben");
  // Die aufgehobene Verrechnung verschwindet aus der Liste, statt einen zweiten "aufheben"-Knopf anzubieten
  await expect(karte().getByRole("listitem")).toHaveCount(0);
  // Aufgehoben wird per Gegenzeile: beide Belege tragen wieder ihren vollen offenen Rest
  await expect(offen()).toHaveText(RECHNUNG.betrag);
  await gehe(page, `/belege/${gutschrift}`);
  await expect(offen()).toHaveText(GUTSCHRIFT.betrag);
});

test("Keine Fehler im Browser", () => {
  expect(pageErrors).toEqual([]);
});
