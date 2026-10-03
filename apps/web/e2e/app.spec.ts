import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Ein Durchlauf wie im echten Betrieb, in einer leeren Datenbank: Konto einrichten, Kunden anlegen,
 * Rechnungen schreiben, einen Beleg buchen, den Kontoauszug importieren und zuordnen. Danach müssen
 * Buchungen und Konten stimmen; zum Schluss gibt es von jeder Seite einen Screenshot (Desktop und Handy)
 * unter test-results/screenshots.
 */

test.describe.configure({ mode: "serial" });

const USER = { name: "Max Mustermann", email: "max@example.com", password: "ein-sehr-langes-e2e-passwort" };
const SHOTS = "test-results/screenshots";

// Alle Daten im selben Jahr: Anfang Januar rechnet der Test im Dezember des Vorjahres
const today = new Date();
const startOfYear = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
const base = today.getTime() - startOfYear.getTime() < 50 * 86_400_000 ? new Date(Date.UTC(today.getUTCFullYear() - 1, 11, 20)) : today;
const YEAR = base.getUTCFullYear();
const day = (offset: number) => new Date(base.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
/** Datum im DKB-Format: 14.09.26 */
const dkb = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;

const CUSTOMERS = [
  { name: "Nordwerk Software GmbH", street: "Hafenstraße 5", zip: "20457", city: "Hamburg" },
  { name: "Alpenblick Media AG", street: "Sonnenstraße 12", zip: "80331", city: "München" },
  { name: "Rheinpixel GmbH", street: "Mediapark 8", zip: "50670", city: "Köln" },
];

const INVOICES = [
  { customer: "Nordwerk Software GmbH · Hamburg", date: day(-40), lines: [["Softwareentwicklung", "96", "95,00"]], gross: "10.852,80" },
  { customer: "Alpenblick Media AG · München", date: day(-30), lines: [["Beratung Architektur", "3", "960,00"], ["Workshop-Unterlagen", "1", "250,00"]], gross: "3.724,70" },
  { customer: "Rheinpixel GmbH · Köln", date: day(-12), lines: [["Wartung und Support", "1", "1.450,00"]], gross: "1.725,50" },
];

let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
});

test.afterAll(async () => {
  await page.close();
});

async function go(path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** Erfundene Mobilfunkrechnung als JPEG, gerendert im Browser */
async function receiptJpeg(browser: Browser): Promise<Buffer> {
  const p = await browser.newPage({ viewport: { width: 620, height: 640 } });
  await p.setContent(`<body style="font: 14px sans-serif; padding: 40px">
    <h2>Funknetz Mobil GmbH</h2><p>Hafenallee 10 · 28217 Bremen · USt-IdNr. DE298765432</p>
    <h1>Mobilfunkrechnung</h1><p>Rechnungsnummer MF-0815 · Rechnungsdatum ${day(-9)}</p>
    <table style="width:100%"><tr><td>Tarif Business M</td><td align="right">38,57 €</td></tr>
    <tr><td>Umsatzsteuer 19 %</td><td align="right">7,33 €</td></tr><tr><th align="left">Rechnungsbetrag</th><th align="right">45,90 €</th></tr></table>
  </body>`);
  const jpeg = await p.screenshot({ type: "jpeg", quality: 80 });
  await p.close();
  return jpeg;
}

test("Einrichtung: Konto, Firmendaten und Rechnungsnummer", async () => {
  await go("/");
  await expect(page).toHaveURL(/\/setup/);
  await page.getByLabel("Name").fill(USER.name);
  await page.getByLabel("E-Mail").fill(USER.email);
  await page.getByLabel(/Passwort/).fill(USER.password);
  await page.getByRole("button", { name: "Konto anlegen" }).click();
  await page.getByRole("button", { name: "Später" }).click();
  await page.waitForURL("**/einstellungen");
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Name", { exact: true }).fill("Mustermann IT · Max Mustermann");
  await page.getByLabel("E-Mail", { exact: true }).fill("rechnung@mustermann.example");
  await page.getByLabel("Straße und Hausnummer").fill("Musterstraße 12");
  await page.getByLabel("PLZ").fill("93047");
  await page.getByLabel("Ort").fill("Regensburg");
  await page.getByLabel("Bundesland").selectOption("BY");
  await page.getByLabel(/^Steuernummer/).fill("198/113/10010");
  await page.getByLabel("IBAN").fill("DE89370400440532013000");
  await page.getByRole("button", { name: "Speichern" }).first().click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
});

test("Kunden anlegen", async () => {
  for (const c of CUSTOMERS) {
    await go("/kontakte/neu");
    await page.getByLabel("Name oder Firma").fill(c.name);
    await page.getByLabel("Straße und Hausnummer").fill(c.street);
    await page.getByLabel("PLZ").fill(c.zip);
    await page.getByLabel("Ort").fill(c.city);
    await page.getByRole("button", { name: "Kontakt anlegen" }).click();
    await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  }
  await go("/kontakte");
  for (const c of CUSTOMERS) await expect(page.getByText(c.name).first()).toBeVisible();
});

test("Rechnungen schreiben und festschreiben", async () => {
  for (const invoice of INVOICES) {
    await go("/rechnungen/neu");
    await page.getByLabel("Kunde").selectOption({ label: invoice.customer });
    await page.getByLabel("Rechnungsdatum").fill(invoice.date);
    for (const [i, [description, quantity, price]] of invoice.lines.entries()) {
      if (i > 0) await page.getByRole("button", { name: "+ Position hinzufügen" }).click();
      await page.getByLabel(`Beschreibung Position ${i + 1}`).fill(description!);
      await page.getByLabel(`Menge Position ${i + 1}`).fill(quantity!);
      await page.getByLabel(new RegExp(`Einzelpreis Position ${i + 1}`)).fill(price!);
    }
    await page.getByRole("button", { name: "Entwurf speichern" }).click();
    await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Festschreiben" }).click();
    await page.getByRole("button", { name: "Jetzt festschreiben" }).click();
    await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`${invoice.gross} €`).first()).toBeVisible();
  }
});

test("Beleg hochladen und buchen", async ({ browser }) => {
  await go("/belege");
  await page.locator("input[type=file][multiple]").setInputFiles([{ name: "mobilfunk.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser) }]);
  await expect(page.getByText("mobilfunk.jpg: abgelegt.")).toBeVisible();
  await page.getByRole("link", { name: /mobilfunk\.jpg/ }).first().click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Lieferant", { exact: true }).fill("Funknetz Mobil GmbH");
  await page.getByLabel("Rechnungsnummer").fill("MF-0815");
  await page.getByLabel("Belegdatum").fill(day(-9));
  await page.getByLabel("Kategorie").selectOption("telefon");
  await page.getByLabel("Netto", { exact: true }).fill("38,57");
  await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
  await page.getByRole("button", { name: "Jetzt buchen" }).click();
  await expect(page.getByText(/Gebucht .*festgeschrieben/)).toBeVisible();
});

test("Kontoauszug importieren und zuordnen", async () => {
  const rows = [
    [day(-1), "Rheinpixel GmbH", "Max Mustermann", "Rechnung Wartung", "Eingang", "1.725,50"],
    [day(-6), "Max Mustermann", "Funknetz Mobil GmbH", "Mobilfunk MF-0815", "Ausgang", "-45,90"],
    [day(-8), "Alpenblick Media AG", "Max Mustermann", "Rechnung Beratung", "Eingang", "3.724,70"],
    [day(-25), "Nordwerk Software GmbH", "Max Mustermann", "Rechnung Softwareentwicklung", "Eingang", "10.852,80"],
  ];
  const csv =
    "﻿" +
    `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom ${dkb(day(0))}:";"16.257,10 €"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    rows.map(([date, from, to, purpose, type, amount]) => [dkb(date!), dkb(date!), "Gebucht", from, to, purpose, type, "DE02100100100006820101", amount, "", "", ""].map((v) => `"${v}"`).join(";")).join("\n") +
    "\n";
  await go("/bank");
  await page.locator('input[type=file][aria-label="Kontoauszugsdateien"]').setInputFiles([{ name: "dkb.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/4 neue Umsätze/)).toBeVisible({ timeout: 30_000 });

  for (const party of ["Nordwerk Software GmbH", "Alpenblick Media AG", "Funknetz Mobil GmbH"]) {
    await go("/bank");
    await page.getByRole("link", { name: new RegExp(party) }).first().click();
    await page.waitForLoadState("networkidle");
    // Erst zuordnen, wenn rechts der angeklickte Umsatz steht
    await expect(page.getByRole("heading", { name: party })).toBeVisible();
    await expect(page.getByText("Bester Treffer")).toBeVisible();
    await page.getByRole("button", { name: "Zuordnen" }).click();
    await expect(page.getByText("Zugeordnet", { exact: true }).first()).toBeVisible();
  }
});

test("Buchungen und Konten stimmen mit den Vorgängen überein", async () => {
  await go(`/konten?jahr=${YEAR}&zeitraum=jahr`);
  const kpis = page.getByLabel("Kennzahlen");
  // Bank: 10.852,80 + 3.724,70 − 45,90 (Rheinpixel ist noch nicht zugeordnet)
  await expect(kpis.getByText("14.531,60 €")).toBeVisible();
  // Offene Forderung: Rheinpixel
  await expect(kpis.getByText("1.725,50 €")).toBeVisible();
  // Erlöse: 9.120 + 3.130 + 1.450 = 13.700 netto, Aufwand 38,57
  await expect(kpis.getByText("13.661,43 €")).toBeVisible();
  // Soll und Haben sind ausgeglichen
  const foot = page.locator("tfoot tr").first();
  const [soll, haben] = await foot.locator("td.num").allInnerTexts();
  expect(soll).toBe(haben);

  await page.getByRole("link", { name: "1200", exact: true }).click();
  await page.waitForURL(/\/konten\/1200/);
  await expect(page.getByRole("heading", { name: /1200/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Saldoverlauf Konto 1200/ })).toBeVisible();
  await expect(page.getByText("14.531,60 €").first()).toBeVisible();

  // Journal: Filter nach Herkunft
  const month = Number(day(-12).slice(5, 7));
  await go(`/buchungen?jahr=${YEAR}&monat=${month}`);
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: /^Rechnung \(/ }).click();
  for (const row of await page.locator("tbody tr:not(.lines-row)").all()) {
    if ((await row.locator("td").count()) > 1) await expect(row.locator(".pill")).toHaveText(/Rechnung|Gegenbuchung/);
  }
});

test("Auswertungen, Umsatzsteuer und Jahreserklärung laden", async () => {
  await go("/auswertungen");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await go("/umsatzsteuer");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await go(`/jahreserklaerung/${YEAR - 1}`);
  await expect(page.getByRole("heading", { name: /Steuerjahr/ })).toBeVisible();
  await go("/finanzamt");
  await expect(page.getByRole("heading", { name: "Finanzamt", level: 1 })).toBeVisible();
});

/** Erste verlinkte Detailseite einer Liste, z. B. /rechnungen/<id> */
async function firstLink(list: string, pattern: RegExp): Promise<string | null> {
  await go(list);
  const href = await page.locator("a[href]").evaluateAll((links, source) => {
    const re = new RegExp(source);
    return links.map((a) => a.getAttribute("href") ?? "").find((h) => re.test(h)) ?? null;
  }, pattern.source);
  return href;
}

test("Screenshots aller Seiten (Desktop und Handy)", async ({ browser }) => {
  const details = {
    rechnung: await firstLink("/rechnungen", /^\/rechnungen\/[0-9a-f-]{36}$/),
    beleg: await firstLink("/belege", /^\/belege\/[0-9a-f-]{36}$/),
    kontakt: await firstLink("/kontakte", /^\/kontakte\/[0-9a-f-]{36}$/),
  };
  const month = Number(day(-12).slice(5, 7));
  const routes: [string, string | null][] = [
    ["uebersicht", "/"],
    ["rechnungen", "/rechnungen"],
    ["rechnung-neu", "/rechnungen/neu"],
    ["rechnung", details.rechnung],
    ["mahnwesen", "/rechnungen/mahnwesen"],
    ["wiederkehrend", "/rechnungen/wiederkehrend"],
    ["belege", "/belege"],
    ["beleg", details.beleg],
    ["bank", "/bank"],
    ["anlagen", "/anlagen"],
    ["anlage-neu", "/anlagen/neu"],
    ["buchungen", `/buchungen?jahr=${YEAR}&monat=${month}`],
    ["konten", `/konten?jahr=${YEAR}`],
    ["kontenblatt", `/konten/1200?jahr=${YEAR}`],
    ["umsatzsteuer", "/umsatzsteuer"],
    ["jahreserklaerung", `/jahreserklaerung/${YEAR - 1}`],
    ["finanzamt", "/finanzamt"],
    ["auswertungen", "/auswertungen"],
    ["kontakte", "/kontakte"],
    ["kontakt", details.kontakt],
    ["archiv", "/archiv"],
    ["einstellungen", "/einstellungen"],
  ];
  const storage = await page.context().storageState();
  for (const [device, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobil", { width: 390, height: 844 }],
  ] as const) {
    mkdirSync(`${SHOTS}/${device}`, { recursive: true });
    const context = await browser.newContext({ viewport, storageState: storage, locale: "de-DE", timezoneId: "Europe/Berlin" });
    const p = await context.newPage();
    const errors: string[] = [];
    p.on("pageerror", (error) => errors.push(error.message));
    for (const [index, [name, path]] of routes.entries()) {
      if (!path) continue;
      const response = await p.goto(path);
      expect(response?.status(), `${path} lädt`).toBeLessThan(400);
      await p.waitForLoadState("networkidle");
      await expect(p.getByRole("heading", { level: 1 }).first(), `${path} hat eine Überschrift`).toBeVisible();
      // Kein waagrechtes Scrollen der ganzen Seite auf dem Handy
      if (device === "mobil") {
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect.soft(overflow, `${path} ist nicht breiter als das Handy`).toBeLessThanOrEqual(1);
      }
      await p.screenshot({ path: `${SHOTS}/${device}/${String(index + 1).padStart(2, "0")}-${name}.png`, fullPage: true });
    }
    if (device === "mobil") {
      // Menü auf dem Handy: aufklappen, Seite wählen, schließt wieder
      await p.goto("/");
      await p.waitForLoadState("networkidle");
      await p.getByRole("button", { name: "Menü" }).click();
      await expect(p.getByRole("link", { name: "Konten" })).toBeVisible();
      await p.screenshot({ path: `${SHOTS}/mobil/00-menue.png` });
      await p.getByRole("link", { name: "Konten" }).click();
      await p.waitForURL(/\/konten/);
      await expect(p.getByRole("link", { name: "Einstellungen" })).toBeHidden();
    }
    await context.close();
    expect(errors, `Fehler im Browser (${device})`).toEqual([]);
  }

  // Anmeldeseite ohne Sitzung
  const anonymous = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await anonymous.goto("/login");
  await anonymous.screenshot({ path: `${SHOTS}/desktop/00-login.png` });
  await anonymous.close();
  expect(pageErrors).toEqual([]);
});
