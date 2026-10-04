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

  const logo = page.getByRole("region", { name: "Logo" });
  await logo.getByLabel("Logodatei").setInputFiles("public/icon-192.png");
  await expect(logo.getByRole("status")).toContainText("Logo gespeichert.");
  await expect(logo.getByRole("img", { name: "Aktuelles Logo" })).toBeVisible();
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
    // Erst weiter, wenn die Zuordnung dieses Umsatzes gespeichert ist; „Zugeordnet“ steht schon bei früheren Umsätzen
    // in der Liste, und ein vorzeitiges Weiterklicken bricht die laufende Anfrage ab.
    await expect(page.getByRole("complementary", { name: "Zuordnung" }).getByRole("button", { name: "Aufheben" })).toBeVisible();
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
  await go("/einstellungen");
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
  const cert = page.getByRole("form", { name: "ELSTER-Zertifikat" });
  await cert.getByLabel("Zertifikatsdatei").setInputFiles({ name: "test.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from("kein echtes Zertifikat") });
  await cert.getByRole("button", { name: "Hochladen" }).click();
  await expect(cert.getByText("test.pfx")).toBeVisible();
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

test("Artikelkatalog: anlegen und im Rechnungseditor einfügen", async () => {
  await go("/rechnungen/artikel");
  const form = page.getByRole("form", { name: "Neuer Artikel" });
  await form.getByLabel("Bezeichnung").fill("Beratung Softwarearchitektur");
  await form.getByLabel("Artikelnummer (optional)").fill("B-01");
  await form.getByLabel("Preis netto (€)").fill("110,00");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Artikel angelegt." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Artikelliste" })).toContainText("110,00\u00a0€ je Std.");

  // Im Editor ersetzt der Artikel die leere erste Zeile; gespeichert wird nichts
  await go("/rechnungen/neu");
  await page.getByLabel("Aus dem Artikelkatalog einfügen").selectOption({ label: "B-01 · Beratung Softwarearchitektur · 110,00\u00a0€/Std." });
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Beratung Softwarearchitektur");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("110,00");
  await expect(page.getByLabel("Beschreibung Position 2")).toHaveCount(0);
});

test("DATEV-Export: Nummern speichern, Buchungsstapel herunterladen", async () => {
  await go("/einstellungen");
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

test("Belege per E-Mail: Postfach einrichten, Fehler beim Abruf sichtbar", async () => {
  await go("/einstellungen");
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
  await expect(page.getByText(/Letzter Abruf fehlgeschlagen/)).toBeVisible();
});

test("Fristen und Kalender-Abo", async () => {
  await go("/fristen");
  await expect(page.getByRole("heading", { name: "Fristen", level: 1 })).toBeVisible();
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

  await antwort.getByRole("button", { name: "Rechnung erstellen" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Workshop Softwarearchitektur");
  await expect(page.getByLabel(/Hinweis auf der Rechnung/)).toHaveValue(/^Gemäß unserem Angebot AN-\d{4}-001 vom/);
  // Den Entwurf wieder verwerfen; das Angebot lässt sich danach erneut abrechnen
  await page.getByRole("button", { name: "Entwurf löschen" }).click();
  await page.waitForURL(/\/rechnungen$/);
  await go("/angebote");
  await expect(page.getByRole("link", { name: /AN-\d{4}-001/ })).toContainText("Angenommen");
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
  await go("/einstellungen");
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

  const rechnung = await firstLink("/rechnungen", /^\/rechnungen\/[0-9a-f-]{36}$/);
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
    ["angebote", "/angebote"],
    ["rechnung", details.rechnung],
    ["mahnwesen", "/rechnungen/mahnwesen"],
    ["wiederkehrend", "/rechnungen/wiederkehrend"],
    ["artikel", "/rechnungen/artikel"],
    ["belege", "/belege"],
    ["beleg", details.beleg],
    ["pauschalen", "/pauschalen"],
    ["bank", "/bank"],
    ["anlagen", "/anlagen"],
    ["anlage-neu", "/anlagen/neu"],
    ["buchungen", `/buchungen?jahr=${YEAR}&monat=${month}`],
    ["konten", `/konten?jahr=${YEAR}`],
    ["kontenblatt", `/konten/1200?jahr=${YEAR}`],
    ["umsatzsteuer", "/umsatzsteuer"],
    ["jahreserklaerung", `/jahreserklaerung/${YEAR - 1}`],
    ["finanzamt", "/finanzamt"],
    ["fristen", "/fristen"],
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
