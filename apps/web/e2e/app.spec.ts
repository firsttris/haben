import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { zipSync } from "fflate";
import { mkdirSync, readFileSync } from "node:fs";
import { day, EIGENE_SEITE, fakeEigeneSeite, firstLink, fullPageScreenshot, SESSION, SHOTS, USER, YEAR } from "./daten.ts";

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
  // Ungültige SVG-Werte (etwa NaN in einem Diagramm) meldet der Browser nur in der Konsole, nicht als Seitenfehler
  page.on("console", (message) => {
    if (message.type() === "error" && /NaN/.test(message.text())) pageErrors.push(`${page.url()}: ${message.text()}`);
  });
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

  // Kontoinhaber bleibt gespeichert und lässt sich wieder leeren (dann gilt der Firmenname)
  await firma.getByLabel("Kontoinhaber").fill("Max Mustermann");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
  // Die Meldung steht noch vom ersten Speichern da; erst wenn die Anfrage durch ist, neu laden
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(firma.getByLabel("Kontoinhaber")).toHaveValue("Max Mustermann");
  await firma.getByLabel("Kontoinhaber").fill("");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
  await page.waitForLoadState("networkidle");

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
  // Die Vorschau im Editor übernimmt Akzentfarbe und Grautöne (#222): Text #191F27 statt des grünlichen #16211C
  await go("/rechnungen/neu");
  const vorschau = page.getByLabel("Vorschau der Rechnung");
  await expect(vorschau).toHaveCSS("color", "rgb(25, 31, 39)");
  await go("/einstellungen?bereich=rechnungen");
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

test("Kundennummer automatisch vergeben", async () => {
  await go("/einstellungen?bereich=rechnungen");
  const karte = page.getByRole("form", { name: "Kundennummern" });
  await karte.getByLabel("Format").fill("K {NNNN}");
  await expect(karte.getByText(/Buchstaben, Ziffern/)).toBeVisible();
  await karte.getByLabel("Format").fill("K-{NNNN}");
  await expect(karte).toContainText("Nächste: K-0001");
  await karte.getByRole("button", { name: "Kundennummern speichern" }).click();
  await expect(karte.getByRole("status")).toContainText("automatisch vergeben");

  await go("/kontakte/neu");
  await expect(page.getByText("voraussichtlich K-0001")).toBeVisible();
  await page.getByLabel("Name oder Firma").fill("Nummernkreis Testkunde");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  await expect(page.getByLabel("Kundennummer")).toHaveValue("K-0001");
  // Archivieren und abschalten: Die folgenden Tests rechnen mit den Kontakten und Nummern von Hand
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
  await go("/einstellungen?bereich=rechnungen");
  await karte.getByLabel("Format").fill("");
  await karte.getByRole("button", { name: "Kundennummern speichern" }).click();
  await expect(karte.getByRole("status")).toContainText("von Hand");
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

/** IBAN des Lieferanten Funknetz Mobil GmbH, im Kontakt und im Kontoauszug */
const SUPPLIER_IBAN = "DE02100100100006820101";
/** EndToEndId der SEPA-Überweisung für den Mobilfunkbeleg; der Kontoauszug nennt sie als Kundenreferenz */
let endToEndId = "";

test("Beleg hochladen und buchen", async ({ browser }) => {
  // Lieferant mit IBAN, damit sich der Beleg als SEPA-Überweisung bezahlen lässt
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Funknetz Mobil GmbH");
  await page.getByLabel("Kunde", { exact: true }).uncheck();
  await page.getByLabel("Lieferant", { exact: true }).check();
  await page.getByLabel("IBAN").fill(SUPPLIER_IBAN);
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  await go("/belege");
  await page.locator("input[type=file][multiple]").setInputFiles([{ name: "mobilfunk.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser) }]);
  await expect(page.getByText("mobilfunk.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /mobilfunk\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("combobox", { name: "Aus den Kontakten" }).selectOption({ label: "Funknetz Mobil GmbH" });
  await expect(page.getByLabel("Lieferant", { exact: true })).toHaveValue("Funknetz Mobil GmbH");
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

test("Überweisung als SEPA-Datei: offenen Beleg wählen, Datei herunterladen, Vermerk am Beleg", async ({ browser }) => {
  await go("/ueberweisungen");
  // Ohne Bankkonto gibt es kein Auftraggeberkonto
  await expect(page.getByText(/braucht Haben das Konto, von dem sie abgeht/)).toBeVisible();
  await go("/bank");
  await page.getByRole("button", { name: "Konto hinzufügen" }).click();
  const accountForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Konto anlegen" }) });
  await accountForm.getByRole("textbox", { name: "Name" }).fill("Girokonto");
  await accountForm.getByRole("textbox", { name: "IBAN" }).fill("DE45 1203 0000 1234 5678 90");
  await accountForm.getByRole("button", { name: "Konto anlegen" }).click();
  await expect(page.getByRole("combobox", { name: "Konto" }).locator("option", { hasText: "Girokonto" })).toHaveCount(1);

  await go("/ueberweisungen");
  const form = page.getByRole("form", { name: "SEPA-Überweisung erzeugen" });
  await expect(form.getByLabel("Auftraggeberkonto")).toContainText("Girokonto · DE45 1203 0000 1234 5678 90");
  await expect(form).toContainText("DE02 1001 0010 0006 8201 01");
  // Später ist der Beleg bezahlt: Die Liste mit Auswahl prüft axe deshalb hier, am Desktop und am Handy (WCAG 2.2 AA wie
  // barrierefreiheit.spec.ts). AxeBuilder braucht einen eigenen Kontext, mit derselben Sitzung
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const axePage = await context.newPage();
  for (const width of [1440, 390]) {
    await axePage.setViewportSize({ width, height: 900 });
    await axePage.goto(new URL("/ueberweisungen", page.url()).toString());
    await axePage.waitForLoadState("networkidle");
    await expect(axePage.getByRole("checkbox", { name: "Funknetz Mobil GmbH MF-0815 überweisen" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page: axePage })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      `/ueberweisungen bei ${width} px`,
    ).toEqual([]);
  }
  await context.close();
  await form.getByRole("checkbox", { name: "Funknetz Mobil GmbH MF-0815 überweisen" }).check();
  await expect(form.getByText("1 ausgewählt · 45,90 €")).toBeVisible();
  const download = page.waitForEvent("download");
  await form.getByRole("button", { name: "SEPA-Datei erzeugen" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^HABEN-[0-9A-F]{16}\.xml$/);
  const xml = readFileSync(await file.path(), "utf8");
  expect(xml).toContain('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">');
  expect(xml.match(/<NbOfTxs>1<\/NbOfTxs>/g)).toHaveLength(2);
  expect(xml.match(/<CtrlSum>45\.90<\/CtrlSum>/g)).toHaveLength(2);
  expect(xml).toContain('<InstdAmt Ccy="EUR">45.90</InstdAmt>');
  expect(xml).toContain("<DbtrAcct><Id><IBAN>DE45120300001234567890</IBAN></Id></DbtrAcct>");
  expect(xml).toContain(`<CdtrAcct><Id><IBAN>${SUPPLIER_IBAN}</IBAN></Id></CdtrAcct>`);
  expect(xml).toContain("<Cdtr><Nm>Funknetz Mobil GmbH</Nm></Cdtr>");
  expect(xml).toContain("<Ustrd>MF-0815</Ustrd>");
  expect(xml).toContain(`<ReqdExctnDt><Dt>${day(0)}</Dt></ReqdExctnDt>`);
  endToEndId = /<EndToEndId>(HABEN-[0-9A-F]{16})<\/EndToEndId>/.exec(xml)?.[1] ?? "";
  expect(endToEndId).not.toBe("");
  await expect(page.getByRole("status").filter({ hasText: "erzeugt: 1 Überweisung über 45,90 €" })).toBeVisible();

  // Die Datei bleibt zum erneuten Herunterladen; der Beleg ist weiter offen und trägt den Vermerk
  const files = page.getByRole("region", { name: "Erzeugte Dateien" });
  await expect(files).toContainText("Girokonto");
  const again = await page.request.get((await files.getByRole("link", { name: `${file.suggestedFilename()} herunterladen` }).getAttribute("href"))!);
  expect(await again.text()).toBe(xml);
  await expect(form).toContainText("Überweisung erzeugt am");
  await form.getByRole("link", { name: "Funknetz Mobil GmbH" }).click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("status").filter({ hasText: "Überweisung erzeugt am" })).toContainText(endToEndId);
});

test("Kontoauszug importieren und zuordnen", async () => {
  const rows = [
    [day(-1), "Rheinpixel GmbH", "Max Mustermann", "Rechnung Wartung", "Eingang", "1.725,50"],
    // Die DKB nennt die EndToEndId der Überweisung als Kundenreferenz
    [day(-6), "Max Mustermann", "Funknetz Mobil GmbH", "Mobilfunk MF-0815", "Ausgang", "-45,90", endToEndId],
    [day(-8), "Alpenblick Media AG", "Max Mustermann", "Rechnung Beratung", "Eingang", "3.724,70"],
    [day(-25), "Nordwerk Software GmbH", "Max Mustermann", "Rechnung Softwareentwicklung", "Eingang", "10.852,80"],
  ];
  const csv =
    "﻿" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n"Kontostand vom ${dkb(day(0))}:";"16.257,10 €"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    rows
      .map(([date, from, to, purpose, type, amount, reference = ""]) =>
        [dkb(date!), dkb(date!), "Gebucht", from, to, purpose, type, SUPPLIER_IBAN, amount, "", "", reference].map((v) => `"${v}"`).join(";"),
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
    // Die Abbuchung der Überweisung aus Haben erkennt der Abgleich an ihrer Referenz
    if (party === "Funknetz Mobil GmbH") await expect(page.getByText(`Überweisung aus Haben (${endToEndId})`)).toBeVisible();
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

test("Standard-Einleitung: in den Firmendaten hinterlegt, je für Rechnungen und Angebote vorbelegt und änderbar", async () => {
  const firma = page.getByRole("form", { name: "Firmendaten" });
  const speichern = async () => {
    await firma.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
    await page.waitForLoadState("networkidle");
  };
  await go("/einstellungen");
  await firma.getByLabel("Standard-Einleitung für Rechnungen").fill("Für die erbrachten Leistungen berechne ich Ihnen:");
  await firma.getByLabel("Standard-Einleitung für Angebote").fill("Gerne biete ich Ihnen an:");
  await speichern();

  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  await go("/rechnungen/neu");
  await expect(einleitung).toHaveValue("Für die erbrachten Leistungen berechne ich Ihnen:");
  await einleitung.fill("Für das Projekt Relaunch berechne ich Ihnen:");
  await expect(page.getByLabel("Vorschau der Rechnung")).toContainText("Für das Projekt Relaunch berechne ich Ihnen:");
  await go("/angebote/neu");
  await expect(einleitung).toHaveValue("Gerne biete ich Ihnen an:");

  // Die folgenden Tests rechnen mit leerer Einleitung
  await go("/einstellungen");
  await firma.getByLabel("Standard-Einleitung für Rechnungen").fill("");
  await firma.getByLabel("Standard-Einleitung für Angebote").fill("");
  await speichern();
  await go("/rechnungen/neu");
  await expect(einleitung).toHaveValue("");
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
  await fullPageScreenshot(page, { path: `${SHOTS}/desktop/03b-angebot.png` });

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
  // Leer gelassen gilt der Firmenname; die Vorgabe zeigt ihn an
  await expect(zugang.getByLabel("Absendername")).toHaveAttribute("placeholder", /Mustermann IT/);
  await zugang.getByLabel("Absendername").fill("Max Mustermann IT");
  await zugang.getByLabel("Erinnerungen an", { exact: true }).fill("max@mustermann.example");
  await zugang.getByRole("button", { name: "Speichern" }).click();
  await expect(zugang.getByRole("status")).toHaveText("E-Mail-Zugang gespeichert.");
  await expect(zugang.getByLabel("Absendername")).toHaveValue("Max Mustermann IT");

  const rechnung = await firstLink(page, "/rechnungen", /^\/rechnungen\/[0-9a-f-]{36}$/);
  await go(rechnung!);
  const bereich = page.getByRole("region", { name: "Per E-Mail" });
  await bereich.getByRole("button", { name: "Rechnung senden" }).click();
  const formular = bereich.getByRole("form", { name: "Rechnung per E-Mail senden" });
  await expect(formular.getByLabel("Betreff", { exact: true })).toHaveValue(/^Rechnung \d{4}-\d{3} von Mustermann IT/);
  await expect(formular.getByText(/Anhang: Rechnung-\d{4}-\d{3}\.pdf/)).toBeVisible();
  await formular.getByLabel("An", { exact: true }).fill("buchhaltung@nordwerk.example");
  await fullPageScreenshot(page, { path: `${SHOTS}/desktop/04b-rechnung-email.png` });
  await formular.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(formular.getByRole("alert")).toContainText("Nicht gesendet");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Per E-Mail" })).toContainText("Fehlgeschlagen");
});

/** Kleinste Datei, die Haben am Inhalt als PDF erkennt */
const attachmentPdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);

test("Anhänge an der Rechnung: PDF hochladen, entfernen, festschreiben und beim Versand auswählen", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Kunde").selectOption({ label: "Alpenblick Media AG · München" });
  await page.getByLabel("Beschreibung Position 1").fill("Beratung mit Stundennachweis");
  await page.getByLabel("Menge Position 1").fill("8");
  await page.getByLabel(/Einzelpreis Position 1/).fill("120,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");

  const anhaenge = page.getByRole("region", { name: "Anhänge" });
  const auswahl = page.getByLabel("PDF-Anhänge auswählen");
  await auswahl.setInputFiles([
    { name: "stundenzettel.pdf", mimeType: "application/pdf", buffer: attachmentPdf("Stundenzettel") },
    { name: "abnahme.pdf", mimeType: "application/pdf", buffer: attachmentPdf("Abnahme") },
  ]);
  await expect(anhaenge.getByText("stundenzettel.pdf: angehängt.")).toBeVisible();
  await expect(anhaenge.getByRole("link", { name: "abnahme.pdf", exact: true })).toBeVisible();
  // Nur PDF, am Inhalt erkannt: ein Bild mit der Endung .pdf wird abgelehnt
  await auswahl.setInputFiles([{ name: "foto.pdf", mimeType: "application/pdf", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }]);
  await expect(anhaenge.getByText("foto.pdf: Als Anhang sind nur PDF-Dateien erlaubt.")).toBeVisible();
  await anhaenge.getByRole("button", { name: "abnahme.pdf entfernen" }).click();
  await expect(anhaenge.getByText("abnahme.pdf: entfernt.")).toBeVisible();
  await expect(anhaenge.getByRole("link", { name: "abnahme.pdf", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Festschreiben" }).click();
  await page.getByRole("button", { name: "Jetzt festschreiben" }).click();
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const number = (await page.getByRole("heading", { level: 1 }).textContent())!.replace("Rechnung ", "").trim();
  await expect(anhaenge).toContainText("Mit der Rechnung festgeschrieben.");
  await expect(anhaenge.getByRole("button", { name: /entfernen/ })).toHaveCount(0);
  const download = await page.request.get((await anhaenge.getByRole("link", { name: "stundenzettel.pdf herunterladen" }).getAttribute("href"))!);
  expect(download.headers()["content-type"]).toBe("application/pdf");
  expect((await download.body()).toString()).toContain("Stundenzettel");

  // Der Zugang aus dem Test davor zeigt auf einen Port ohne Mailserver: der Versand scheitert, das Protokoll nennt die Dateien
  const bereich = page.getByRole("region", { name: "Per E-Mail" });
  await bereich.getByRole("button", { name: "Rechnung senden" }).click();
  const formular = bereich.getByRole("form", { name: "Rechnung per E-Mail senden" });
  const mitsenden = formular.getByRole("group", { name: "Zusätzliche Anhänge mitsenden" }).getByRole("checkbox", { name: "stundenzettel.pdf" });
  await expect(mitsenden).toBeChecked();
  await formular.getByLabel("An", { exact: true }).fill("buchhaltung@alpenblick.example");
  await formular.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(formular.getByRole("alert")).toContainText("Nicht gesendet");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Per E-Mail" })).toContainText(`Anhang: Rechnung-${number}.pdf, stundenzettel.pdf`);

  // Abgewählt geht nur die Rechnung mit
  // Kein Versand ging durch, der Knopf heißt also weiter „Rechnung senden“
  await page.getByRole("region", { name: "Per E-Mail" }).getByRole("button", { name: "Rechnung senden" }).click();
  const zweites = page.getByRole("form", { name: "Rechnung per E-Mail senden" });
  await zweites.getByRole("checkbox", { name: "stundenzettel.pdf" }).uncheck();
  await zweites.getByLabel("An", { exact: true }).fill("buchhaltung@alpenblick.example");
  await zweites.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(zweites.getByRole("alert")).toContainText("Nicht gesendet");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Per E-Mail" })).toContainText(new RegExp(`Anhang: Rechnung-${number}\\.pdf(?!, )`));
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

test("Beleg auf mehrere Kategorien aufteilen: Zeilen hinzufügen und entfernen, Summen gegen den Beleg", async ({ browser }) => {
  // Beispiel aus #271, je 19 %: 100 € Handelsware, 50 € Software, 20 € Bürobedarf = 170 € netto, 32,30 € Vorsteuer
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "buerohaus.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Bürohaus Nord GmbH") }]);
  await expect(page.getByText("buerohaus.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /buerohaus\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Lieferant", { exact: true }).fill("Bürohaus Nord GmbH");
  await page.getByLabel("Belegdatum").fill(day(-5));
  await page.getByLabel("Kategorie").selectOption("wareneinkauf");
  const amounts = page.getByRole("group", { name: "Beträge je Steuersatz" });
  await amounts.getByLabel("Netto", { exact: true }).fill("170,00");
  await expect(amounts.getByLabel("Vorsteuer", { exact: true })).toHaveValue("32,30");

  await page.getByRole("button", { name: "Auf mehrere Kategorien aufteilen" }).click();
  const split = page.getByRole("group", { name: "Aufteilung auf Kategorien" });
  // Erste Zeile mit der bisherigen Kategorie und dem ganzen Netto, dazu eine leere
  await expect(split.getByLabel("Kategorie")).toHaveCount(2);
  await expect(split.getByLabel("Kategorie").first()).toHaveValue("wareneinkauf");
  await split.getByRole("textbox", { name: "Netto", exact: true }).first().fill("100,00");
  await split.getByLabel("Kategorie").nth(1).selectOption("software");
  await split.getByRole("textbox", { name: "Netto", exact: true }).nth(1).fill("50,00");
  await expect(split.getByText("19 %: Zeilen 150,00 € von 170,00 € netto · noch 20,00 € zu verteilen")).toBeVisible();
  // Bis eine Kategorie gewählt ist, lässt sich nicht speichern
  await split.getByRole("button", { name: "+ Zeile" }).click();
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await split.getByLabel("Kategorie").nth(2).selectOption("buero");
  await split.getByRole("textbox", { name: "Netto", exact: true }).nth(2).fill("20,00");
  await expect(split.getByText("19 %: Zeilen 170,00 € von 170,00 € netto · stimmt")).toBeVisible();
  // Vorsteuer anteilig: 19,00 + 9,50 + 3,80 = 32,30
  await expect(split.getByText("Vorsteuer 19,00")).toBeVisible();
  await expect(split.getByText("Vorsteuer 9,50")).toBeVisible();
  await expect(split.getByText("Vorsteuer 3,80")).toBeVisible();

  // Eine vierte Zeile mit gleicher Kategorie und gleichem Satz, wieder entfernt
  await split.getByRole("button", { name: "+ Zeile" }).click();
  await split.getByLabel("Kategorie").nth(3).selectOption("software");
  await split.getByRole("textbox", { name: "Netto", exact: true }).nth(3).fill("5,00");
  await expect(split.getByText("19 %: Zeilen 175,00 € von 170,00 € netto · 5,00 € zu viel")).toBeVisible();
  await split.getByRole("button", { name: "Zeile 4 der Aufteilung entfernen" }).click();
  await expect(split.getByLabel("Kategorie")).toHaveCount(3);

  // Gespeichert und neu geladen: die Zeilen bleiben, nichts fehlt mehr vor dem Buchen
  // Erst neu laden, wenn der Server das Speichern beantwortet hat: „Speichern“ ist schon während der Anfrage gesperrt
  const gespeichert = page.waitForResponse((r) => r.url().includes("/_serverFn/") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Speichern" }).click();
  expect((await gespeichert).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("aufgeteilt auf 3 Zeilen")).toBeVisible();
  await expect(split.getByRole("textbox", { name: "Netto", exact: true })).toHaveCount(3);
  await expect(split.getByRole("textbox", { name: "Netto", exact: true }).nth(2)).toHaveValue("20,00");
  await expect(page.getByText(/Vor dem Buchen/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bestätigen und buchen" })).toBeEnabled();

  // Barrierefrei auch mit Aufteilung, am Desktop und am Handy
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const axePage = await context.newPage();
  for (const width of [1440, 390]) {
    await axePage.setViewportSize({ width, height: 900 });
    await axePage.goto(page.url());
    await axePage.waitForLoadState("networkidle");
    await expect(axePage.getByRole("group", { name: "Aufteilung auf Kategorien" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page: axePage })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      `Beleg mit Aufteilung bei ${width} px`,
    ).toEqual([]);
  }
  await context.close();

  // Aufheben: wieder eine Kategorie, die der ersten Zeile
  await split.getByRole("button", { name: "Aufteilung aufheben" }).click();
  await expect(split).toHaveCount(0);
  await expect(page.getByLabel("Kategorie")).toHaveValue("wareneinkauf");
  // Nicht buchen: der Beleg würde die folgenden Auswertungen verändern; Buchung, EÜR, UStVA und DATEV prüfen die
  // Integrationstests in server/modules/belege/splits.test.ts
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await page.getByRole("button", { name: "Endgültig löschen" }).click();
  await page.waitForURL(/\/belege$/);
});

test("Lieferant im Kontaktverzeichnis und im Beleg auswählen", async ({ browser }) => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Hetzner Online GmbH");
  await page.getByLabel("Kunde", { exact: true }).uncheck();
  await page.getByLabel("Lieferant", { exact: true }).check();
  await page.getByLabel("USt-IdNr.").fill("DE812871812");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  // Filter in der Liste: Lieferanten zeigt ihn, Kunden nicht; im Rechnungseditor steht er nicht zur Auswahl
  await go("/kontakte?rolle=lieferant");
  await expect(page.getByRole("region", { name: "Kontaktliste" })).toContainText("Hetzner Online GmbH");
  await go("/kontakte?rolle=kunde");
  await expect(page.getByRole("region", { name: "Kontaktliste" })).not.toContainText("Hetzner Online GmbH");
  await go("/rechnungen/neu");
  await expect(page.getByRole("combobox", { name: "Kunde" }).locator("option", { hasText: "Hetzner" })).toHaveCount(0);

  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "hetzner.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Hetzner Online GmbH") }]);
  await expect(page.getByText("hetzner.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /hetzner\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("combobox", { name: "Aus den Kontakten" }).selectOption({ label: "Hetzner Online GmbH · DE812871812" });
  await expect(page.getByLabel("Lieferant", { exact: true })).toHaveValue("Hetzner Online GmbH");
  await expect(page.getByLabel(/^USt-IdNr\. des Lieferanten/)).toHaveValue("DE812871812");
  // Nicht buchen: Beleg löschen und den Lieferanten archivieren, damit die folgenden Tests unverändert rechnen
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await page.getByRole("button", { name: "Endgültig löschen" }).click();
  await page.waitForURL(/\/belege$/);
  await go("/kontakte?rolle=lieferant");
  await page.getByRole("link", { name: /Hetzner Online GmbH/ }).click();
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
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

test("Kasse: Rechnung bar bezahlt, erst ein Teil, dann der Rest von der Rechnung aus, Storno der Bareinnahme", async ({ browser }) => {
  await go("/rechnungen/neu");
  await page.getByLabel("Kunde").selectOption({ label: "Rheinpixel GmbH · Köln" });
  await page.getByLabel("Rechnungsdatum").fill(day(-3));
  await page.getByLabel("Beschreibung Position 1").fill("Flyer gedruckt, bar bezahlt");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await page.getByRole("button", { name: "Jetzt festschreiben" }).click();
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const invoicePath = new URL(page.url()).pathname;
  const number = (await page.getByRole("heading", { level: 1 }).textContent())?.match(/^Rechnung (\S+)/)?.[1] ?? "";
  expect(number).not.toBe("");
  const zahlungen = page.getByRole("region", { name: "Zahlungen" });
  await expect(zahlungen).toContainText("Noch keine Zahlung");

  // Teilzahlung in der Kasse: 50,00 € von 119,00 €
  await go("/kasse");
  const form = page.getByRole("form", { name: "Kassenbuchung eintragen" });
  await form.getByRole("button", { name: "Rechnung bar bezahlt" }).click();
  const option = form.getByRole("option", { name: new RegExp(`^${number} · Rheinpixel GmbH`) });
  await form.getByRole("combobox", { name: /^Rechnung/ }).selectOption((await option.getAttribute("value"))!);
  await expect(form.getByLabel("Betrag (€)")).toHaveValue("119,00");
  await form.getByLabel("Betrag (€)").fill("50,00");
  await expect(form).toContainText(/Danach bleiben 69,00\s€ offen/);
  await expect(form.getByRole("checkbox", { name: /als Skonto ausbuchen/ })).not.toBeChecked();
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status").filter({ hasText: `gebucht: Bareinnahme Rechnung ${number} über 50,00` })).toBeVisible();
  const liste = page.getByRole("region", { name: "Kassenbuch" });
  await expect(liste.getByRole("link", { name: `Rechnung ${number} · Rheinpixel GmbH` })).toBeVisible();

  await go(invoicePath);
  await expect(page.getByText("Teilbezahlt").first()).toBeVisible();
  await expect(zahlungen).toContainText("bar am");

  // Der Rest von der Rechnung aus: Rechnung und offener Betrag sind vorbelegt; mehr als offen lehnt Haben ab
  await zahlungen.getByRole("link", { name: "Barzahlung in der Kasse erfassen" }).click();
  await page.waitForURL(/\/kasse\?rechnung=/);
  await page.waitForLoadState("networkidle");
  await expect(form.getByRole("button", { name: "Rechnung bar bezahlt" })).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByLabel("Betrag (€)")).toHaveValue("69,00");
  // Die Bareinnahme mit Rechnung prüft axe hier, am Desktop und am Handy (WCAG 2.2 AA wie barrierefreiheit.spec.ts)
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const axePage = await context.newPage();
  for (const width of [1440, 390]) {
    await axePage.setViewportSize({ width, height: 900 });
    await axePage.goto(page.url());
    await axePage.waitForLoadState("networkidle");
    await expect(axePage.getByLabel("Betrag (€)")).toHaveValue("69,00");
    const { violations } = await new AxeBuilder({ page: axePage })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      `/kasse mit Rechnung bei ${width} px`,
    ).toEqual([]);
  }
  await context.close();
  await form.getByLabel("Betrag (€)").fill("70,00");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("alert")).toContainText("nur noch über");
  await form.getByLabel("Betrag (€)").fill("69,00");
  await form.getByRole("button", { name: "Buchen" }).click();
  const gebucht = page.getByRole("status").filter({ hasText: `gebucht: Bareinnahme Rechnung ${number} über 69,00` });
  await expect(gebucht).toBeVisible();
  const restNr = (await gebucht.textContent())?.match(/Nr\. (\d+) gebucht/)?.[1] ?? "";

  await go(invoicePath);
  await expect(page.getByText("Bezahlt").first()).toBeVisible();
  await expect(zahlungen.getByRole("link", { name: "Barzahlung in der Kasse erfassen" })).toBeHidden();

  // Storno der Restzahlung als Gegenzeile: Die Rechnung ist wieder teilweise offen
  await go("/kasse");
  const stornieren = liste.getByRole("button", { name: `Nr. ${restNr} stornieren` });
  await stornieren.click();
  await stornieren.click();
  await expect(page.getByRole("status").filter({ hasText: "Storniert mit Nr." })).toBeVisible();
  await expect(liste).toContainText(`Storno Nr. ${restNr}: Rechnung ${number}`);
  await go(invoicePath);
  await expect(page.getByText("Teilbezahlt").first()).toBeVisible();
  await expect(zahlungen).toContainText("storniert");
});

/** Kleine Sicherung, wie sie lexware-sicherung.js herunterlädt: eine Rechnung mit PDF, eine offene Ausgabe und eine Privateinlage ohne Beleg */
function webBackupZip(): Uint8Array {
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/import/test-fixtures/lexoffice-web/${name}`, import.meta.url), "utf8"));
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const sales = fixture("sales-invoice.json");
  const purchase = fixture("purchase-gross.json");
  const privat = fixture("financial-private.json");
  const pdfPath = `dateien/${sales.list.entityId}/1-Rechnung_RE0042.pdf`;
  // Die Ausgabe bringt eine Datei mit, damit sie sich als offener Posten übernehmen lässt
  const purchasePath = `dateien/${purchase.list.entityId}/1-2025-4711.pdf`;
  return zipSync({
    "manifest.json": json({ format: "haben-lexware-web", version: 1, part: 1, createdAt: new Date().toISOString(), failed: [] }),
    "kontakte.json": json(fixture("contacts.json")),
    [`belege/${sales.list.entityId}.json`]: json({
      ...sales,
      files: [{ path: pdfPath, role: "pdf", mimeType: "application/pdf", filename: "Rechnung_RE0042.pdf" }],
    }),
    [`belege/${purchase.list.entityId}.json`]: json({
      ...purchase,
      files: [{ path: purchasePath, role: "anhang", mimeType: "application/pdf", filename: "2025-4711.pdf" }],
    }),
    [`belege/${privat.list.entityId}.json`]: json({ ...privat, files: [] }),
    [pdfPath]: new TextEncoder().encode("%PDF-1.4\n%%EOF\n"),
    [purchasePath]: new TextEncoder().encode("%PDF-1.4\n% 2025-4711\n%%EOF\n"),
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
  const offen = page.getByRole("region", { name: "Offene Posten übernehmen" });
  await expect(offen).toContainText("2025-4711");
  // Stichtag: letzter Tag der alten Buchhaltung; im Einzelunternehmen wählbar, gebucht wird am Tag danach
  await offen.getByLabel("Stichtag (letzter Tag der alten Buchhaltung)").fill(`${YEAR - 1}-12-30`);
  await offen.getByRole("button", { name: "Stichtag ändern" }).click();
  await expect(offen).toContainText(`Stichtag 30.12.${YEAR - 1}`);
  await expect(offen).toContainText(`Gebucht wird zum 31.12.${YEAR - 1}`);
  await expect(offen).toContainText("2025-4711");
  // Nach der ersten Übernahme steht der Stichtag fest: kein „Stichtag ändern“ mehr, der Grund steht im Text
  await offen
    .getByRole("row", { name: /2025-4711/ })
    .getByRole("button", { name: "Übernehmen" })
    .click();
  await expect(offen.getByRole("row", { name: /2025-4711/ }).getByRole("link", { name: "übernommen" })).toBeVisible();
  await expect(offen.getByRole("button", { name: "Stichtag ändern" })).toHaveCount(0);
  await expect(offen.getByLabel("Stichtag (letzter Tag der alten Buchhaltung)")).toHaveCount(0);
  await expect(offen).toContainText(`Stichtag 30.12.${YEAR - 1}`);
  await expect(offen).toContainText(`Die ersten offenen Posten sind zum 31.12.${YEAR - 1} übernommen`);
  // Die Privateinlage ist weder Einnahme noch Ausgabe; der Abgleich weist sie getrennt aus statt sie wegzulassen
  await expect(page.getByRole("table", { name: "Weder Einnahme noch Ausgabe 2026" })).toContainText("Privat und Geldtransit");
});

test("Auswertungen, Umsatzsteuer und Jahreserklärung laden", async () => {
  await go("/auswertungen");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Beträge rechtsbündig, Monate mittig: TanStack Redact 0.3.1 setzt das SVG-Attribut textAnchor nicht um,
  // deshalb steht es im Stil, und dieser Test prüft, was der Browser daraus macht
  const anchors = await page.locator(".chart .tick").evaluateAll((ticks) => ticks.map((tick) => getComputedStyle(tick).textAnchor));
  expect(anchors).toContain("end");
  expect(anchors).toContain("middle");
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

test("Voranmeldung vierteljährlich: Zeitraum einstellen, Quartal prüfen und testweise senden", async () => {
  // Im Folgejahr, damit die übrigen Seiten und Bilder beim monatlichen Zeitraum bleiben
  const next = YEAR + 1;
  await go(`/umsatzsteuer/${next}-01`);
  const card = page.getByRole("form", { name: `Voranmeldungszeitraum ${next}` });
  await expect(card).toContainText("monatlich");
  await card.getByRole("combobox", { name: "Zeitraum" }).selectOption("vierteljaehrlich");
  await card.getByLabel("Gilt ab").selectOption("1");
  await card.getByRole("button", { name: "Zeitraum speichern" }).click();
  await expect(card.getByRole("status")).toContainText(`Voranmeldungszeitraum ${next} gespeichert.`);
  // Der Januar passt nicht mehr dazu
  await expect(page.getByText(`Für Januar ${next} passt die Voranmeldung nicht zum eingestellten Zeitraum (vierteljährlich).`)).toBeVisible();

  await go(`/umsatzsteuer/${next}-Q1`);
  await expect(page.getByRole("heading", { level: 1, name: `1. Quartal ${next}` })).toBeVisible();
  // 10. April oder der nächste Werktag danach (§ 108 Abs. 3 AO)
  await expect(page.getByText("Fällig am", { exact: false })).toContainText(`April ${next}`);
  // axe prüft das Quartal und den Bereich Voranmeldungszeitraum in barrierefreiheit.spec.ts

  // Die Voranmeldung, nicht der Antrag auf Dauerfristverlängerung daneben. Nach Prüfen und Senden zeigt die Seite die
  // Meldung, bevor React die neu geladenen Daten einsetzt; mit ihnen baut sich das Formular neu auf (Schlüssel aus dem
  // Stand des Entwurfs) und verliert PIN und Auswahl. Erst weiter, wenn der Verlauf den neuen Eintrag zeigt
  const elster = page.getByRole("form", { name: "An ELSTER übermitteln" });
  const history = page.getByRole("region", { name: `Verlauf 1. Quartal ${next}` });
  await elster.getByRole("button", { name: "Nur prüfen" }).click();
  await expect(page.getByText("ERiC hat die Daten geprüft, keine Fehler.")).toBeVisible();
  await expect(history).toContainText(/Prüfung\s*OK/);
  const testSend = elster.getByRole("button", { name: "Prüfen und testweise senden" });
  await elster.getByLabel("Zertifikats-PIN").fill("123456");
  await testSend.click();
  await expect(page.getByText(/Testübermittlung erfolgreich/)).toBeVisible();
  await expect(history).toContainText(/Testübermittlung\s*OK/);

  // Zurück auf monatlich: Der Entwurf des Quartals bleibt mit seinem Verlauf, lässt sich aber nicht mehr senden
  const frequency = page.getByRole("form", { name: `Voranmeldungszeitraum ${next}` });
  await frequency.getByRole("combobox", { name: "Zeitraum" }).selectOption("monatlich");
  await frequency.getByRole("button", { name: "Zeitraum speichern" }).click();
  await expect(frequency.getByRole("status")).toContainText(`Voranmeldungszeitraum ${next} gespeichert.`);
  await expect(frequency).toContainText("Eingestellt: monatlich");
  await expect(page.getByText(`Für 1. Quartal ${next} passt die Voranmeldung nicht zum eingestellten Zeitraum (monatlich).`)).toBeVisible();
});

test("Dauerfristverlängerung: Sondervorauszahlung prüfen und testweise senden, Kz 39 im Dezember", async () => {
  // Im Folgejahr, damit die übrigen Seiten und Bilder ohne Dauerfristverlängerung bleiben
  const next = YEAR + 1;
  await go(`/umsatzsteuer/${next}-01`);
  const card = page.getByRole("region", { name: `Dauerfristverlängerung ${next}` });
  await expect(card).toContainText("Nicht eingetragen");
  const amount = card.getByRole("textbox", { name: "Sondervorauszahlung (Kz 38, volle Euro)" });
  await amount.fill("1.234,56");
  await expect(card.getByText("Betrag in vollen Euro, nicht negativ.")).toBeVisible();
  await amount.fill("1.234");
  const submit = card.getByRole("form", { name: "Sondervorauszahlung an ELSTER" });
  await submit.getByRole("button", { name: "Nur prüfen" }).click();
  await expect(submit.getByText("ERiC hat die Daten geprüft, keine Fehler.")).toBeVisible();
  await submit.getByLabel("Zertifikats-PIN").fill("123456");
  await submit.getByRole("button", { name: "Prüfen und testweise senden" }).click();
  await expect(submit.getByText(/Testübermittlung erfolgreich/)).toBeVisible();
  await expect(card.getByRole("list", { name: `Verlauf Dauerfristverlängerung ${next}` })).toContainText("Testübermittlung OK");

  // Außerhalb von Haben beantragt: von Hand eintragen, dann zieht der Dezember die Sondervorauszahlung ab
  const manual = card.getByRole("form", { name: "Außerhalb von Haben" });
  await manual.getByRole("checkbox", { name: `Dauerfristverlängerung besteht für ${next}` }).check();
  await manual.getByRole("button", { name: "Stand speichern" }).click();
  await expect(manual.getByRole("status")).toContainText(`Dauerfristverlängerung für ${next} eingetragen.`);
  await expect(card).toContainText("Voranmeldungen sind einen Monat später fällig");

  await go(`/umsatzsteuer/${next}-12`);
  await expect(page.getByText("Abzug der festgesetzten Sondervorauszahlung")).toBeVisible();
  await expect(page.locator("#kz-39")).toHaveText(/1\.234,00/);
  // Dezember mit Dauerfristverlängerung: fällig im Februar
  await expect(page.getByText("Fällig am", { exact: false })).toContainText(`Februar ${next + 1}`);

  // Wieder beenden, damit Fristen und Bilder ohne Verlängerung bleiben
  await go(`/umsatzsteuer/${next}-01`);
  const again = page.getByRole("region", { name: `Dauerfristverlängerung ${next}` }).getByRole("form", { name: "Außerhalb von Haben" });
  await again.getByRole("checkbox", { name: `Dauerfristverlängerung besteht für ${next}` }).uncheck();
  await again.getByRole("button", { name: "Stand speichern" }).click();
  await expect(again.getByRole("status")).toContainText(`Dauerfristverlängerung ab ${next} beendet.`);
});

test("Zusammenfassende Meldung: Leistung ins EU-Ausland, Quartal prüfen und testweise senden", async () => {
  // Im Folgejahr wie die Dauerfristverlängerung, damit die Zahlen des laufenden Jahres und die Bilder gleich bleiben
  const next = YEAR + 1;
  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("USt-IdNr.").fill("DE136695976");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
  await page.waitForLoadState("networkidle");

  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Donaublick GmbH");
  await page.getByLabel("Straße und Hausnummer").fill("Praterstraße 3");
  await page.getByLabel("PLZ").fill("1020");
  await page.getByLabel("Ort").fill("Wien");
  await page.getByLabel("Land (ISO-Code)").fill("AT");
  await page.getByLabel("USt-IdNr.").fill("ATU12345678");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  await go("/rechnungen/neu");
  await page.getByLabel("Kunde").selectOption({ label: "Donaublick GmbH · Wien" });
  await page.getByLabel("Rechnungsdatum").fill(`${next}-02-10`);
  await page.getByRole("combobox", { name: "Umsatzsteuer", exact: true }).selectOption("reverse_charge");
  await page.getByLabel("Beschreibung Position 1").fill("Beratung Cloud-Architektur");
  await page.getByLabel("Menge Position 1").fill("2");
  await page.getByLabel(/Einzelpreis Position 1/).fill("1.200,50");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await page.getByRole("button", { name: "Jetzt festschreiben" }).click();
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });

  // Die Voranmeldung des Monats verweist auf die Meldung des Quartals
  await go(`/umsatzsteuer/${next}-02`);
  await page.getByRole("link", { name: "Zur Zusammenfassenden Meldung" }).click();
  await expect(page).toHaveURL(new RegExp(`/umsatzsteuer/zm/${next}-Q1$`));
  await expect(page.getByRole("heading", { name: `1. Quartal ${next}` })).toBeVisible();
  const zeilen = page.getByRole("table", { name: `Meldezeilen 1. Quartal ${next}` });
  await expect(zeilen).toContainText("ATU12345678");
  await expect(zeilen).toContainText("Sonstige Leistung");
  await expect(zeilen).toContainText("2.401 €");

  const submit = page.getByRole("form", { name: "Meldung an das BZSt" });
  await submit.getByRole("button", { name: "Nur prüfen" }).click();
  await expect(submit.getByText("ERiC hat die Daten geprüft, keine Fehler.")).toBeVisible();
  await submit.getByLabel("Zertifikats-PIN").fill("123456");
  await submit.getByRole("button", { name: "Prüfen und testweise senden" }).click();
  await expect(submit.getByText(/Testübermittlung erfolgreich/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Verlauf" })).toContainText("Testübermittlung OK");
  // Eine Testübermittlung zählt nicht als gemeldet: weiter als Erstmeldung
  await expect(page.getByRole("form", { name: "Meldung an das BZSt" })).toBeVisible();
});

test("Innergemeinschaftliche Lieferung: Kz 41 in der Voranmeldung und Umsatzart L in der Zusammenfassenden Meldung", async () => {
  // Nach der Zusammenfassenden Meldung oben: USt-IdNr. in den Firmendaten und der Kunde in Wien sind angelegt
  const next = YEAR + 1;
  await go("/rechnungen/neu");
  await page.getByLabel("Kunde").selectOption({ label: "Donaublick GmbH · Wien" });
  await page.getByLabel("Rechnungsdatum").fill(`${next}-05-12`);
  await page.getByRole("combobox", { name: "Umsatzsteuer", exact: true }).selectOption("ig_lieferung");
  await expect(page.getByText(/Gelangensnachweis \(§ 17a UStDV\)/)).toBeVisible();
  await page.getByLabel("Beschreibung Position 1").fill("Industrierechner");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("3.000,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await page.getByRole("button", { name: "Jetzt festschreiben" }).click();
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });

  await go(`/umsatzsteuer/${next}-05`);
  await expect(page.getByText("Steuerfreie innergemeinschaftliche Lieferungen an Abnehmer mit USt-IdNr.")).toBeVisible();
  await expect(page.locator("#kz-41")).toHaveText(/3\.000,00/);
  await page.getByRole("link", { name: "Zur Zusammenfassenden Meldung" }).click();
  await expect(page).toHaveURL(new RegExp(`/umsatzsteuer/zm/${next}-Q2$`));
  const zeilen = page.getByRole("table", { name: `Meldezeilen 2. Quartal ${next}` });
  await expect(zeilen).toContainText("ATU12345678");
  await expect(zeilen).toContainText("Innergemeinschaftliche Lieferung");
  await expect(zeilen).toContainText("3.000 €");
  await expect(page.getByText(/Gelangensnachweis \(§ 17a UStDV\)/)).toBeVisible();
});

test("Beleg mit innergemeinschaftlichem Erwerb: 500 € netto, 95 € Erwerbsteuer, gezahlt wird netto", async ({ browser }) => {
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "hardware-nl.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Hollandse Hardware B.V.") }]);
  await expect(page.getByText("hardware-nl.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /hardware-nl\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/^USt-IdNr\. des Lieferanten/).fill("NL123456789B01");
  await page.getByLabel("Kategorie").selectOption("wareneinkauf");
  await page.getByLabel("Netto", { exact: true }).fill("500");
  await page.getByLabel("Vorsteuer", { exact: true }).fill("0");
  await expect(page.getByText(/bei Ware ein innergemeinschaftlicher Erwerb/)).toBeVisible();
  await page.getByRole("combobox", { name: /^Umsatzsteuer auf dem Beleg/ }).selectOption("ig_erwerb");
  await expect(page.getByLabel("Erwerbsteuer", { exact: true })).toHaveValue("95,00");
  await expect(page.getByText(/Kz 89 \(19 %\)/)).toBeVisible();
  await expect(page.getByText("Zu zahlen (netto)")).toBeVisible();
  // Nicht buchen: der Beleg würde die folgenden Auswertungen und Bilder verändern
  await page.getByRole("button", { name: "Löschen" }).click();
  await page.getByRole("button", { name: "Endgültig löschen" }).click();
  await page.waitForURL(/\/belege$/);
});

test("REST-API: Token mit Rechten anlegen, Rechnungsentwurf mit Bestellnummer und Beleg über die API", async ({ browser }) => {
  await go("/einstellungen?bereich=ki");
  // Ohne ANTHROPIC_API_KEY und EXTRACTION_BASE_URL ist die Belegauslesung aus; die Karte sagt es und verweist auf die Doku
  const auslesung = page.getByRole("region", { name: "Belegauslesung" });
  await expect(auslesung).toContainText("Die KI-Auslesung ist aus.");
  await expect(auslesung.getByRole("link", { name: "Belegauslesung einrichten" })).toHaveAttribute("href", /einrichtung\.html#ki-auslesung-von-belegen/);
  // Gesteuertes Kästchen: es zeigt den Stand erst nach der Antwort des Servers
  const zugang = page.getByLabel("Zugang für KI-Assistenten und API einschalten");
  await zugang.click();
  await expect(zugang).toBeChecked();
  const form = page.getByRole("form", { name: "Neues Token" });
  await form.getByLabel("Name").fill("Shop-Automation");
  const rechte = form.getByRole("group", { name: "Rechte" });
  await expect(rechte.getByRole("checkbox", { name: /haben:lesen/ })).toBeChecked();
  await rechte.getByRole("checkbox", { name: /haben:lesen/ }).uncheck();
  await rechte.getByRole("checkbox", { name: /kontakte:lesen/ }).check();
  await rechte.getByRole("checkbox", { name: /rechnungen:entwuerfe/ }).check();
  await rechte.getByRole("checkbox", { name: /belege:anlegen/ }).check();
  await form.getByRole("button", { name: "Token anlegen" }).click();
  const token = await page.getByLabel(/Token für „Shop-Automation“/).inputValue();
  expect(token).toMatch(/^hb_/);
  // Ohne MCP-Recht kein Befehl für Claude Code, dafür der Hinweis auf die REST-API
  await expect(page.getByLabel("In Claude Code eintragen")).toHaveCount(0);
  await expect(page.getByText(/Für die REST-API: Adresse/)).toBeVisible();
  await expect(page.getByText(/Rechte: API: Kontakte lesen · API: Rechnungen lesen, Entwürfe .* · API: Belege lesen und hochladen/)).toBeVisible();

  // Die Sitzung im Browser reicht der API nicht, nur das Token
  expect((await page.request.get("/api/v1/kontakte")).status()).toBe(401);
  const auth = { Authorization: `Bearer ${token}` };
  expect((await page.request.get("/api/v1/openapi.json")).status()).toBe(200);
  const kontakte = (await (await page.request.get("/api/v1/kontakte?q=Nordwerk", { headers: auth })).json()) as { data: { id: string }[] };
  expect(kontakte.data).toHaveLength(1);
  expect((await page.request.post("/api/v1/kontakte", { headers: auth, data: { name: "Ohne Recht" } })).status()).toBe(403);

  const entwurf = {
    contactId: kontakte.data[0]!.id,
    externalSource: "etsy",
    externalId: "3141592653",
    lines: [{ description: "Keramikbecher handgemacht", quantity: 2000, unit: "Stk.", unitPrice: 2400, taxRate: 1900 }],
  };
  const created = await page.request.post("/api/v1/rechnungen", { headers: auth, data: entwurf });
  expect(created.status()).toBe(201);
  const invoice = (await created.json()) as { id: string; gross: number; url: string; status: string };
  expect(invoice).toMatchObject({ gross: 5712, status: "draft" });
  // Derselbe Vorgang ein zweites Mal: kein Duplikat
  const again = await page.request.post("/api/v1/rechnungen", { headers: auth, data: entwurf });
  expect(again.status()).toBe(200);
  expect(((await again.json()) as { id: string }).id).toBe(invoice.id);

  // Der Entwurf steht in Haben wie jeder andere, mit der Position aus der API
  await go(new URL(invoice.url).pathname);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Rechnung");
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Keramikbecher handgemacht");

  // Wieder weg, damit die übrigen Seiten und Bilder dieselben Daten zeigen wie ohne diesen Test
  expect((await page.request.delete(`/api/v1/rechnungen/${invoice.id}`, { headers: auth })).status()).toBe(204);
  const found = (await (await page.request.get("/api/v1/rechnungen?externalSource=etsy&externalId=3141592653", { headers: auth })).json()) as { total: number };
  expect(found.total).toBe(0);

  // Ein Beleg aus einem Dokumentenarchiv, wie mit curl -F datei=@… -F externalSource=… -F externalId=…
  const beleg = {
    datei: { name: "archiv-4711.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Druckerei Archivtest GmbH") },
    externalSource: "archiv",
    externalId: "4711",
  };
  const uploaded = await page.request.post("/api/v1/belege", { headers: auth, multipart: beleg });
  expect(uploaded.status()).toBe(201);
  const document = (await uploaded.json()) as { id: string; url: string; status: string; booked: boolean };
  expect(document).toMatchObject({ status: "neu", booked: false });
  // Dasselbe Dokument ein zweites Mal: derselbe Beleg
  const repeated = await page.request.post("/api/v1/belege", { headers: auth, multipart: beleg });
  expect(repeated.status()).toBe(200);
  expect(((await repeated.json()) as { id: string }).id).toBe(document.id);

  // Unter Belege steht er als „Zu prüfen“, wie ein Upload in Haben
  await go("/belege");
  const row = page.getByRole("link", { name: /archiv-4711\.jpg/ });
  await expect(row).toContainText("Zu prüfen");
  await row.click();
  await page.waitForURL(new URL(document.url).pathname);
  await page.waitForLoadState("networkidle");
  // Nicht buchen: wieder löschen, damit die übrigen Seiten und Bilder dieselben Daten zeigen wie ohne diesen Test
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await page.getByRole("button", { name: "Endgültig löschen" }).click();
  await page.waitForURL(/\/belege$/);
  expect((await page.request.get(`/api/v1/belege/${document.id}`, { headers: auth })).status()).toBe(404);

  // Jeder Aufruf steht im Protokoll, ohne Inhalte
  await go("/einstellungen?bereich=ki");
  const calls = page.getByRole("region", { name: "Letzte Aufrufe" });
  await expect(calls.getByText("POST /rechnungen").first()).toBeVisible();
  await expect(calls.getByText("POST /belege").first()).toBeVisible();
});

test("Eigene Seiten: im Menü einhängen, im Rahmen anzeigen, ändern und entfernen", async () => {
  await fakeEigeneSeite(page);
  await page.route("https://lager.example/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Lager</title><h1>Lager</h1>" }),
  );
  await go("/einstellungen?bereich=seiten");
  const form = page.getByRole("form", { name: "Neue eigene Seite" });
  // Haben selbst im Rahmen hätte die volle Sitzung: abgelehnt
  await form.getByLabel("Name im Menü").fill("Bank");
  await form.getByLabel("Adresse").fill(new URL("/bank", page.url()).href);
  await form.getByRole("button", { name: "Seite hinzufügen" }).click();
  await expect(page.getByText(/muss unter einer anderen Adresse laufen als Haben/).last()).toBeVisible();

  await form.getByLabel("Name im Menü").fill(EIGENE_SEITE.name);
  await form.getByLabel("Adresse").fill(EIGENE_SEITE.url);
  await form.getByRole("button", { name: "Seite hinzufügen" }).click();
  await expect(page.getByText("Seite angelegt. Sie steht jetzt im Menü.")).toBeVisible();
  const menu = page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("group", { name: "Eigene Seiten" });
  await menu.getByRole("link", { name: EIGENE_SEITE.name }).click();
  await page.waitForURL(/\/seiten\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(EIGENE_SEITE.name);
  await expect(page.getByRole("link", { name: "In neuem Tab öffnen" })).toHaveAttribute("href", EIGENE_SEITE.url);
  const frame = page.locator(`iframe[title="${EIGENE_SEITE.name}"]`);
  // Die Seite darf Haben nicht wegnavigieren und bekommt nicht einmal die Adresse von Haben mit
  await expect(frame).toHaveAttribute("sandbox", /allow-scripts/);
  await expect(frame).not.toHaveAttribute("sandbox", /allow-top-navigation/);
  await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(page.frameLocator(`iframe[title="${EIGENE_SEITE.name}"]`).getByRole("heading", { name: "Offene Bestellungen" })).toBeVisible();

  // Eine zweite Seite anlegen, umbenennen und wieder entfernen
  await go("/einstellungen?bereich=seiten");
  await form.getByLabel("Name im Menü").fill("Lager");
  await form.getByLabel("Adresse").fill("https://lager.example/");
  await form.getByRole("button", { name: "Seite hinzufügen" }).click();
  await expect(menu.getByRole("link", { name: "Lager" })).toBeVisible();
  await page.getByRole("button", { name: "Lager bearbeiten" }).click();
  const edit = page.getByRole("form", { name: "Lager bearbeiten" });
  await expect(edit.getByLabel("Adresse")).toHaveValue("https://lager.example/");
  await edit.getByLabel("Name im Menü").fill("Abholung");
  await edit.getByRole("button", { name: "Speichern" }).click();
  await expect(menu.getByRole("link", { name: "Abholung" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Lager" })).toHaveCount(0);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Abholung entfernen" }).click();
  await expect(page.getByText("Seite entfernt.")).toBeVisible();
  // Bestellungen bleibt für seiten.spec.ts und barrierefreiheit.spec.ts
  await expect(menu.getByRole("link")).toHaveText([EIGENE_SEITE.name]);
});

test("Lohn: Minijob anlegen und den laufenden Monat abrechnen", async ({ browser }) => {
  // Ohne Mitarbeiter kein SV-Meldeportal im Menü; die Seite selbst bleibt erreichbar und verweist auf Lohn
  const personal = page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("group", { name: "Personal" });
  await go("/sv-meldeportal");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("SV-Meldeportal");
  await expect(personal.getByRole("link")).toHaveText(["Lohn"]);
  // Den Hinweis ohne Mitarbeiter sieht barrierefreiheit.spec.ts nicht mehr. AxeBuilder braucht einen eigenen Kontext, mit derselben Sitzung
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const axePage = await context.newPage();
  await axePage.goto(new URL("/sv-meldeportal", page.url()).toString());
  await axePage.waitForLoadState("networkidle");
  await expect(axePage.getByRole("heading", { level: 1 })).toHaveText("SV-Meldeportal");
  const { violations } = await new AxeBuilder({ page: axePage }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    "/sv-meldeportal ohne Mitarbeiter",
  ).toEqual([]);
  await context.close();
  await page.getByRole("main").getByRole("link", { name: "Lohn", exact: true }).click();
  await page.waitForURL(/\/lohn$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Mitarbeiter anlegen" }).click();
  await page.waitForURL("**/lohn/mitarbeiter/neu");
  await page.waitForLoadState("networkidle");
  const form = page.getByRole("form", { name: "Stammdaten des Mitarbeiters" });
  await form.getByLabel("Vorname").fill("Jonas");
  await form.getByLabel("Nachname").fill("Aushilfe");
  await form.getByLabel("Straße und Hausnummer").fill("Am Markt 2");
  await form.getByLabel("PLZ").fill("93047");
  await form.getByLabel("Ort", { exact: true }).fill("Regensburg");
  await form.getByLabel("Geburtsdatum").fill("2001-03-15");
  await form.getByLabel("Art der Beschäftigung").selectOption("minijob");
  await form.getByLabel("Monatsgehalt brutto in Euro").fill("520,00");
  await form.getByLabel("Eintritt", { exact: true }).fill(`${new Date().getFullYear()}-01-01`);
  await form.getByLabel("Steuer-ID").fill("47291830467");
  await form.getByLabel("Versicherungsnummer").fill("65150301A123");
  await form.getByLabel("Personengruppe").fill("109");
  await form.getByLabel("Beitragsgruppenschlüssel").fill("6100");
  await form.getByRole("button", { name: "Mitarbeiter anlegen" }).click();
  await page.waitForURL(/\/lohn$/);
  await expect(page.getByRole("link", { name: "Jonas Aushilfe", exact: true })).toBeVisible();
  await expect(personal.getByRole("link")).toHaveText(["Lohn", "SV-Meldeportal"]);

  // Minijob mit Pauschsteuer: keine Lohnsteuer, der Beschäftigte trägt 3,6 % zur Rentenversicherung (520 € → 18,72 €)
  await page.getByRole("button", { name: "Monat abrechnen" }).click();
  await expect(page.getByText("Ein Entwurf angelegt.")).toBeVisible();
  const abrechnung = page.getByRole("region", { name: /^1\. Abrechnung Stufe B/ });
  await expect(abrechnung.getByRole("row", { name: /Sozialversicherung \(Anteil Beschäftigte\)/ })).toContainText("-18,72");
  await expect(abrechnung.getByRole("row", { name: "Auszahlung" })).toContainText("501,28");
});

test("Skonto: Vorgabe und Kunde, Rechnung mit Skonto, Zahlung mit Skonto abgleichen", async ({ browser }) => {
  // Vorgabe in den Firmendaten: 2 % in 10 Tagen
  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByRole("button", { name: "+ Skontostufe hinzufügen" }).click();
  await firma.getByLabel("Stufe 1: Skonto in %").fill("2");
  await firma.getByLabel("Stufe 1: Frist in Tagen").fill("10");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(firma.getByRole("status")).toContainText("Firmendaten gespeichert.");

  // Ein Kunde mit eigenem Skonto: 3 % in 7 Tagen
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Kontor Lindner KG");
  await page.getByLabel("Straße und Hausnummer").fill("Speicherstadt 4");
  await page.getByLabel("PLZ").fill("20457");
  await page.getByLabel("Ort").fill("Hamburg");
  await page.getByRole("combobox", { name: /^Skonto/ }).selectOption("eigen");
  await page.getByRole("button", { name: "+ Skontostufe hinzufügen" }).click();
  await page.getByLabel("Stufe 1: Skonto in %").fill("3");
  await page.getByLabel("Stufe 1: Frist in Tagen").fill("7");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  // Neue Rechnung: erst die Vorgabe der Firma, mit dem Kunden dessen Skonto; Datum und Betrag stehen daneben
  const issueDate = day(-2);
  await go("/rechnungen/neu");
  await expect(page.getByLabel("Stufe 1: Skonto in %")).toHaveValue("2");
  await page.getByLabel("Kunde").selectOption({ label: "Kontor Lindner KG · Hamburg" });
  await expect(page.getByLabel("Stufe 1: Skonto in %")).toHaveValue("3");
  await expect(page.getByLabel("Stufe 1: Frist in Tagen")).toHaveValue("7");
  await page.getByLabel("Rechnungsdatum").fill(issueDate);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung Lagerlogistik");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("1.000,00");
  const until = new Date(`${issueDate}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 7);
  const untilText = until.toISOString().slice(0, 10).split("-").reverse().join(".");
  // 3 % von 1.190,00 € = 35,70 €
  await expect(page.getByText(`bis ${untilText}: 35,70 € Skonto, zu zahlen 1.154,30 €`)).toBeVisible();
  await expect(page.getByLabel("Vorschau der Rechnung")).toContainText(`Bei Zahlung bis zum ${untilText} gewähren wir 3 % Skonto (35,70 €)`);
  // Eine Frist über das Zahlungsziel hinaus lässt sich nicht speichern
  await page.getByLabel("Stufe 1: Frist in Tagen").fill("30");
  await expect(page.getByText("Die Skontofrist von 30 Tagen ist länger als das Zahlungsziel von 14 Tagen.")).toBeVisible();
  await page.getByLabel("Stufe 1: Frist in Tagen").fill("7");

  // Editor mit Skontostufe für axe, am Desktop und am Handy (WCAG 2.2 AA wie barrierefreiheit.spec.ts)
  async function axe(path: string, ready: (p: Page) => Promise<void>) {
    const context = await browser.newContext({ storageState: await page.context().storageState() });
    const axePage = await context.newPage();
    for (const width of [1440, 390]) {
      await axePage.setViewportSize({ width, height: 900 });
      await axePage.goto(new URL(path, page.url()).toString());
      await axePage.waitForLoadState("networkidle");
      await ready(axePage);
      const { violations } = await new AxeBuilder({ page: axePage })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        `${path} bei ${width} px`,
      ).toEqual([]);
    }
    await context.close();
  }

  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const invoicePath = new URL(page.url()).pathname;
  await axe(invoicePath, (p) => expect(p.getByLabel("Stufe 1: Skonto in %")).toHaveValue("3"));
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await page.getByRole("button", { name: "Jetzt festschreiben" }).click();
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const number = (await page.getByRole("heading", { level: 1 }).textContent())?.match(/\d{4}-\d{3}/)?.[0] ?? "";
  expect(number).not.toBe("");

  // Zahlung in der Frist mit 3 % Skonto
  const csv =
    "﻿" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n"Kontostand vom ${dkb(day(0))}:";"1.154,30 €"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    [
      dkb(day(0)),
      dkb(day(0)),
      "Gebucht",
      "Kontor Lindner KG",
      "Max Mustermann",
      `RE ${number} abzgl. 3 % Skonto`,
      "Eingang",
      "DE75512108001245126199",
      "1.154,30",
      "",
      "",
      "",
    ]
      .map((v) => `"${v}"`)
      .join(";") +
    "\n";
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "skonto.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/1 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("link", { name: /Kontor Lindner KG/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await expect(panel.getByRole("heading", { name: "Kontor Lindner KG" })).toBeVisible();
  await expect(panel.getByText("Betrag stimmt mit 3 % Skonto (35,70 €), in der Frist")).toBeVisible();
  await axe(new URL(page.url()).pathname + new URL(page.url()).search, (p) =>
    expect(p.getByRole("button", { name: "Zuordnen, Rest 35,70 € als Skonto" })).toBeVisible(),
  );
  await panel.getByRole("button", { name: "Zuordnen, Rest 35,70 € als Skonto" }).click();
  await expect(panel.getByRole("heading", { name: "Kontor Lindner KG" })).toBeHidden();
  await page.waitForLoadState("networkidle");

  // Die Rechnung ist bezahlt, das Skonto ausgebucht
  await go(invoicePath);
  await expect(page.getByText("Bezahlt").first()).toBeVisible();
  await expect(page.getByText("Skonto gewährt").first()).toBeVisible();

  // Vorgabe wieder entfernen, damit die übrigen Tests ohne Skonto rechnen
  await go("/einstellungen");
  await firma.getByRole("button", { name: "Skontostufe 1 entfernen" }).click();
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(firma.getByRole("status")).toContainText("Firmendaten gespeichert.");
});

test("CSV-Import: Kontakte, Artikel und Anlagen mit Vorschau, Zuordnung und Dubletten", async ({ browser }) => {
  // Kontakte wie aus Excel unter Windows: Windows-1252, Semikolon; die E-Mail-Spalte heißt anders und wird von Hand zugeordnet
  const kontakte = [
    "Kundennummer;Firmenname;Straße;PLZ;Ort;Land;Elektronische Post;IBAN",
    "K-900;Brückenbau Süd GmbH;Talstraße 3;79098;Freiburg;DE;info@brueckenbau.example;DE89 3704 0044 0532 0130 00",
    "K-901;Nordwerk Software GmbH;Hafenstraße 5;20457;Hamburg;DE;;",
    "K-902;Öko-Druck eG;Feldweg 1;34117;Kassel;Deutschland;druck@oeko.example;DE89 3704 0044 0532 0130 01",
    "K-903;Weinhaus Ahr GmbH;Ahrstraße 7;53474;Bad Neuenahr;276;;",
  ].join("\r\n");
  await go("/kontakte");
  await page.getByRole("link", { name: "CSV importieren" }).click();
  await page.waitForURL(/\/csv-import\?art=kontakte$/);
  await page.getByLabel("CSV-Datei").setInputFiles([{ name: "kontakte.csv", mimeType: "text/csv", buffer: Buffer.from(kontakte, "latin1") }]);
  await page.getByRole("button", { name: "Vorschau" }).click();
  const mapping = page.getByRole("region", { name: "Spalten zuordnen" });
  await expect(mapping).toContainText("Erkannt: Windows-1252, Semikolon, 8 Spalten");
  await expect(mapping.getByLabel("Firma")).toHaveValue("1");
  await expect(mapping.getByLabel("E-Mail")).toHaveValue("");
  await mapping.getByLabel("E-Mail").selectOption({ label: "Elektronische Post" });
  const preview = page.getByRole("region", { name: "Vorschau" });
  await expect(preview).toContainText("2 neu, 1 Dublette, 1 mit Fehlern");
  await expect(preview).toContainText("Gibt es schon (Name nordwerk software gmbh)");
  await expect(preview).toContainText("IBAN: „DE89 3704 0044 0532 0130 01“ ist ungültig");
  // Barrierefreiheit mit Zuordnung und Vorschau, in eigenem Kontext (axe braucht ihn); barrierefreiheit.spec.ts sieht nur das leere Formular
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const axePage = await context.newPage();
  await axePage.goto(new URL("/csv-import?art=kontakte", page.url()).toString());
  await axePage.getByLabel("CSV-Datei").setInputFiles([{ name: "kontakte.csv", mimeType: "text/csv", buffer: Buffer.from(kontakte, "latin1") }]);
  await axePage.getByRole("button", { name: "Vorschau" }).click();
  await expect(axePage.getByRole("region", { name: "Vorschau" })).toContainText("mit Fehlern");
  const { violations } = await new AxeBuilder({ page: axePage }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  await context.close();
  await preview.getByRole("button", { name: "2 Kontakte übernehmen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "übernommen" })).toHaveText(
    "2 Kontakte übernommen, 1 Dublette und 1 fehlerhafte Zeile übersprungen.",
  );
  await go("/kontakte");
  const liste = page.getByRole("region", { name: "Kontaktliste" });
  await expect(liste).toContainText("Brückenbau Süd GmbH");
  await expect(liste).toContainText("Weinhaus Ahr GmbH");
  await expect(liste).not.toContainText("Öko-Druck eG");

  // Artikel als UTF-8 mit Komma, Preise deutsch in Anführungszeichen
  const artikel = [
    "Artikelnummer,Bezeichnung,Einheit,Nettopreis,Umsatzsteuer",
    'CSV-1,Datenmigration,Tag,"1.150,00",19',
    'CSV-2,Fachbuch Steuern,Stück,"39,90",7',
  ].join("\n");
  await go("/artikel");
  await page.getByRole("link", { name: "CSV importieren" }).click();
  await page.waitForURL(/art=artikel$/);
  await page.getByLabel("CSV-Datei").setInputFiles([{ name: "artikel.csv", mimeType: "text/csv", buffer: Buffer.from(artikel) }]);
  await page.getByRole("button", { name: "Vorschau" }).click();
  await expect(page.getByRole("region", { name: "Spalten zuordnen" })).toContainText("Erkannt: UTF-8, Komma");
  await page.getByRole("button", { name: "2 Artikel übernehmen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "übernommen" })).toHaveText("2 Artikel übernommen.");
  await go("/artikel");
  await expect(page.getByRole("region", { name: "Artikelliste" })).toContainText("Datenmigration");

  // Anlage mit Restbuchwert zum Stichtag; eine Anschaffung nach dem Stichtag gehört als Beleg gebucht
  const anlagen = [
    "Bezeichnung;Art;Anschaffungsdatum;Anschaffungskosten;Nutzungsdauer;Restbuchwert",
    `Lastenrad;Fahrzeug;01.04.${YEAR - 2};4.800,00;6;3.600,00`,
    `Neuer Monitor;Computer;02.01.${YEAR};900,00;;900,00`,
  ].join("\n");
  await go("/anlagen");
  await page.getByRole("link", { name: "CSV importieren" }).click();
  await page.waitForURL(/art=anlagen$/);
  await page.getByLabel("Übernahmestichtag").fill(`${YEAR}-01-01`);
  await page.getByLabel("CSV-Datei").setInputFiles([{ name: "anlagen.csv", mimeType: "text/csv", buffer: Buffer.from(anlagen) }]);
  await page.getByRole("button", { name: "Vorschau" }).click();
  await expect(page.getByRole("region", { name: "Vorschau" })).toContainText("als Beleg mit der Kategorie Anlagegut buchen");
  // Ein anderer Stichtag nach der Vorschau gilt nicht ungesehen: Der Import übernähme sonst andere Werte als gezeigt
  await page.getByLabel("Übernahmestichtag").fill(`${YEAR - 1}-01-01`);
  await expect(page.getByRole("button", { name: "1 Anlage übernehmen" })).toHaveCount(0);
  await page.getByLabel("Übernahmestichtag").fill(`${YEAR}-01-01`);
  await page.getByRole("button", { name: "Vorschau" }).click();
  await page.getByRole("button", { name: "1 Anlage übernehmen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "übernommen" })).toHaveText("1 Anlage übernommen, 1 fehlerhafte Zeile übersprungen.");
  await go(`/anlagen?jahr=${YEAR}`);
  await expect(page.getByText("Lastenrad").first()).toBeVisible();
});

test("Voranmeldung außerhalb von Haben abgegeben: Abgabe vermerken, Zahllast im Bankabgleich zuordnen", async () => {
  // Ein Monat vor dem Vorjahr ohne Buchungen, damit die übrigen Seiten, Bilder und die Sondervorauszahlung unverändert bleiben
  const year = YEAR - 2;
  const yy = String(year).slice(2);
  await go(`/umsatzsteuer/${year}-06`);
  await page.getByRole("button", { name: "Manuell überschreiben" }).click();
  await page.getByLabel("Steuerpflichtige Umsätze 19 %").fill("1.000,00");
  await page.getByLabel("Begründung der Abweichung (Pflicht)").fill("Rechnung aus der alten Buchhaltung, dort nicht gemeldet");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await expect(page.getByText("Entwurf gespeichert.")).toBeVisible();

  const vermerk = page.getByRole("form", { name: "Außerhalb von Haben abgegeben" });
  await vermerk.getByLabel("Tag der Abgabe").fill(`${year}-07-09`);
  await vermerk.getByLabel("Transferticket").fill("et7f3k9m2q8w4x1z");
  await vermerk.getByLabel("Übermittlungsprotokoll (PDF)").setInputFiles({
    name: "Uebermittlungsprotokoll.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% Übermittlungsprotokoll Juni\n%%EOF\n"),
  });
  // Kz 83 laut Protokoll weicht ab: Haben lehnt ab
  await vermerk.getByLabel("Kz 83 laut Protokoll").fill("200,00");
  await vermerk.getByRole("button", { name: "Abgabe vermerken" }).click();
  await expect(vermerk.getByRole("alert")).toContainText("weicht von der Voranmeldung");
  await vermerk.getByLabel("Kz 83 laut Protokoll").fill("190,00");
  await vermerk.getByRole("button", { name: "Abgabe vermerken" }).click();
  await expect(page.getByText(`Abgegeben 09.07.${year} (vermerkt)`)).toBeVisible();
  await expect(page.getByRole("region", { name: `Verlauf Juni ${year}` })).toContainText("Abgabe vermerkt");
  const zahlung = page.getByRole("region", { name: "Zahlung an das Finanzamt" });
  await expect(zahlung).toContainText("offen 190,00");
  const protokoll = await page.request.get((await page.getByRole("link", { name: "Protokoll" }).first().getAttribute("href"))!);
  expect(protokoll.headers()["content-type"]).toContain("application/pdf");

  // Lastschrift des Finanzamts: Haben schlägt die Voranmeldung vor, gebucht wird Umsatzsteuer an Bank mit Bezug
  const csv =
    "\ufeff" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n"Kontostand vom ${dkb(day(0))}:";"16.067,10 €"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    [
      `10.07.${yy}`,
      `10.07.${yy}`,
      "Gebucht",
      "Max Mustermann",
      "Finanzamt Regensburg",
      `USt 06/${yy} StNr 198/113/10010`,
      "Ausgang",
      "DE76750000000075001007",
      "-190,00",
      "",
      "",
      "",
    ]
      .map((v) => `"${v}"`)
      .join(";") +
    "\n";
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "finanzamt.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/1 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("link", { name: /Finanzamt Regensburg/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await expect(panel.getByRole("heading", { name: "Finanzamt Regensburg" })).toBeVisible();
  await expect(panel.getByText(`Voranmeldung USt 06/${year}`)).toBeVisible();
  await expect(panel.getByText("Zeitraum im Verwendungszweck")).toBeVisible();
  await panel.getByRole("button", { name: "Zuordnen" }).click();
  await expect(panel.getByRole("heading", { name: "Finanzamt Regensburg" })).toBeHidden();
  await page.waitForLoadState("networkidle");

  await go(`/umsatzsteuer/${year}-06`);
  await expect(page.getByRole("region", { name: "Zahlung an das Finanzamt" })).toContainText("ausgeglichen");
  await expect(page.getByRole("region", { name: "Zahlung an das Finanzamt" })).toContainText("Lastschrift 190,00");
});

test("Anlage übernehmen: degressive AfA mit Höchstsatz, Restbuchwert geprüft, Wechsel zur linearen", async () => {
  await go("/anlagen/neu");
  const form = page.getByRole("region", { name: "Angaben" });
  await form.getByLabel("Bezeichnung").fill("Drehbank degressiv");
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Sonstige Betriebs- und Geschäftsausstattung" });
  await form.getByLabel("Anschaffungsdatum").fill("2024-04-10");
  await form.getByLabel("Anschaffungskosten netto (€)").fill("50.000,00");
  await form.getByRole("combobox", { name: "Abschreibung", exact: true }).selectOption("degressiv");
  await form.getByLabel("Nutzungsdauer in Jahren").fill("10");
  // Wachstumschancengesetz: April bis Dezember 2024 höchstens das Doppelte des linearen Satzes und 20 %
  await expect(form.getByText("Höchstens 20 %; leer lassen für den Höchstsatz.")).toBeVisible();
  await form.getByLabel("Übernahmestichtag").fill("2026-01-01");
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("30.000,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await expect(page.getByRole("alert")).toContainText("Restbuchwert passt nicht zur degressiven AfA (rechnerisch 34.000,00 €)");
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("34.000,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await page.waitForURL(/\/anlagen\/[0-9a-f-]{36}$/);
  const plan = page.getByRole("region", { name: "Abschreibungsplan" });
  await expect(plan).toContainText("Degressiv mit Wechsel zur linearen (§ 7 Abs. 2 EStG), 10 Jahre, 20 %");
  await expect(plan.locator(".table-row", { hasText: /^2026/ })).toContainText("6.800,00");

  // Wechsel zur linearen AfA ab 2027: 27.200 € über die Restnutzungsdauer von 87 Monaten
  const angaben = page.getByRole("region", { name: "Angaben" });
  await angaben.getByLabel("Linear ab Jahr (optional)").fill("2027");
  await angaben.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert." })).toBeVisible();
  await expect(plan).toContainText("linear ab 2027");
  await expect(plan.locator(".table-row", { hasText: /^2027/ })).toContainText("3.751,72");
  await expect(angaben.getByLabel("Erinnerungswert 1 € bis zum Abgang stehen lassen")).not.toBeChecked();
});

test("Elektrofahrzeug übernehmen: AfA nach § 7 Abs. 2a EStG mit Erinnerungswert", async () => {
  await go("/anlagen/neu");
  const form = page.getByRole("region", { name: "Angaben" });
  await form.getByLabel("Bezeichnung").fill("E-Transporter");
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Fahrzeug" });
  await form.getByLabel("Anschaffungsdatum").fill("2025-08-01");
  await form.getByLabel("Anschaffungskosten netto (€)").fill("40.000,00");
  await form.getByRole("combobox", { name: "Abschreibung", exact: true }).selectOption("elektro");
  await expect(form.getByText("Nur für reine Elektrofahrzeuge, angeschafft vom 01.07.2025 bis 31.12.2027")).toBeVisible();
  await form.getByLabel("Erinnerungswert 1 € bis zum Abgang stehen lassen").check();
  await form.getByLabel("Übernahmestichtag").fill("2026-01-01");
  // 75 % im Anschaffungsjahr: Restbuchwert 10.000 €
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("10.000,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await page.waitForURL(/\/anlagen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const plan = page.getByRole("region", { name: "Abschreibungsplan" });
  await expect(plan).toContainText("Elektrofahrzeug 75/10/5/5/3/2 % (§ 7 Abs. 2a EStG), Erinnerungswert 1 €");
  await expect(plan.locator(".table-row", { hasText: /^2026/ })).toContainText("4.000,00");
  // Letztes Jahr der Staffel: 2 % abzüglich des Erinnerungswerts
  await expect(plan.locator(".table-row", { hasText: /^2030/ })).toContainText("799,00");
});

test("Anlage anlegen: Erinnerungswert angehakt, dann zu Computer gewechselt, wird ohne Erinnerungswert gespeichert", async () => {
  await go("/anlagen/neu");
  const form = page.getByRole("region", { name: "Angaben" });
  await form.getByLabel("Bezeichnung").fill("Notebook mit Haken");
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Sonstige Betriebs- und Geschäftsausstattung" });
  await form.getByLabel("Nutzungsdauer in Jahren").fill("5");
  await form.getByLabel("Erinnerungswert 1 € bis zum Abgang stehen lassen").check();
  // Computer: Nutzungsdauer ein Jahr, ohne Erinnerungswert; das ausgeblendete Häkchen darf nicht mitgehen
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Computer, Hardware und Software" });
  await expect(form.getByLabel("Erinnerungswert 1 € bis zum Abgang stehen lassen")).toHaveCount(0);
  await form.getByLabel("Anschaffungsdatum").fill("2025-03-01");
  await form.getByLabel("Anschaffungskosten netto (€)").fill("1.500,00");
  await form.getByLabel("Übernahmestichtag").fill("2026-01-01");
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("0,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await page.waitForURL(/\/anlagen\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("region", { name: "Abschreibungsplan" })).not.toContainText("Erinnerungswert");
});

test("Dauerbeleg: Miete mit Vertrag anlegen, Beleg zu prüfen, im Bankabgleich buchen und zuordnen", async () => {
  const termin = day(-4);
  await go("/dauerbelege");
  await page.getByRole("link", { name: "Neuer Dauerbeleg" }).click();
  await page.waitForURL(/\/dauerbelege\/neu$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Bezeichnung").fill("Büromiete Hafenstraße");
  await page.getByLabel("Lieferant", { exact: true }).fill("Hafen Immobilien GmbH");
  await page.getByLabel("Vertrags- oder Kundennummer (optional)").fill("MV-2026-17");
  await page.getByLabel("Kategorie").selectOption({ label: "Sonstiger Aufwand" });
  await page.getByLabel("Erster Beleg am").fill(termin);
  await page.getByLabel("Fällig Tage nach dem Termin").fill("3");
  await page
    .locator("input[type=file]")
    .setInputFiles([{ name: "mietvertrag.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% Mietvertrag Hafenstraße 5\n%%EOF\n") }]);
  // Ohne Steuerausweis gibt es keine Vorsteuer; der Vertrag weist sie hier aus (Option nach § 9 UStG)
  await expect(page.getByText(/Vorsteuer nur mit einem Dokument/)).toBeVisible();
  await page.getByLabel("Steuersatz 1").selectOption("1900");
  await page.getByLabel(/weist die Umsatzsteuer gesondert aus/).check();
  await page.getByLabel("Netto 1").fill("500,00");
  await expect(page.getByLabel("Umsatzsteuer 1")).toHaveValue("95,00");
  await expect(page.getByText("Je Termin: 500,00 € netto + 95,00 € Umsatzsteuer = 595,00 €")).toBeVisible();
  await page.getByRole("button", { name: "Dauerbeleg anlegen" }).click();
  await page.waitForURL(/\/dauerbelege\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Büromiete Hafenstraße" })).toBeVisible();
  await expect(page.getByRole("link", { name: "mietvertrag.pdf" })).toBeVisible();

  // Der Termin liegt zurück: der Lauf legt den Beleg „Zu prüfen“ an, gebucht wird nichts
  await go("/dauerbelege");
  await page.getByRole("button", { name: "1 fällige jetzt anlegen" }).click();
  await expect(page.getByText("1 Beleg zum Prüfen angelegt.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Büromiete Hafenstraße/ })).toContainText("1 zu prüfen");
  await go("/belege");
  await expect(page.getByRole("link", { name: /Hafen Immobilien GmbH/ })).toContainText("Dauerbeleg");
  await expect(page.getByRole("link", { name: /Hafen Immobilien GmbH/ })).toContainText("Zu prüfen");

  // Abbuchung der Miete: Haben schlägt den Beleg vor, ein Klick bucht und ordnet zu
  const csv =
    "\ufeff" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    [
      dkb(termin),
      dkb(termin),
      "Gebucht",
      "Max Mustermann",
      "Hafen Immobilien GmbH",
      "Miete MV-2026-17",
      "Ausgang",
      "DE02100100100006820101",
      "-595,00",
      "",
      "",
      "",
    ]
      .map((v) => `"${v}"`)
      .join(";") +
    "\n";
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "miete.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/1 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("link", { name: /Hafen Immobilien GmbH/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await expect(panel.getByText("Dauerbeleg, noch zu prüfen")).toBeVisible();
  await panel.getByRole("button", { name: "Buchen und zuordnen" }).click();
  await expect(panel.getByRole("heading", { name: "Hafen Immobilien GmbH" })).toBeHidden();
  await page.waitForLoadState("networkidle");

  // Der Beleg ist gebucht, verweist auf den Dauerbeleg und hat den Vertrag als Datei
  await go("/belege");
  await page.getByRole("link", { name: /Hafen Immobilien GmbH/ }).click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/Gebucht .*festgeschrieben/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Büromiete Hafenstraße" })).toBeVisible();

  // Pausieren und fortsetzen auf der Seite der Vorlage
  await page.getByRole("link", { name: "Büromiete Hafenstraße" }).click();
  await page.waitForURL(/\/dauerbelege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Pausieren" }).click();
  await expect(page.getByText(/Pausiert: Bis zum Fortsetzen/)).toBeVisible();
  await page.getByRole("button", { name: "Fortsetzen" }).click();
  await expect(page.getByText(/Aktiv: Haben legt zu jedem Termin/)).toBeVisible();
});

test("Keine Fehler im Browser, Sitzung für die übrigen Tests speichern", async () => {
  expect(pageErrors).toEqual([]);
  await page.context().storageState({ path: SESSION });
});
