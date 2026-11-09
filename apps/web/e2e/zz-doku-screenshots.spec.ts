import { expect, test, type Page } from "@playwright/test";
import { day, fullPageScreenshot, USER, vorschauAnheften, YEAR } from "./daten.ts";
import { dkb, kundeWaehlen, type Rechnung, rechnungFestschreiben } from "./einrichtung.ts";

/**
 * Die Bilder in README und Doku (docs/screenshot-*.png), aufgenommen mit den Daten, die app.spec.ts
 * davor angelegt hat: Kunden, festgeschriebene Rechnungen, ein gebuchter Beleg, der Kontoauszug mit
 * dem noch offenen Zahlungseingang von Rheinpixel. Läuft nur mit DOKU_SCREENSHOTS=1
 * (bun run docs:screenshots, Workflow „Update screenshots“), im Projekt „mit-daten“ nach app.spec.ts
 * (playwright.config.ts). Weil app.spec.ts nur anlegt, was die Tests brauchen, ergänzt der erste Test
 * Rechnungen über mehrere Monate mit Zahlungseingängen und Pauschalen, damit Übersicht, Umsatzsteuer und Auswertungen nach
 * Betrieb aussehen; die CI braucht diese Daten nicht und überspringt die Datei.
 */

test.describe.configure({ mode: "serial" });
test.skip(!process.env.DOKU_SCREENSHOTS, "nur für bun run docs:screenshots");

const DOCS = "../../docs";
const DESKTOP = { width: 1440, height: 900 };
const MOBIL = { width: 390, height: 844 };

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: DESKTOP, locale: "de-DE", timezoneId: "Europe/Berlin" });
  // Das Bild „Rechnung schreiben mit Vorschau“ zeigt Formular und Vorschau nebeneinander
  await vorschauAnheften(page);
  await page.goto("/login");
  // Erst nach dem Hydrieren reagiert der Knopf
  await page.waitForLoadState("networkidle");
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
  const options = { path: `${DOCS}/screenshot-${name}.png`, animations: "disabled", caret: "hide" } as const;
  await (fullPage ? fullPageScreenshot(page, options) : page.screenshot(options));
}

/** Rechnungen in den Monaten davor, nur im Jahr der übrigen Daten; alle bis auf die letzte nach zwölf Tagen bezahlt */
const FRUEHERE_RECHNUNGEN = (
  [
    ["Nordwerk Software GmbH", "Hamburg", -150, "Softwareentwicklung", "64", "95,00", "7.235,20"],
    ["Alpenblick Media AG", "München", -120, "Beratung Architektur", "4", "960,00", "4.569,60"],
    ["Nordwerk Software GmbH", "Hamburg", -95, "Softwareentwicklung", "80", "95,00", "9.044,00"],
    ["Rheinpixel GmbH", "Köln", -70, "Wartung und Support", "2", "1.450,00", "3.451,00"],
    ["Alpenblick Media AG", "München", -10, "Workshop Barrierefreiheit", "2", "1.200,00", "2.856,00"],
  ] as const
)
  .filter(([, , offset]) => day(offset).startsWith(String(YEAR)))
  .map(([name, city, offset, description, quantity, price, gross], index, all) => ({
    name,
    paidOn: index < all.length - 1 ? day(offset + 12) : undefined,
    rechnung: { customer: `${name} · ${city}`, date: day(offset), lines: [[description, quantity, price]], gross } satisfies Rechnung,
  }));

/** Kontostand aus app.spec.ts (Kontoauszug importieren) */
const KONTOSTAND_CENTS = 1_625_710;
const cents = (euro: string) => Number(euro.replace(/\./g, "").replace(",", ""));
const euro = (value: number) => (value / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 });

/** Zahlungseingänge auf dem Girokonto aus app.spec.ts, im Format der DKB, mit dem Kontostand danach */
function kontoauszug(zahlungen: { name: string; date: string; gross: string }[]): string {
  const stand = zahlungen.reduce((sum, z) => sum + cents(z.gross), KONTOSTAND_CENTS);
  const zeile = (z: (typeof zahlungen)[number]) =>
    [dkb(z.date), dkb(z.date), "Gebucht", z.name, "Max Mustermann", "Rechnung", "Eingang", "", z.gross, "", "", ""].map((v) => `"${v}"`).join(";");
  return (
    "\uFEFF" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n"Kontostand vom ${dkb(day(0))}:";"${euro(stand)} €"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    `${zahlungen.map(zeile).join("\n")}\n`
  );
}

test("Daten für die Bilder ergänzen", async () => {
  for (const { rechnung } of FRUEHERE_RECHNUNGEN) await rechnungFestschreiben(page, rechnung);

  // Die älteren Rechnungen sind bezahlt; der offene Eingang von Rheinpixel aus app.spec.ts bleibt für das Bild des Abgleichs
  const zahlungen = FRUEHERE_RECHNUNGEN.flatMap(({ name, paidOn, rechnung }) => (paidOn ? [{ name, date: paidOn, gross: rechnung.gross }] : []));
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "zahlungen.csv", mimeType: "text/csv", buffer: Buffer.from(kontoauszug(zahlungen)) }]);
  await expect(page.getByText(`${zahlungen.length} neue Umsätze`)).toBeVisible({ timeout: 30_000 });
  for (const { name, gross } of zahlungen) {
    await go("/bank");
    await page
      .getByRole("link", { name: new RegExp(`${name}.*${gross.replace(".", "\\.")}`) })
      .first()
      .click();
    await page.waitForLoadState("networkidle");
    // Erst zuordnen, wenn rechts der angeklickte Umsatz steht, nicht mehr der zuerst ausgewählte offene
    const panel = page.getByRole("complementary", { name: "Zuordnung" });
    await expect(panel.getByRole("heading", { name })).toBeVisible();
    await expect(panel).toContainText(`+${gross}`);
    await expect(panel.getByText("Bester Treffer")).toBeVisible();
    // Weiter erst, wenn die Zuordnung gespeichert ist; ein vorzeitiger Seitenwechsel bricht die Anfrage ab
    const gespeichert = page.waitForResponse((response) => response.request().method() === "POST" && response.ok());
    await panel.getByRole("button", { name: "Zuordnen", exact: true }).click();
    await gespeichert;
    await page.waitForLoadState("networkidle");
  }

  await go("/pauschalen");
  const neu = page.getByRole("region", { name: "Pauschale eintragen" });
  const homeoffice = neu.getByRole("form", { name: "Homeoffice-Pauschale" });
  await homeoffice.getByLabel("Tage im Homeoffice", { exact: true }).fill("16");
  await homeoffice.getByRole("button", { name: /buchen$/ }).click();
  await expect(neu.getByRole("status")).toContainText("gebucht");
  await neu.getByRole("button", { name: "Fahrt", exact: true }).click();
  const fahrt = neu.getByRole("form", { name: "Fahrt mit dem Privatfahrzeug" });
  await fahrt.getByLabel("Anlass und Ziel", { exact: true }).fill("Workshop Alpenblick, München");
  await fahrt.getByLabel("Kilometer einfach", { exact: true }).fill("120");
  await fahrt.getByRole("button", { name: /buchen$/ }).click();
  await expect(neu.getByRole("status")).toContainText("Fahrt über");
});

test("Übersicht", async () => {
  await go("/");
  await shot("uebersicht");
});

test("Rechnung schreiben mit Vorschau", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Alpenblick Media AG · München");
  await page.getByLabel("Beschreibung Position 1").fill("Konzeption und Umsetzung Kundenportal");
  await page.getByLabel("Menge Position 1").fill("24");
  await page.getByLabel(/Einzelpreis Position 1/).fill("95,00");
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
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
  await page
    .getByRole("link", { name: /Rheinpixel GmbH/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Rheinpixel GmbH" })).toBeVisible();
  await expect(page.getByText("Bester Treffer")).toBeVisible();
  await shot("bank");
});

test("Beleg mit ausgelesenen Feldern", async () => {
  // Die Mobilfunkrechnung mit Bild; der Beleg aus dem Dauerbeleg hat nur einen Platzhalter-Vertrag ohne Vorschau
  await go("/belege");
  const href = await page
    .getByRole("link", { name: /Funknetz Mobil GmbH/ })
    .first()
    .getAttribute("href");
  expect(href, "die Mobilfunkrechnung in der Liste").toBeTruthy();
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
