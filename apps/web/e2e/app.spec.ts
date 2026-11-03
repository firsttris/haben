import { expect, test, type Browser, type Page } from "@playwright/test";
import { zipSync } from "fflate";
import { mkdirSync, readFileSync } from "node:fs";
import { day, firstLink, SESSION, SHOTS, USER, YEAR } from "./daten.ts";

/**
 * Ein Durchlauf wie im echten Betrieb, in einer leeren Datenbank: Konto einrichten, Kunden anlegen,
 * Rechnungen schreiben, einen Beleg buchen, den Kontoauszug importieren und zuordnen. Danach müssen
 * Buchungen und Konten stimmen. Zum Schluss speichert der Test die Sitzung (SESSION); mit ihr und diesen
 * Daten laufen danach die Tests im Projekt „mit-daten“ parallel (playwright.config.ts).
 */

test.describe.configure({ mode: "serial" });

/** Wie HABEN_SETUP_CODE in playwright.config.ts */
const SETUP_CODE = "e2e-einrichtungscode";
/** Datum im DKB-Format: 14.09.26 */
const dkb = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;

const CUSTOMERS = [
  { name: "Nordwerk Software GmbH", street: "Hafenstraße 5", zip: "20457", city: "Hamburg" },
  { name: "Alpenblick Media AG", street: "Sonnenstraße 12", zip: "80331", city: "München" },
  { name: "Rheinpixel GmbH", street: "Mediapark 8", zip: "50670", city: "Köln" },
];

const INVOICES = [
  { customer: "Nordwerk Software GmbH · Hamburg", date: day(-40), lines: [["Softwareentwicklung", "96", "95,00"]], gross: "10.852,80" },
  {
    customer: "Alpenblick Media AG · München",
    date: day(-30),
    lines: [
      ["Beratung Architektur", "3", "960,00"],
      ["Workshop-Unterlagen", "1", "250,00"],
    ],
    gross: "3.724,70",
  },
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
async function receiptJpeg(browser: Browser, title = "Funknetz Mobil GmbH"): Promise<Buffer> {
  const p = await browser.newPage({ viewport: { width: 620, height: 640 } });
  await p.setContent(`<body style="font: 14px sans-serif; padding: 40px">
    <h2>${title}</h2><p>Hafenallee 10 · 28217 Bremen · USt-IdNr. DE298765432</p>
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
  await page.getByLabel("Einrichtungscode").fill(SETUP_CODE);
  await page.getByLabel("Name").fill(USER.name);
  await page.getByLabel("E-Mail").fill(USER.email);
  await page.getByLabel(/Passwort/).fill(USER.password);
  await page.getByRole("button", { name: "Konto anlegen" }).click();
  await page.getByRole("button", { name: "Später" }).click();
  await page.waitForURL("**/einstellungen");
  await page.waitForLoadState("networkidle");

  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("Name", { exact: true }).fill("Mustermann IT · Max Mustermann");
  await firma.getByLabel("E-Mail", { exact: true }).fill("rechnung@mustermann.example");
  await firma.getByLabel("Straße und Hausnummer").fill("Musterstraße 12");
  await firma.getByLabel("PLZ").fill("93047");
  await firma.getByLabel("Ort").fill("Regensburg");
  await firma.getByLabel("Bundesland").selectOption("BY");
  await firma.getByLabel(/^Steuernummer/).fill("198/113/10010");
  await firma.getByLabel("IBAN").fill("DE89370400440532013000");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();

  // Rechtsform (#213): Eine GmbH hat keine EÜR, keine Privatanteile und keine Pauschalen; vor der ersten Buchung frei wählbar
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByRole("link", { name: "Pauschalen" })).toBeVisible();
  await firma.getByLabel("Rechtsform").selectOption("gmbh");
  await expect(firma.getByLabel("Einkunftsart (für die Anlage EÜR)")).toHaveCount(0);
  await expect(firma.getByLabel("Privatanteil Telefon in %")).toHaveCount(0);
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(nav.getByRole("link", { name: "Pauschalen" })).toHaveCount(0);
  await go("/kasse");
  await expect(page.getByRole("button", { name: "Vom Gesellschafter" })).toBeVisible();
  await go("/einstellungen");
  await firma.getByLabel("Rechtsform").selectOption("einzelunternehmen");
  await expect(firma.getByLabel("Einkunftsart (für die Anlage EÜR)")).toBeVisible();
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(nav.getByRole("link", { name: "Pauschalen" })).toBeVisible();

  await go("/einstellungen?bereich=rechnungen");
  const logo = page.getByRole("region", { name: "Logo" });
  await logo.getByLabel("Logodatei").setInputFiles("public/icon-192.png");
  await expect(logo.getByRole("status")).toContainText("Logo gespeichert.");
  await expect(logo.getByRole("img", { name: "Aktuelles Logo" })).toBeVisible();

  const format = page.getByRole("form", { name: "Nummernformat" });
  await format.getByLabel("Rechnungen").fill("RE-{NNN}");
  await expect(format.getByText(/braucht das Jahr/)).toBeVisible();
  await expect(format.getByRole("button", { name: "Format speichern" })).toBeDisabled();
  await format.getByLabel("Rechnungen").fill("RE-{JJJJ}-{NNNN}");
  await expect(format).toContainText(/Beispiel: RE-\d{4}-0001, RE-\d{4}-0002/);
  await format.getByRole("button", { name: "Format speichern" }).click();
  await expect(format.getByRole("status")).toContainText("Nummernformat gespeichert.");
  await expect(page.getByRole("form", { name: /^Rechnungsnummern/ })).toContainText(/Nächste Nummer: RE-\d{4}-0001/);
  // Die folgenden Tests rechnen mit den Nummern ab Werk
  await format.getByRole("button", { name: "Auf Standard zurücksetzen" }).click();
  await expect(format.getByLabel("Rechnungen")).toHaveValue("{JJJJ}-{NNN}");

  const akzent = page.getByRole("form", { name: "Akzentfarbe" });
  await akzent.getByLabel("Hex-Wert").fill("#F5D90A");
  await expect(akzent.getByRole("status")).toContainText("schwer zu lesen");
  await akzent.getByLabel("Hex-Wert").fill("#1d4ed8");
  await akzent.getByRole("button", { name: "Übernehmen" }).click();
  await expect(akzent.getByRole("status")).toContainText("Akzentfarbe gespeichert.");
  await expect(akzent.getByLabel("Hex-Wert")).toHaveValue("#1D4ED8");
  await akzent.getByRole("button", { name: "Auf Standard zurücksetzen" }).click();
  await expect(akzent.getByLabel("Hex-Wert")).toHaveValue("#1F6F5C");
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
  // Die Suche filtert die Liste, ohne neu zu laden
  const liste = page.getByRole("region", { name: "Kontaktliste" });
  await page.getByPlaceholder(/^Suchen:/).fill("hamburg");
  await expect(liste.getByRole("link")).toHaveCount(1);
  await expect(liste).toContainText("Nordwerk Software GmbH");
  await page.getByPlaceholder(/^Suchen:/).fill("gibt es nicht");
  await expect(liste).toContainText("Kein Kontakt passt");
});

test("Kunde mit Rechnungen auf Englisch", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Harbour Labs Ltd");
  await page.getByLabel("Ort").fill("London");
  await page.getByRole("combobox", { name: /^Sprache von Rechnungen/ }).selectOption("en");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  await go("/rechnungen/neu");
  const sprache = page.getByRole("combobox", { name: /^Sprache/ });
  await expect(sprache).toHaveValue("de");
  await page.getByLabel("Kunde").selectOption({ label: "Harbour Labs Ltd · London" });
  await expect(sprache).toHaveValue("en");
  await expect(page.getByText("Das PDF erscheint auf Englisch")).toBeVisible();
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
  await page
    .getByRole("link", { name: /mobilfunk\.jpg/ })
    .first()
    .click();
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

  // Bis zur Zahlung steht der Beleg in der Übersicht unter den offenen Verbindlichkeiten
  await go("/");
  const payables = page.getByRole("link", { name: /Offene Verbindlichkeiten/ });
  await expect(payables).toContainText("45,90");
  await expect(payables).toContainText("1 Beleg");
  await payables.click();
  await page.waitForURL(/\/auswertungen#payables$/);
  await expect(page.locator("#payables")).toBeInViewport();
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
    rows
      .map(([date, from, to, purpose, type, amount]) =>
        [dkb(date!), dkb(date!), "Gebucht", from, to, purpose, type, "DE02100100100006820101", amount, "", "", ""].map((v) => `"${v}"`).join(";"),
      )
      .join("\n") +
    "\n";
  await go("/bank");
  await page.locator('input[type=file][aria-label="Kontoauszugsdateien"]').setInputFiles([{ name: "dkb.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/4 neue Umsätze/)).toBeVisible({ timeout: 30_000 });

  for (const party of ["Nordwerk Software GmbH", "Alpenblick Media AG", "Funknetz Mobil GmbH"]) {
    await go("/bank");
    await page
      .getByRole("link", { name: new RegExp(party) })
      .first()
      .click();
    await page.waitForLoadState("networkidle");
    // Erst zuordnen, wenn rechts der angeklickte Umsatz steht
    await expect(page.getByRole("heading", { name: party })).toBeVisible();
    await expect(page.getByText("Bester Treffer")).toBeVisible();
    await page.getByRole("button", { name: "Zuordnen" }).click();
    // Erst weiter, wenn die Zuordnung dieses Umsatzes gespeichert ist: danach springt die Auswahl zum nächsten offenen
    // Umsatz. Ein vorzeitiges Weiterklicken bricht die laufende Anfrage ab.
    await expect(page.getByRole("complementary", { name: "Zuordnung" }).getByRole("heading", { name: party })).toBeHidden();
    await page.waitForLoadState("networkidle");
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

test("Steuerdaten hinterlegen und Belege von ELSTER testweise abrufen", async () => {
  await go("/einstellungen?bereich=persoenlich");
  const taxpayer = page.getByRole("form", { name: "Persönliche Angaben" });
  await taxpayer.getByLabel("Steuer-ID").fill("65929970489");
  await taxpayer.getByLabel("Vorname").fill("Max");
  await taxpayer.getByLabel("Nachname").fill("Mustermann");
  await taxpayer.getByLabel("Geburtsdatum").fill("1985-04-12");
  await taxpayer.getByLabel("Art").selectOption("zusammen");
  const ehegatte = taxpayer.getByRole("group", { name: "Ehegatte (Person B)" });
  await ehegatte.getByLabel("Anrede").selectOption("Frau");
  await ehegatte.getByLabel("Steuer-ID").fill("86095742719");
  await ehegatte.getByLabel("Vorname").fill("Erika");
  await ehegatte.getByLabel("Nachname").fill("Mustermann");
  await ehegatte.getByLabel("Geburtsdatum").fill("1987-03-01");
  await taxpayer.getByRole("button", { name: "Speichern" }).click();
  await expect(taxpayer.getByRole("status")).toBeVisible();
  await go("/einstellungen?bereich=elster");
  const cert = page.getByRole("form", { name: "ELSTER-Zertifikat" });
  await cert
    .getByLabel("Zertifikatsdatei")
    .setInputFiles({ name: "test.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from("kein echtes Zertifikat") });
  await cert.getByRole("button", { name: "Hochladen" }).click();
  // Den Dateinamen zeigt schon die Dateiauswahl; „Entfernen“ gibt es erst, wenn das Zertifikat gespeichert ist
  await expect(cert.getByRole("button", { name: "Entfernen" })).toBeVisible();
  await expect(cert.getByText("test.pfx").first()).toBeVisible();
  const formate = page.getByRole("group", { name: "Formate prüfen" });
  await formate.getByRole("button", { name: "Formate mit ERiC prüfen" }).click();
  await expect(formate.getByRole("status")).toHaveText("Alle 8 Nachrichten sind gültig (simuliert, ohne ERiC).");

  // Ohne ERiC läuft der Abruf simuliert und liefert Beispielbelege
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const vast = page.getByRole("region", { name: `Belege von ELSTER ${YEAR - 1}` });
  await vast.getByLabel("Zertifikats-PIN").fill("123456");
  await vast.getByRole("button", { name: "Testweise abrufen" }).click();
  await expect(vast.getByRole("status")).toContainText("2 Belege bei ELSTER, 2 neu gespeichert.");
  await vast.getByText("Rentenbezugsmitteilung").click();
  await expect(vast.getByRole("cell", { name: "1.200,00 €" })).toBeVisible();

  // Berechtigung für die Belege des Ehegatten: beantragen und mit dem Code aus dem Brief freischalten
  await vast.getByLabel("Für").selectOption({ label: "Erika Mustermann" });
  const berechtigung = vast.getByRole("group", { name: "Berechtigung für Erika" });
  await expect(berechtigung).toContainText("noch keine (Test)");
  await vast.getByLabel("Zertifikats-PIN").fill("123456");
  await berechtigung.getByRole("button", { name: "Berechtigung beantragen" }).click();
  await expect(vast.getByRole("status")).toContainText("Erika bekommt von ELSTER einen Brief");
  await expect(berechtigung).toContainText("beantragt, wartet auf Freischaltung");
  await vast.screenshot({ path: `${SHOTS}/desktop/16c-berechtigung-beantragt.png` });
  await vast.getByLabel("Zertifikats-PIN").fill("123456");
  await berechtigung.getByLabel("Freischaltcode aus dem Brief").fill("ABCD-EFGH-1234");
  await berechtigung.getByRole("button", { name: "Freischalten" }).click();
  await expect(berechtigung).toContainText("genehmigt");
  mkdirSync(`${SHOTS}/desktop`, { recursive: true });
  await vast.screenshot({ path: `${SHOTS}/desktop/16b-belege-elster.png` });
});

test("Anlage N: Arbeitslohn des Ehegatten in der Einkommensteuer", async () => {
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const form = page.getByRole("form", { name: "Angaben zur Einkommensteuer" });
  const n = form.getByRole("group", { name: "Anlage N · Erika" });
  await n.getByLabel("Erika hatte Arbeitslohn aus einer Anstellung").check();
  const lstb = n.getByRole("group", { name: "Lohnsteuerbescheinigung 1 · Erika" });
  await lstb.getByLabel("Steuerklasse").selectOption("4");
  await lstb.getByLabel("Nr. 3 Bruttoarbeitslohn", { exact: true }).fill("42.000,00");
  await lstb.getByLabel("Nr. 4 Lohnsteuer", { exact: true }).fill("6.123,40");
  await lstb.getByLabel("Nr. 23a Rentenversicherung Arbeitnehmer", { exact: true }).fill("3.906,00");
  await lstb.getByLabel("Nr. 22a Rentenversicherung Arbeitgeber", { exact: true }).fill("3.906,00");
  await lstb.getByLabel("Nr. 25 Krankenversicherung", { exact: true }).fill("3.412,00");
  const wk = n.getByRole("group", { name: "Werbungskosten · Erika" });
  await wk.getByLabel("Erste Tätigkeitsstätte (PLZ, Ort, Straße)").fill("77815 Bühl, Industriestraße 4");
  await wk.getByLabel("Tage dort").fill("200");
  await wk.getByLabel("Einfache Entfernung in km").fill("25");
  await form.getByRole("button", { name: "Angaben speichern" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Angaben gespeichert." })).toBeVisible();
  await expect(form.getByText(/N \(Erika\)/)).toBeVisible();
  await expect(form.getByText("Bereits einbehalten (Lohnsteuer, Soli, KiSt)")).toBeVisible();
  await expect(form.getByText("6.123,40\u00a0€").first()).toBeVisible();
  await n.screenshot({ path: `${SHOTS}/desktop/17-anlage-n.png` });
});

test("Seiten nur von derselben Origin einbettbar", async () => {
  // Clickjacking-Schutz kommt von der App selbst, damit der Proxy SAMEORIGIN statt DENY setzen kann
  const html = await page.request.get("/rechnungen");
  expect(html.headers()["content-type"]).toContain("text/html");
  expect(html.headers()["content-security-policy"]).toBe("frame-ancestors 'self'");
  expect(html.headers()["x-frame-options"]).toBeUndefined();
});

test("Artikelkatalog: anlegen und im Rechnungseditor einfügen", async () => {
  await go("/artikel");
  await page.getByRole("button", { name: "Neuer Artikel" }).click();
  const form = page.getByRole("form", { name: "Neuer Artikel" });
  await form.getByLabel("Bezeichnung").fill("Beratung Softwarearchitektur");
  await form.getByLabel("Artikelnummer (optional)").fill("B-01");
  await form.getByLabel("Preis (€)").fill("110,00");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Artikel angelegt." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Artikelliste" })).toContainText("110,00\u00a0€ je Std.");

  // Im Editor ersetzt der Artikel die leere erste Zeile; gespeichert wird nichts
  await go("/rechnungen/neu");
  await page.getByLabel("Aus dem Artikelkatalog einfügen").selectOption({ label: "B-01 · Beratung Softwarearchitektur · 110,00\u00a0€/Std." });
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Beratung Softwarearchitektur");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("110,00");
  await expect(page.getByLabel("Beschreibung Position 2")).toHaveCount(0);
  // Bereits im Katalog: nicht noch einmal speichern
  await expect(page.getByRole("button", { name: "Position 1 als Artikel speichern" })).toBeDisabled();

  // Vorschlag aus dem Katalog beim Tippen: die Bezeichnung übernimmt Einheit und Preis
  await page.getByRole("button", { name: "+ Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 2").fill("Beratung Softwarearchitektur");
  await expect(page.getByLabel(/Einzelpreis Position 2/)).toHaveValue("110,00");

  // Eine neue Position als Artikel speichern; danach steht sie im Katalog
  await page.getByRole("button", { name: "+ Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 3").fill("Wartungspauschale");
  await page.getByLabel(/Einzelpreis Position 3/).fill("250,00");
  await page.getByRole("button", { name: "Position 3 als Artikel speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "„Wartungspauschale“ ist jetzt im Artikelkatalog." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Position 3 als Artikel speichern" })).toBeDisabled();
  await expect(page.getByLabel("Aus dem Artikelkatalog einfügen").locator("option", { hasText: "Wartungspauschale · 250,00" })).toHaveCount(1);
});

test("Positionstext: Artikel mit Bezeichnung und Text, die Vorschau zeigt beides", async () => {
  await go("/artikel");
  await page.getByRole("button", { name: "Neuer Artikel" }).click();
  const form = page.getByRole("form", { name: "Neuer Artikel" });
  await form.getByLabel("Bezeichnung").fill("Website-Relaunch");
  await form.getByLabel("Text zur Position (optional)").fill("Konzeption, Design und Umsetzung");
  await form.getByLabel("Artikelnummer (optional)").fill("W-01");
  await form.getByLabel("Preis (€)").fill("4.800,00");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Artikel angelegt." })).toBeVisible();

  // Aus dem Katalog: Bezeichnung und Text des Artikels in die Position
  await go("/rechnungen/neu");
  await page.getByLabel("Aus dem Artikelkatalog einfügen").selectOption({ label: "W-01 · Website-Relaunch · 4.800,00\u00a0€/Std." });
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Website-Relaunch");
  await expect(page.getByLabel("Text zu Position 1 (optional)")).toHaveValue("Konzeption, Design und Umsetzung");
  await expect(page.getByRole("button", { name: "Position 1 als Artikel speichern" })).toBeDisabled();

  // Vorschlag beim Tippen der Bezeichnung: ebenso, dazu Preis und Einheit
  await page.getByRole("button", { name: "+ Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 2").fill("Website-Relaunch");
  await expect(page.getByLabel(/Einzelpreis Position 2/)).toHaveValue("4.800,00");
  await expect(page.getByLabel("Text zu Position 2 (optional)")).toHaveValue("Konzeption, Design und Umsetzung");

  // Eigener Text: in der Vorschau unter der Bezeichnung, die Position ist dann nicht mehr die aus dem Katalog
  await page.getByLabel("Text zu Position 2 (optional)").fill("Nachtrag laut Bestellung 4500123456\nAbnahme am 30.09.");
  await expect(page.locator(".sheet").getByText("Nachtrag laut Bestellung 4500123456")).toBeVisible();
  await expect(page.getByRole("button", { name: "Position 2 als Artikel speichern" })).toBeEnabled();
});

test("Positionstext: über 500 Zeichen lässt sich die Position als Artikel speichern und kommt vollständig zurück", async () => {
  // Artikel und Positionen fassen denselben Text (LINE_DETAIL_MAX), die Bezeichnung bleibt bei 500 Zeichen
  const leistungsumfang = "Leistungsumfang ".repeat(40).trim();
  await go("/rechnungen/neu");
  await page.getByLabel("Beschreibung Position 1").fill("Wartungsvertrag");
  await page.getByLabel(/Einzelpreis Position 1/).fill("90,00");
  await page.getByLabel("Text zu Position 1 (optional)").fill(leistungsumfang);
  await page.getByRole("button", { name: "Position 1 als Artikel speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "„Wartungsvertrag“ ist jetzt im Artikelkatalog." })).toBeVisible();
  await page.getByLabel("Aus dem Artikelkatalog einfügen").selectOption({ label: "Wartungsvertrag · 90,00\u00a0€/Std." });
  await expect(page.getByLabel("Text zu Position 2 (optional)")).toHaveValue(leistungsumfang);
});

test("Positionstext: ein einzeiliger Artikel beim Tippen lässt den eigenen Text der Position stehen", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Text zu Position 1 (optional)").fill("laut Bestellung 4500123456");
  await page.getByLabel("Beschreibung Position 1").fill("Beratung Softwarearchitektur");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("110,00");
  await expect(page.getByLabel("Text zu Position 1 (optional)")).toHaveValue("laut Bestellung 4500123456");
});

test("Textbausteine: Kopftext für einen Kunden anlegen und im Rechnungseditor einfügen", async () => {
  await go("/textbausteine");
  await page.getByRole("button", { name: "Neuer Textbaustein" }).click();
  const form = page.getByRole("form", { name: "Neuer Textbaustein" });
  await form.getByLabel("Bezeichnung").fill("Bestellnummer Nordwerk");
  await form.getByRole("textbox", { name: /^Text / }).fill("Bestellnummer 4500012345 laut Rahmenvertrag 2026.");
  await form.getByLabel("Kunde (optional)").selectOption({ label: "Nordwerk Software GmbH · Hamburg" });
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("region", { name: "Textbausteine" })).toContainText("Bestellnummer Nordwerk");

  // Für diesen Kunden steht der Baustein oben; eingefügt wird eine Kopie in die Einleitung, gespeichert wird nichts
  await go("/rechnungen/neu");
  await page.getByLabel("Kunde").selectOption({ label: "Nordwerk Software GmbH · Hamburg" });
  const insert = page.getByLabel("Kopftext aus den Textbausteinen einfügen");
  await expect(insert.locator('optgroup[label="Für diesen Kunden"] option')).toHaveText(["Bestellnummer Nordwerk"]);
  await insert.selectOption({ label: "Bestellnummer Nordwerk" });
  await expect(page.getByLabel("Einleitung über den Positionen (optional)")).toHaveValue("Bestellnummer 4500012345 laut Rahmenvertrag 2026.");
  await expect(insert).toHaveValue("");
});

test("Bruttopreise: Artikel mit Endpreis, Umrechnung beim Einfügen, Vorschau mit „darin enthalten“", async () => {
  await go("/artikel");
  await page.getByRole("button", { name: "Neuer Artikel" }).click();
  const form = page.getByRole("form", { name: "Neuer Artikel" });
  await form.getByLabel("Bezeichnung").fill("Fotoabzug 13 × 18 cm");
  await form.getByLabel("Einheit").selectOption("Stk.");
  await form.getByLabel("Preis (€)").fill("9,80");
  await form.getByLabel(/^Preis ist/).selectOption("brutto");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("region", { name: "Artikelliste" })).toContainText("9,80\u00a0€ brutto je Stk.");

  // Netto-Rechnung: der Endpreis wird herausgerechnet
  await go("/rechnungen/neu");
  const catalog = page.getByLabel("Aus dem Artikelkatalog einfügen");
  await catalog.selectOption({ label: "Fotoabzug 13 × 18 cm · 9,80\u00a0€ brutto/Stk." });
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("8,24");

  // Brutto-Rechnung: der Endpreis bleibt, die Steuer steht unter dem Gesamtbetrag
  await page.getByLabel(/^Preise/).selectOption("brutto");
  await page.getByLabel(/Einzelpreis Position 1/).fill("9,80");
  const preview = page.getByLabel("Vorschau der Rechnung");
  await expect(preview).toContainText("Gesamtbetrag (inkl. USt)9,80\u00a0€");
  await expect(preview).toContainText("darin enthalten:");
  await expect(preview).toContainText("Umsatzsteuer 19 %1,56\u00a0€");
  await catalog.selectOption({ label: "Fotoabzug 13 × 18 cm · 9,80\u00a0€ brutto/Stk." });
  await expect(page.getByLabel(/Einzelpreis Position 2/)).toHaveValue("9,80");
});

test("Rechtsform ist nach der ersten Buchung fest", async () => {
  await go("/einstellungen");
  const rechtsform = page.getByRole("form", { name: "Firmendaten" }).getByLabel("Rechtsform");
  await expect(rechtsform).toBeDisabled();
  await expect(rechtsform).toHaveAccessibleDescription(/nur vor der ersten Buchung festlegen/);
});

test("DATEV-Export: Nummern speichern, Buchungsstapel herunterladen", async () => {
  await go("/einstellungen?bereich=export");
  const card = page.getByRole("form", { name: "DATEV-Export" });
  await card.getByLabel("Beraternummer").fill("29098");
  await card.getByLabel("Mandantennummer").fill("55003");
  await card.getByRole("button", { name: "Nummern speichern" }).click();
  await expect(card.getByRole("status")).toHaveText("Nummern gespeichert.");
  const link = card.getByRole("link", { name: "Buchungsstapel herunterladen" });
  const response = await page.request.get((await link.getAttribute("href"))!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toMatch(/EXTF_Buchungsstapel_\d{4}\.csv/);
  const body = new TextDecoder("latin1").decode(await response.body());
  expect(body.startsWith('"EXTF";700;21;"Buchungsstapel";13;')).toBe(true);
  expect(body).toContain(";29098;55003;");
});

test("Änderungsprotokoll: Kette prüfen, Prüfwert vergleichen", async () => {
  await go("/einstellungen?bereich=export");
  const card = page.getByRole("region", { name: "Änderungsprotokoll prüfen" });
  const pruefwert = (await card.locator("code").textContent())!;
  expect(pruefwert).toMatch(/^Nr\. \d+ · [0-9a-f]{64}$/);
  await card.getByRole("button", { name: "Kette prüfen" }).click();
  await expect(card.getByRole("status")).toContainText("Kette und Siegel sind unverändert");
  const field = card.getByLabel("Prüfwert aus Mail oder Jahresarchiv");
  await field.fill(pruefwert);
  await card.getByRole("button", { name: "Vergleichen" }).click();
  await expect(card.getByRole("status")).toContainText("stimmt und die Kette ist bis dorthin lückenlos");
  await field.fill(pruefwert.slice(0, -1) + (pruefwert.endsWith("0") ? "1" : "0"));
  await card.getByRole("button", { name: "Vergleichen" }).click();
  await expect(card.getByRole("alert")).toContainText("stimmt nicht");
});

test("Belege per E-Mail: Postfach einrichten, Fehler beim Abruf sichtbar", async () => {
  await go("/einstellungen?bereich=email");
  const card = page.getByRole("form", { name: "Belege per E-Mail" });
  // Port 1 auf dem eigenen Rechner: kein IMAP-Server, der Abruf scheitert sofort
  await card.getByLabel("IMAP-Server").fill("127.0.0.1");
  await card.getByLabel("Port", { exact: true }).fill("1");
  await card.getByLabel("Verschlüsselung").selectOption("starttls");
  await card.getByLabel("Benutzername").fill("belege@mustermann.example");
  await card.getByLabel("Passwort").fill("geheim");
  await card.getByLabel("Ordner").fill("Belege");
  await card.getByRole("button", { name: "Speichern" }).click();
  await expect(card.getByRole("status")).toHaveText("Postfach gespeichert.");
  await card.getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(card.getByRole("alert")).toContainText("Abruf fehlgeschlagen");

  await go("/belege");
  await expect(page.getByText(/Belege per E-Mail: Anhänge an belege@mustermann\.example \(Ordner Belege\)/)).toBeVisible();
  await expect(page.getByText("Belege per E-Mail: Server nicht erreichbar.")).toBeVisible();
});

test("Kontoabruf: Enable Banking in den Einstellungen, ein falscher Schlüssel wird abgelehnt", async () => {
  await go("/bank");
  await page.getByRole("link", { name: "Einstellungen › Bank" }).click();
  await page.waitForURL("**/einstellungen?bereich=bank");
  const card = page.getByRole("form", { name: "Automatischer Kontoabruf" });
  await expect(card.getByText("/api/bank/callback")).toBeVisible();
  // Die Application ID kommt aus dem Dateinamen der .pem
  await card
    .getByLabel("Privater Schlüssel (.pem)")
    .setInputFiles({ name: "0b7c3f1e-1234-4abc-9def-0123456789ab.pem", mimeType: "application/x-pem-file", buffer: Buffer.from("kein Schlüssel") });
  await expect(card.getByLabel("Application ID")).toHaveValue("0b7c3f1e-1234-4abc-9def-0123456789ab");
  await card.getByRole("button", { name: "Prüfen und speichern" }).click();
  await expect(card.getByRole("alert")).toContainText("keine gültige .pem-Datei");
});

test("Theme wechseln, bleibt nach dem Neuladen, Version unten in der Navigation", async () => {
  await go("/");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByRole("link", { name: /^Haben \d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/ })).toBeVisible();
  await nav.getByLabel("Theme").selectOption("tiefsee");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "tiefsee");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "tiefsee");
  await expect(nav.getByLabel("Theme")).toHaveValue("tiefsee");
  await nav.getByLabel("Theme").selectOption("wald");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "wald");
});

test("Fristen und Kalender-Abo", async () => {
  await go("/fristen");
  await expect(page.getByRole("heading", { name: "Fristen", level: 1 })).toBeVisible();
  // „Später“ zeigt erst sechs Fristen, der Rest klappt auf
  const spaeter = page.getByRole("region", { name: /^Später/ });
  await expect(spaeter.getByRole("row")).toHaveCount(7);
  await spaeter.getByRole("button", { name: /^Alle \d+ zeigen$/ }).click();
  await expect(spaeter.getByRole("button", { name: /^Alle \d+ zeigen$/ })).toHaveCount(0);
  expect(await spaeter.getByRole("row").count()).toBeGreaterThan(7);
  await expect(page.getByText(/Umsatzsteuer-Voranmeldung/).first()).toBeVisible();
  const abo = page.getByRole("region", { name: "Erinnerungen im Kalender" });
  await abo.getByRole("button", { name: "Kalender-Abo einrichten" }).click();
  const url = await abo.getByLabel(/Abo-Link/).inputValue();
  expect(url).toMatch(/\/api\/fristen\/kalender\?token=[\w-]{32}$/);
  const ics = await page.request.get(url);
  expect(ics.status()).toBe(200);
  expect(await ics.text()).toContain("BEGIN:VCALENDAR");
  expect((await page.request.get(url.replace(/token=.*/, "token=falsch"))).status()).toBe(404);
});

test("Angebot festschreiben, annehmen und abrechnen", async () => {
  await go("/angebote/neu");
  await expect(page.getByRole("heading", { name: /^Angebot AN-\d{4}-001$/, level: 1 })).toBeVisible();
  await page.getByLabel("Kunde").selectOption({ index: 1 });
  await page.getByLabel("Beschreibung Position 1").fill("Workshop Softwarearchitektur");
  await page.getByLabel("Text zu Position 1 (optional)").fill("Agenda nach Abstimmung\nzwei Tage vor Ort");
  await page.getByLabel("Menge Position 1").fill("16");
  await page.getByLabel(/Einzelpreis Position 1/).fill("110");
  await expect(page.getByLabel("Vorschau des Angebots")).toContainText("Dieses Angebot gilt bis zum");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await page.getByRole("button", { name: "Jetzt festschreiben" }).click();
  const antwort = page.getByRole("region", { name: /Antwort des Kunden/ });
  await expect(antwort).toContainText("Offen", { timeout: 30_000 });
  await expect(page.getByText("2.094,40\u00a0€").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/desktop/03b-angebot.png`, fullPage: true });

  // Abschlag aus dem Angebot: Rechnungsart und Angebot vorbelegt, den Betrag trägt man selbst ein; danach wieder verwerfen
  const angebotUrl = page.url();
  await antwort.getByRole("button", { name: "Abschlagsrechnung erstellen" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Rechnungsart")).toHaveValue("abschlag");
  await expect(page.getByRole("combobox", { name: /^Angebot\b/ }).locator("option:checked")).toHaveText(/^Angebot AN-\d{4}-001 vom/);
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue(/^Abschlag gemäß Angebot AN-\d{4}-001 vom/);
  await page.getByRole("button", { name: "Entwurf löschen" }).click();
  await page.getByRole("button", { name: "Entwurf endgültig löschen" }).click();
  await page.waitForURL(/\/rechnungen$/);
  await page.goto(angebotUrl);
  await page.waitForLoadState("networkidle");

  await antwort.getByRole("button", { name: "Rechnung erstellen", exact: true }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Workshop Softwarearchitektur");
  // Der Text zur Position geht aus dem Angebot in die Rechnung über
  await expect(page.getByLabel("Text zu Position 1 (optional)")).toHaveValue("Agenda nach Abstimmung\nzwei Tage vor Ort");
  await expect(page.getByLabel(/Hinweis auf der Rechnung/)).toHaveValue(/^Gemäß unserem Angebot AN-\d{4}-001 vom/);
  // Den Entwurf wieder verwerfen (zweiter Klick bestätigt); das Angebot lässt sich danach erneut abrechnen
  await page.getByRole("button", { name: "Entwurf löschen" }).click();
  await page.getByRole("button", { name: "Entwurf endgültig löschen" }).click();
  await page.waitForURL(/\/rechnungen$/);
  await go("/angebote");
  await expect(page.getByRole("link", { name: /AN-\d{4}-001/ })).toContainText("Angenommen");

  // Zum angenommenen Angebot: Auftragsbestätigung und Lieferschein als PDF
  await page.getByRole("link", { name: /AN-\d{4}-001/ }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  for (const name of ["Auftragsbestätigung (PDF)", "Lieferschein (PDF)"]) {
    const response = await page.request.get((await page.getByRole("link", { name }).getAttribute("href"))!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
  }
});

test("Pauschalen: Homeoffice, Fahrt, Verpflegung und Storno", async () => {
  await go("/pauschalen");
  await expect(page.getByRole("heading", { name: /^Pauschalen \d{4}$/, level: 1 })).toBeVisible();
  const neu = page.getByRole("region", { name: "Pauschale eintragen" });

  const homeoffice = neu.getByRole("form", { name: "Homeoffice-Pauschale" });
  await homeoffice.getByLabel("Tage im Homeoffice", { exact: true }).fill("12");
  await homeoffice.getByRole("button", { name: "72,00\u00a0€ buchen" }).click();
  await expect(neu.getByRole("status")).toHaveText("Homeoffice-Pauschale über 72,00\u00a0€ gebucht.");

  await neu.getByRole("button", { name: "Fahrt", exact: true }).click();
  const fahrt = neu.getByRole("form", { name: "Fahrt mit dem Privatfahrzeug" });
  await fahrt.getByLabel("Anlass und Ziel", { exact: true }).fill("Workshop Nordwerk, Karlsruhe");
  await fahrt.getByLabel("Kilometer einfach", { exact: true }).fill("42,5");
  await fahrt.getByRole("button", { name: "25,50\u00a0€ buchen" }).click();
  await expect(neu.getByRole("status")).toHaveText("Fahrt über 25,50\u00a0€ gebucht.");

  await neu.getByRole("button", { name: "Verpflegung", exact: true }).click();
  const verpflegung = neu.getByRole("form", { name: "Verpflegungsmehraufwand" });
  await verpflegung.getByLabel("Anlass und Ort", { exact: true }).fill("Kundenprojekt, München");
  await verpflegung.getByRole("combobox", { name: /^Reisetag/ }).selectOption("ganztag");
  await verpflegung.getByLabel("Frühstück", { exact: true }).check();
  await verpflegung.getByRole("button", { name: "22,40\u00a0€ buchen" }).click();
  await expect(neu.getByRole("status")).toHaveText("Verpflegungsmehraufwand über 22,40\u00a0€ gebucht.");

  const liste = page.getByRole("region", { name: /^Eingetragen in/ });
  await expect(liste.getByRole("row")).toHaveCount(4);
  const zeile = liste.getByRole("row").filter({ hasText: "Karlsruhe" });
  await zeile.getByRole("button", { name: "Stornieren" }).click();
  await zeile.getByRole("button", { name: "Wirklich stornieren" }).click();
  await expect(zeile.getByText("storniert", { exact: true })).toBeVisible();
  await expect(page.getByText("94,40\u00a0€", { exact: true })).toBeVisible();
});

test("Rechnung per E-Mail: Zugang einrichten, Vorlage, Fehler im Protokoll", async () => {
  await go("/einstellungen?bereich=email");
  const zugang = page.getByRole("form", { name: "E-Mail-Versand" });
  // Port 1 auf dem eigenen Rechner: kein Mailserver, der Versand scheitert sofort und sichtbar
  await zugang.getByLabel("SMTP-Server", { exact: true }).fill("127.0.0.1");
  await zugang.getByLabel("Port", { exact: true }).fill("1");
  await zugang.getByLabel("Benutzername", { exact: true }).fill("max");
  await zugang.getByLabel("Passwort", { exact: true }).fill("geheim");
  await zugang.getByLabel("Absender", { exact: true }).fill("rechnung@mustermann.example");
  await zugang.getByLabel("Erinnerungen an", { exact: true }).fill("max@mustermann.example");
  await zugang.getByRole("button", { name: "Speichern" }).click();
  await expect(zugang.getByRole("status")).toHaveText("E-Mail-Zugang gespeichert.");

  const rechnung = await firstLink(page, "/rechnungen", /^\/rechnungen\/[0-9a-f-]{36}$/);
  await go(rechnung!);
  const bereich = page.getByRole("region", { name: "Per E-Mail" });
  await bereich.getByRole("button", { name: "Rechnung senden" }).click();
  const formular = bereich.getByRole("form", { name: "Rechnung per E-Mail senden" });
  await expect(formular.getByLabel("Betreff", { exact: true })).toHaveValue(/^Rechnung \d{4}-\d{3} von Mustermann IT/);
  await expect(formular.getByText(/Anhang: Rechnung-\d{4}-\d{3}\.pdf/)).toBeVisible();
  await formular.getByLabel("An", { exact: true }).fill("buchhaltung@nordwerk.example");
  await page.screenshot({ path: `${SHOTS}/desktop/04b-rechnung-email.png`, fullPage: true });
  await formular.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(formular.getByRole("alert")).toContainText("Nicht gesendet");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Per E-Mail" })).toContainText("Fehlgeschlagen");
});

test("Abschlagsrechnung festschreiben und Schlussrechnung vorbereiten", async () => {
  await go("/rechnungen/neu");
  await page.getByRole("combobox", { name: /^Rechnungsart/ }).selectOption("abschlag");
  await expect(page.getByRole("heading", { name: /^Abschlagsrechnung \d{4}-\d{3}$/, level: 1 })).toBeVisible();
  await page.getByLabel("Kunde").selectOption({ label: "Rheinpixel GmbH · Köln" });
  await page.getByLabel("Beschreibung Position 1").fill("1. Abschlag Relaunch Website");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("2000");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await page.getByRole("button", { name: "Jetzt festschreiben" }).click();
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const number = (await page.getByRole("heading", { level: 1 }).textContent())!.replace("Abschlagsrechnung ", "").trim();
  const lieferschein = await page.request.get((await page.getByRole("link", { name: "Lieferschein" }).getAttribute("href"))!);
  expect(lieferschein.headers()["content-type"]).toBe("application/pdf");

  await page.getByRole("link", { name: "Schlussrechnung erstellen" }).click();
  await page.waitForURL(/rechnungen\/neu\?schluss=/);
  await expect(page.getByRole("heading", { name: /^Schlussrechnung /, level: 1 })).toBeVisible();
  await expect(page.getByLabel("Kunde")).toHaveValue(/[0-9a-f-]{36}/);
  const abzug = page.getByRole("checkbox", { name: new RegExp(`Abschlagsrechnung ${number}`) });
  await expect(abzug).toBeChecked();
  await page.getByLabel("Beschreibung Position 1").fill("Relaunch Website gesamt");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("5000");
  const vorschau = page.getByLabel("Vorschau der Rechnung");
  await expect(vorschau).toContainText(`Abzüglich Abschlagsrechnung ${number}`);
  // 5.000 − 2.000 netto, zuzüglich 19 %
  await expect(vorschau).toContainText("3.570,00");
  await abzug.uncheck();
  await expect(vorschau).not.toContainText("Abzüglich Abschlagsrechnung");
});

test("Beleg mit § 13b: Steuer selbst berechnet, gezahlt wird netto", async ({ browser }) => {
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "cloud.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Cloud EMEA Ltd") }]);
  await expect(page.getByText("cloud.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /cloud\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/^USt-IdNr\. des Lieferanten/).fill("IE6388047V");
  await page.getByLabel("Netto", { exact: true }).fill("100");
  await page.getByLabel("Vorsteuer", { exact: true }).fill("0");
  await expect(page.getByText(/meist § 13b/)).toBeVisible();
  await page.getByRole("combobox", { name: /^Umsatzsteuer auf dem Beleg/ }).selectOption("eu");
  await expect(page.getByLabel("Steuer § 13b")).toHaveValue("19,00");
  await expect(page.getByText(/Kz 46\/47/)).toBeVisible();
  await expect(page.getByText("Zu zahlen (netto)")).toBeVisible();
  // Nicht buchen: der Beleg würde die folgenden Auswertungen verändern
  await page.getByRole("button", { name: "Löschen" }).click();
  // Esc bricht nur die Rückfrage ab und bleibt beim Beleg
  const url = page.url();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Löschen", exact: true })).toBeVisible();
  expect(page.url()).toBe(url);
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await page.getByRole("button", { name: "Endgültig löschen" }).click();
  await page.waitForURL(/\/belege$/);
});

test("Kassenbuch: Einlage, Entnahme über Bestand abgelehnt, Storno", async () => {
  await go("/kasse");
  const form = page.getByRole("form", { name: "Kassenbuchung eintragen" });
  await form.getByLabel("Betrag (€)").fill("50");
  await form.getByLabel("Text (optional)").fill("Wechselgeld");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Nr. 1 gebucht" })).toBeVisible();
  await form.getByRole("button", { name: "Entnahme" }).click();
  await form.getByLabel("Betrag (€)").fill("80");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("alert")).toContainText("negativ");
  const liste = page.getByRole("region", { name: "Kassenbuch" });
  await expect(liste).toContainText("Wechselgeld");
  const stornieren = liste.getByRole("button", { name: "Nr. 1 stornieren" });
  await stornieren.click();
  await expect(stornieren).toHaveText("Jetzt stornieren");
  await stornieren.click();
  await expect(page.getByRole("status").filter({ hasText: "Storniert mit Nr. 2" })).toBeVisible();
  await expect(liste).toContainText("Storno Nr. 1: Wechselgeld");
});

/** Kleine Sicherung, wie sie lexware-sicherung.js herunterlädt: eine Rechnung mit PDF und eine offene Ausgabe */
function webBackupZip(): Uint8Array {
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/import/test-fixtures/lexoffice-web/${name}`, import.meta.url), "utf8"));
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const sales = fixture("sales-invoice.json");
  const purchase = fixture("purchase-gross.json");
  const pdfPath = `dateien/${sales.list.entityId}/1-Rechnung_RE0042.pdf`;
  return zipSync({
    "manifest.json": json({ format: "haben-lexware-web", version: 1, part: 1, createdAt: new Date().toISOString(), failed: [] }),
    "kontakte.json": json(fixture("contacts.json")),
    [`belege/${sales.list.entityId}.json`]: json({
      ...sales,
      files: [{ path: pdfPath, role: "pdf", mimeType: "application/pdf", filename: "Rechnung_RE0042.pdf" }],
    }),
    [`belege/${purchase.list.entityId}.json`]: json({ ...purchase, files: [] }),
    [pdfPath]: new TextEncoder().encode("%PDF-1.4\n%%EOF\n"),
  });
}

test("Umzug ohne Public API: Skript abrufen, Sicherung hochladen und übernehmen", async () => {
  await go("/archiv");
  const card = page.getByRole("region", { name: "Ohne Public API: Sicherung aus der Web-Oberfläche" });
  await expect(card.getByRole("button", { name: "Skript kopieren" })).toBeVisible();
  const script = await page.request.get((await card.getByRole("link", { name: "Skript ansehen" }).getAttribute("href"))!);
  expect(script.status()).toBe(200);
  expect(await script.text()).toContain('const FORMAT = "haben-lexware-web"');

  await card
    .getByLabel("Teile der Sicherung")
    .setInputFiles({ name: "lexware-sicherung-teil-01.zip", mimeType: "application/zip", buffer: Buffer.from(webBackupZip()) });
  await card.getByRole("button", { name: "Hochladen und übernehmen" }).click();
  await expect(card.getByRole("status")).toContainText("Der Teil ist übernommen", { timeout: 60_000 });
  const step2 = page.getByRole("region", { name: "Kontakte, Rechnungen und Belege abrufen" });
  await expect(step2).toContainText("Fertig am");
  // Die überfällige Ausgabe steht als offener Posten bereit
  await expect(page.getByRole("region", { name: "Offene Posten übernehmen" })).toContainText("2025-4711");
});

test("Auswertungen, Umsatzsteuer und Jahreserklärung laden", async () => {
  await go("/auswertungen");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await go("/umsatzsteuer");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await go(`/jahreserklaerung/${YEAR - 1}`);
  await expect(page.getByRole("heading", { name: /Steuerjahr/ })).toBeVisible();
  // Ohne eigene Hersteller-ID: Werte für die Erweiterung, die Mein ELSTER ausfüllt
  await expect(
    page.getByRole("region", { name: /^Anlage EÜR \d{4} in Mein ELSTER$/ }).getByRole("button", { name: "Werte für Mein ELSTER kopieren" }),
  ).toBeVisible();
  await go("/finanzamt");
  await expect(page.getByRole("heading", { name: "Finanzamt", level: 1 })).toBeVisible();
});

test("Voranmeldung als XML für den Import in Mein ELSTER herunterladen", async () => {
  await go("/umsatzsteuer");
  const save = page.getByRole("button", { name: "Entwurf speichern" });
  if (await save.isEnabled()) {
    await save.click();
    await expect(save).toBeDisabled();
  }
  const link = page.getByRole("link", { name: "XML für Mein ELSTER" });
  await expect(link).toBeVisible();
  // Zweiter Weg ohne Hersteller-ID: Werte für die Erweiterung
  await expect(page.getByRole("button", { name: "Werte für Mein ELSTER kopieren" })).toBeEnabled();
  const response = await page.request.get((await link.getAttribute("href"))!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/xml; charset=ISO-8859-15");
  expect(response.headers()["content-disposition"]).toMatch(/filename="UStVA_\d{4}-\d{2}\.xml"/);
  const xml = new TextDecoder("iso-8859-15").decode(await response.body());
  expect(xml).toMatch(
    /^<\?xml version="1.0" encoding="ISO-8859-15" standalone="no"\?>\n<Anmeldungssteuern xmlns="http:\/\/finkonsens.de\/elster\/elsteranmeldung\/ustva\/v\d{4}"/,
  );
  expect(xml).not.toContain("<TransferHeader");
});

test("Keine Fehler im Browser, Sitzung für die übrigen Tests speichern", async () => {
  expect(pageErrors).toEqual([]);
  await page.context().storageState({ path: SESSION });
});
