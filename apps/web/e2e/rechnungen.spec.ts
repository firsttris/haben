import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { day, firstLink, YEAR } from "./daten.ts";
import { databaseUrlFuer } from "./durchlaeufe.ts";
import { HANDY, LAPTOP, sichtbar, statusBleibtSichtbar, zumEnde } from "./kopfzeile.ts";
import {
  artikelEinfuegen,
  artikelInPosition,
  axeVerstoesse,
  bestaetigen,
  faktenZeigen,
  CUSTOMERS,
  durchlaufSeite,
  einrichten,
  gehe,
  INVOICES,
  kontaktAnlegen,
  kundeWaehlen,
  neuenKontaktOeffnen,
  ohneAxeVerstoesse,
  rechnungFestschreiben,
  trefferliste,
  randImDialog,
} from "./einrichtung.ts";
import { receiptJpeg } from "./belegbild.ts";

/**
 * Rechnungen, Angebote und Kasse in eigener, leerer Datenbank (Projekt „rechnungen“, e2e/durchlaeufe.ts), parallel zu
 * app.spec.ts: Kundennummern, Artikel und Textbausteine, Angebote bis zur Abschlags- und Schlussrechnung, Versand per
 * E-Mail mit Anhängen, Kassenbuch, REST-API und CSV-Import. Am Anfang dieselbe Einrichtung, dieselben drei Kunden und
 * eine festgeschriebene Rechnung wie in app.spec.ts.
 */

test.describe.configure({ mode: "serial" });

let page: Page;
let pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
});

test.afterAll(async () => {
  await page.context().close();
});

const go = (path: string) => gehe(page, path);

test("Einrichtung mit drei Kunden und einer festgeschriebenen Rechnung", async () => {
  await einrichten(page);
  for (const kunde of CUSTOMERS) await kontaktAnlegen(page, kunde);
  // „Rechnung per E-Mail“ verschickt die erste festgeschriebene Rechnung der Liste
  await rechnungFestschreiben(page, INVOICES[0]!);
});

test("Grundstücksleistung: fester Aufbewahrungshinweis, Entwurf speichern und erneut laden (#718)", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Terrassenrenovierung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("1200");
  const haken = page.getByRole("checkbox", { name: "Leistung an einem Grundstück für einen Privatkunden (§ 14 Abs. 4 Nr. 9 UStG)" });
  const vorschau = page.getByLabel("Vorschau der Rechnung");
  await expect(haken).not.toBeChecked();
  await expect(vorschau).not.toContainText("zwei Jahre aufzubewahren");
  await haken.focus();
  await page.keyboard.press("Space");
  await expect(haken).toBeChecked();
  await expect(vorschau).toContainText("zwei Jahre aufzubewahren");
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await expect(page).toHaveURL(/\/rechnungen\/[0-9a-f-]{36}$/);
  await page.reload({ waitUntil: "networkidle" });
  await expect(haken).toBeChecked();
  await haken.uncheck();
  await expect(vorschau).not.toContainText("zwei Jahre aufzubewahren");
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Entwurf gespeichert." })).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(haken).not.toBeChecked();
  await page.getByRole("button", { name: "Entwurf löschen", exact: true }).click();
  await bestaetigen(page, "Entwurf löschen");
  await expect(page).toHaveURL(/\/rechnungen(?:\?.*)?$/);

  await go("/rechnungen/wiederkehrend/neu");
  await expect(haken).not.toBeChecked();
  await haken.check();
  await expect(haken).toBeChecked();
  await expect(haken).toHaveAccessibleDescription(/zweijährigen Aufbewahrung/);
  await go("/angebote/neu");
  await expect(haken).toHaveCount(0);
});

test("Abschlag: Anzahlung ist Vorgabe, erbrachte Teilleistung braucht ein Leistungsdatum (#622)", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Rechnungsart", { exact: true }).selectOption("abschlag");
  const erbracht = page.getByRole("checkbox", { name: "Teilleistung bereits erbracht" });
  await expect(erbracht).not.toBeChecked();
  await expect(
    page.getByText("Umsatzsteuer entsteht bei Zahlungseingang; bei Soll-Versteuerung spätestens mit der Schlussleistung.", { exact: true }),
  ).toBeVisible();
  await erbracht.check();
  await expect(page.getByLabel("Leistung von", { exact: true })).toHaveAttribute("required", "");
  await expect(page.getByText("Bei Soll-Versteuerung entsteht die Umsatzsteuer mit der Teilleistung.", { exact: true })).toBeVisible();
  await erbracht.uncheck();
  await expect(page.getByLabel("Leistung von", { exact: true })).not.toHaveAttribute("required");
  for (const treatment of ["reverse_charge", "ig_lieferung", "drittland"]) {
    await page.getByLabel("Umsatzsteuer", { exact: true }).selectOption(treatment);
    await expect(erbracht).toHaveAccessibleDescription(
      "Für diese Steuerbehandlung gelten die bisherigen Meldezeitpunkte; die Zahlungsregel für inländische Anzahlungen gilt hier nicht.",
    );
  }
  for (const treatment of ["ausfuhr", "steuerfrei"]) {
    await page.getByLabel("Umsatzsteuer", { exact: true }).selectOption(treatment);
    await expect(erbracht).toHaveAccessibleDescription(
      "Steuerfreie Anzahlung ohne Umsatzsteuerausweis. Der Meldezeitpunkt richtet sich nach Zahlung und Schlussleistung.",
    );
  }
  await page.getByLabel("Umsatzsteuer", { exact: true }).selectOption("regulaer");
});

test("Kontaktseite: Rechnungen des Kunden mit Summe je Jahr (#587)", async () => {
  const jahr = INVOICES[0]!.date.slice(0, 4);
  await go("/kontakte");
  await go((await page.getByRole("link", { name: "Nordwerk Software GmbH" }).first().getAttribute("href"))!);
  const rechnungen = page.getByRole("region", { name: "Umsatz und Rechnungen", exact: true });
  const jahre = rechnungen.getByRole("group", { name: "Umsatz je Jahr", exact: true });
  // 96 Stunden zu 95,00 € netto
  await expect(jahre.getByRole("link", { name: new RegExp(`^${jahr}`) })).toContainText("9.120,00 €");
  await expect(jahre.getByRole("link", { name: new RegExp(`^${jahr}`) })).toContainText(`${INVOICES[0]!.gross} €`);
  await expect(jahre.getByRole("link", { name: new RegExp(`^${jahr}`) })).toHaveAttribute("aria-current", "page");
  const liste = rechnungen.getByRole("group", { name: `Rechnungen ${jahr}`, exact: true });
  await expect(liste.getByRole("link")).toHaveCount(1);
  await expect(liste.getByRole("link")).toContainText("Rechnung");
  // Kunde ohne Lieferantenrolle und ohne Belege: kein Abschnitt dafür
  await expect(page.getByRole("region", { name: "Ausgaben und Belege", exact: true })).toHaveCount(0);
  await liste.getByRole("link").click();
  await page.waitForURL(/\/rechnungen\/[0-9a-f-]{36}$/);
});

test("DATEV-Personenkonten: Schalter mit Bestätigung, fehlender Debitor wird vergeben, steht im Stapel und ist danach fest (#327)", async () => {
  const jahr = Number(INVOICES[0]!.date.slice(0, 4));
  await go("/einstellungen?bereich=export");
  const card = page.getByRole("form", { name: "DATEV-Export" });
  await card.getByLabel("Beraternummer").fill("29098");
  await card.getByLabel("Mandantennummer").fill("55003");
  await card.getByLabel("DATEV-Personenkonten").selectOption(String(jahr));
  // Das Jahr hat schon eine Rechnung: nur mit ausdrücklicher Bestätigung
  const bestaetigung = card.getByRole("checkbox", { name: /hat schon Buchungen/ });
  await expect(bestaetigung).toBeVisible();
  await bestaetigung.check();
  await card.getByRole("button", { name: "Speichern" }).click();
  await expect(card.getByRole("status")).toHaveText("Gespeichert.");
  await expect(bestaetigung).toBeHidden();

  // Nordwerk hat noch keinen Debitor: Der Export vergibt den ersten freien
  await card.getByRole("combobox", { name: "Jahr", exact: true }).selectOption(String(jahr));
  const download = page.waitForEvent("download");
  await card.getByRole("link", { name: "Buchungsstapel herunterladen" }).click();
  const datei = await download;
  expect(datei.suggestedFilename()).toBe(`EXTF_Buchungsstapel_${jahr}.csv`);
  const { readFile } = await import("node:fs/promises");
  const stapel = new TextDecoder("latin1").decode(await readFile((await datei.path())!));
  expect(stapel).toContain(";10000;8400;");
  expect(stapel).not.toContain(";1400;");

  // Am Kontakt steht die Nummer und ist ab dem ersten Export fest
  await go("/kontakte");
  await go((await page.getByRole("link", { name: "Nordwerk Software GmbH" }).first().getAttribute("href"))!);
  await expect(page.getByLabel("DATEV-Debitor")).toHaveValue("10000");
  await page.getByLabel("DATEV-Debitor").fill("10002");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("alert")).toContainText("Debitor 10000 steht schon in einem DATEV-Export und bleibt fest.");
});

test("DATEV-Personenkonten: die Steuerberatung liest auf ihrer Startseite, warum ein neuer Debitor den Stapel ablehnt (#452)", async ({ browser }) => {
  const jahr = Number(INVOICES[1]!.date.slice(0, 4));
  await go("/kontakte");
  await go((await page.getByRole("link", { name: "Alpenblick Media AG" }).first().getAttribute("href"))!);
  await page.getByLabel("DATEV-Debitor").fill("10002");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
  await rechnungFestschreiben(page, INVOICES[1]!);

  // Zugang für die Steuerberatung wie in steuerberatung.spec.ts
  await go("/einstellungen?bereich=sicherheit");
  await page.getByLabel("Bezeichnung").fill("Kanzlei Personenkonten");
  await page.getByRole("button", { name: "Einladungslink erzeugen" }).click();
  const link = page.getByRole("textbox", { name: /Einladungslink für/ });
  await expect(link).toHaveValue(/\/einladung\//);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const stb = await context.newPage();
  await stb.goto(await link.inputValue());
  await stb.getByLabel("Name").fill("Kanzlei Personenkonten");
  await stb.getByLabel("E-Mail").fill("personenkonten@example.com");
  await stb.getByLabel("Passwort (mindestens 12 Zeichen)").fill("kanzlei-passwort-e2e");
  await stb.getByRole("button", { name: "Zugang anlegen" }).click();
  await stb.getByRole("button", { name: "Später" }).click();
  await stb.waitForURL(/\/steuerberatung$/);

  // Debitor 10002 ist noch nicht festgeschrieben: Der Export lehnt ab, und die Steuerberatung liest den Grund
  await stb.getByLabel("Jahr").selectOption(String(jahr));
  await stb.getByRole("link", { name: "DATEV-Buchungsstapel" }).click();
  await expect(stb.getByRole("alert")).toContainText("Der erste Export mit neuen Personenkonten muss vom Inhaber kommen");
  await expect(stb.getByRole("alert")).toContainText("Debitor 10002 (Alpenblick Media AG)");
  await context.close();
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
  await kundeWaehlen(page, "Harbour Labs Ltd · London");
  await expect(sprache).toHaveValue("en");
  // Die Vorschau zeigt das englische Blatt, nicht mehr nur den Aufbau
  await expect(page.getByLabel("Vorschau der Rechnung")).toContainText("Invoice");
});

test("Kontakt bearbeiten: Die Meldung „Gespeichert.“ bleibt nach dem Speichern stehen", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Speicher Testkunde GmbH");
  await page.getByLabel("Ort").fill("Bremen");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  await page.getByLabel("Ort").fill("Hamburg");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  // Nach dem Speichern lädt die Seite die neue Version und baut das Formular neu auf; die Meldung darf dabei nicht verschwinden
  await expect(page.getByText("Version 2")).toBeVisible();
  const meldung = page.getByRole("form", { name: "Kontakt" }).getByText("Gespeichert. Die vorige Fassung bleibt als Version erhalten.");
  await expect(meldung).toBeVisible();
  await expect(page.getByLabel("Ort")).toHaveValue("Hamburg");
  // Auch nach kurzer Zeit noch da, nicht nur für einen Augenblick
  await page.waitForTimeout(1000);
  await expect(meldung).toBeVisible();
  // Archivieren: Die folgenden Tests rechnen nicht mit diesem Kunden
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Kontakt mit beiden Rollen trägt DATEV-Debitor und -Kreditor, eine vergebene Nummer meldet das Formular (#327)", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Musterpartner GmbH");
  await page.getByLabel("Lieferant", { exact: true }).check();
  await page.getByLabel("Kundennummer").fill("K-42");
  await page.getByLabel("DATEV-Debitor").fill("10042");
  await page.getByLabel("DATEV-Kreditor").fill("70087");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  await expect(page.getByLabel("Kundennummer")).toHaveValue("K-42");
  await expect(page.getByLabel("DATEV-Debitor")).toHaveValue("10042");
  await expect(page.getByLabel("DATEV-Kreditor")).toHaveValue("70087");
  // Archivieren: Die folgenden Tests rechnen nicht mit einem Lieferanten
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();

  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Zweiter Partner");
  await page.getByLabel("DATEV-Debitor").fill("70087");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByText("Debitor: 10000 bis 69999 (fünfstellig, nach DATEV-Kontenrahmen)")).toBeVisible();
  await page.getByLabel("DATEV-Debitor").fill("10042");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByText("Debitor 10042 hat schon „Musterpartner GmbH“.")).toBeVisible();
});

test("Kunden im Rechnungsentwurf anlegen, ohne die Eingaben zu verlieren (#330)", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Beschreibung Position 1").fill("Workshop Barrierefreiheit");
  const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
  await neuenKontaktOeffnen(page);
  await expect(dialog).toBeVisible();
  await randImDialog(dialog, [dialog.getByLabel("Name oder Firma"), dialog.getByRole("button", { name: "Kontakt anlegen" })]);
  await expect(dialog.getByLabel("Kunde", { exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Lieferant", { exact: true })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Workshop Barrierefreiheit");

  await neuenKontaktOeffnen(page);
  await dialog.getByLabel("Name oder Firma").fill("Dialogkunde GmbH");
  await dialog.getByLabel("Ort").fill("Bremen");
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Kunde", exact: true })).toHaveValue("Dialogkunde GmbH · Bremen");
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Workshop Barrierefreiheit");

  // Nicht speichern; den Kunden archivieren, damit die folgenden Tests mit den bisherigen Kunden rechnen
  await go("/kontakte");
  await page.getByRole("link", { name: /Dialogkunde GmbH/ }).click();
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Wiederkehrende Rechnung: Kunde suchen, ohne Kunde nicht speicherbar, neuen Kunden direkt anlegen", async () => {
  await go("/rechnungen/wiederkehrend/neu");
  await page.getByLabel("Bezeichnung").fill("Wartungsvertrag Test");
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  // Pflichtfeld: Ohne gewählten Kunden meldet der Browser das Feld und speichert nichts
  expect(await kunde.evaluate((feld: HTMLInputElement) => feld.validity.valueMissing)).toBe(true);
  await expect(page.getByRole("button", { name: "Vorlage anlegen" })).toBeDisabled();

  // Suche nach Name; nur Kunden stehen zur Auswahl
  await kunde.fill("Nordwerk");
  await trefferliste(page)
    .getByRole("option", { name: /Nordwerk Software GmbH/ })
    .click();
  await expect(kunde).toHaveValue("Nordwerk Software GmbH · Hamburg");
  expect(await kunde.evaluate((feld: HTMLInputElement) => feld.validity.valueMissing)).toBe(false);

  // Neuer Kunde mit dem getippten Namen, die Eingaben der Vorlage bleiben
  await kunde.fill("Vorlagenkunde GmbH");
  await trefferliste(page).getByRole("option", { name: "„Vorlagenkunde GmbH“ als neuen Kunden anlegen" }).click();
  const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
  await expect(dialog.getByLabel("Name oder Firma")).toHaveValue("Vorlagenkunde GmbH");
  await expect(dialog.getByLabel("Kunde", { exact: true })).toBeChecked();
  await dialog.getByLabel("Ort").fill("Bremen");
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toBeHidden();
  await expect(kunde).toHaveValue("Vorlagenkunde GmbH · Bremen");
  await expect(page.getByLabel("Bezeichnung")).toHaveValue("Wartungsvertrag Test");
  await expect(page).toHaveURL(/\/wiederkehrend\/neu$/);

  // Nicht speichern; den Kunden archivieren, damit die folgenden Tests mit den bisherigen Kunden rechnen
  await go("/kontakte");
  await page.getByRole("link", { name: /Vorlagenkunde GmbH/ }).click();
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
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
  await artikelEinfuegen(page, "Beratung Softwarearchitektur");
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Beratung Softwarearchitektur");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("110,00");
  await expect(page.getByLabel("Beschreibung Position 2")).toHaveCount(0);
  // Die Artikelnummer geht in die Position über (BT-155, #388)
  await expect(page.getByLabel("Artikelnummer Position 1 (optional)")).toHaveValue("B-01");
  // Bereits im Katalog: nicht noch einmal speichern
  await expect(page.getByRole("button", { name: "Position 1 als Artikel speichern" })).toBeDisabled();

  // Auswahl aus der Trefferliste der Position: die Bezeichnung übernimmt Einheit und Preis
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await artikelInPosition(page, 2, "Beratung Softwarearchitektur");
  await expect(page.getByLabel(/Einzelpreis Position 2/)).toHaveValue("110,00");
  await expect(page.getByLabel("Artikelnummer Position 2 (optional)")).toHaveValue("B-01");

  // Eine neue Position als Artikel speichern; danach steht sie im Katalog
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 3").fill("Wartungspauschale");
  await page.getByLabel(/Einzelpreis Position 3/).fill("250,00");
  await page.getByRole("button", { name: "Position 3 als Artikel speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "„Wartungspauschale“ ist jetzt im Artikelkatalog." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Position 3 als Artikel speichern" })).toBeDisabled();
  await page.getByLabel("Aus dem Artikelkatalog einfügen").fill("Wartungspauschale");
  await expect(trefferliste(page).getByRole("option", { name: "Wartungspauschale" })).toContainText("250,00");
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
  await artikelEinfuegen(page, "Website-Relaunch");
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Website-Relaunch");
  await expect(page.getByLabel("Text zu Position 1 (optional)")).toHaveValue("Konzeption, Design und Umsetzung");
  await expect(page.getByRole("button", { name: "Position 1 als Artikel speichern" })).toBeDisabled();

  // Auswahl in der Bezeichnung: ebenso, dazu Preis und Einheit
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await artikelInPosition(page, 2, "Website-Relaunch");
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
  await artikelEinfuegen(page, "Wartungsvertrag");
  await expect(page.getByLabel("Text zu Position 2 (optional)")).toHaveValue(leistungsumfang);
});

test("Positionstext: ein einzeiliger Artikel lässt bei der Auswahl den eigenen Text der Position stehen", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Text zu Position 1 (optional)").fill("laut Bestellung 4500123456");
  await artikelInPosition(page, 1, "Beratung Softwarearchitektur");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("110,00");
  await expect(page.getByLabel("Text zu Position 1 (optional)")).toHaveValue("laut Bestellung 4500123456");
});

test("Textbausteine: Kopftext für einen Kunden anlegen und im Rechnungseditor einfügen", async () => {
  await go("/textbausteine");
  await page.getByRole("button", { name: "Neuer Textbaustein" }).click();
  const form = page.getByRole("form", { name: "Neuer Textbaustein" });
  await form.getByLabel("Bezeichnung").fill("Bestellnummer Nordwerk");
  await form.getByRole("textbox", { name: "Text", exact: true }).fill("Bestellnummer 4500012345 laut Rahmenvertrag 2026.");
  // Leeres Feld heißt „für alle Kunden“; erst die Wahl macht den Baustein zum Baustein dieses Kunden
  const kundenfeld = form.getByRole("combobox", { name: "Kunde (optional)" });
  await expect(kundenfeld).toHaveAttribute("placeholder", "Für alle Kunden");
  await expect(kundenfeld).toHaveValue("");
  await kundenfeld.fill("Nordwerk");
  await trefferliste(page)
    .getByRole("option", { name: /Nordwerk Software GmbH/ })
    .click();
  await kundenfeld.fill("");
  await kundenfeld.blur();
  await expect(kundenfeld).toHaveValue("");
  await kundenfeld.fill("Nordwerk");
  await trefferliste(page)
    .getByRole("option", { name: /Nordwerk Software GmbH/ })
    .click();
  await expect(form.getByRole("combobox", { name: "Kunde (optional)" })).toHaveValue("Nordwerk Software GmbH · Hamburg");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("region", { name: "Textbausteine" })).toContainText("Bestellnummer Nordwerk");

  // Für diesen Kunden steht der Baustein oben; eingefügt wird eine Kopie in die Einleitung, gespeichert wird nichts
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Nordwerk Software GmbH · Hamburg");
  const insert = page.getByLabel("Kopftext aus den Textbausteinen einfügen");
  await expect(insert.locator('optgroup[label="Für diesen Kunden"] option')).toHaveText(["Bestellnummer Nordwerk"]);
  await insert.selectOption({ label: "Bestellnummer Nordwerk" });
  await expect(page.getByLabel("Einleitung über den Positionen (optional)")).toHaveValue("Bestellnummer 4500012345 laut Rahmenvertrag 2026.");
  await expect(insert).toHaveValue("");
});

test("Textknöpfe: Auswahl per Knopf und Kürzel auszeichnen, Strg+Z nimmt es zurück, Leiste an der Markierung", async () => {
  await go("/rechnungen/neu");
  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  const fett = page.getByRole("button", { name: "Fett", exact: true });
  await expect(fett).toBeHidden();

  await einleitung.fill("Vielen Dank für Ihren Auftrag");
  await einleitung.focus();
  // Ohne Markierung keine Leiste, auch nicht im Feld
  await expect(fett).toBeHidden();
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(17, 20));
  await expect(fett).toBeVisible();
  await fett.click();
  await expect(einleitung).toHaveValue("Vielen Dank für *Ihren* Auftrag");
  await expect(einleitung).toBeFocused();
  await expect(page.locator(".sheet")).toContainText("Vielen Dank für Ihren Auftrag");

  await page.keyboard.press("ControlOrMeta+i");
  await expect(einleitung).toHaveValue("Vielen Dank für *_Ihren_* Auftrag");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(einleitung).toHaveValue("Vielen Dank für *Ihren* Auftrag");
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(17, 22));
  await fett.click();
  await expect(einleitung).toHaveValue("Vielen Dank für Ihren Auftrag");

  const verstoesse = await new AxeBuilder({ page }).include(".format-field:focus-within").analyze();
  expect(verstoesse.violations).toEqual([]);

  // Per Tastatur: ein Tabstopp für die Leiste, darin die Pfeiltasten
  const detail = page.getByLabel("Text zu Position 1 (optional)");
  await detail.fill("Wartung");
  await detail.focus();
  await detail.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(0, 7));
  await expect(fett).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(fett).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Kursiv", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(detail).toHaveValue("_Wartung_");
  await expect(detail).toBeFocused();
});

test("Textknöpfe: Leiste folgt der Markierung und schließt mit Esc", async () => {
  await go("/rechnungen/neu");
  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  const leiste = page.getByRole("toolbar", { name: "Textformatierung" });
  await einleitung.fill("Erstes Wort weit vorn und ein ganz anderes am Ende der Zeile");
  await einleitung.focus();
  const markiere = (start: number, end: number) => einleitung.evaluate((feld: HTMLTextAreaElement, [a, b]) => feld.setSelectionRange(a!, b!), [start, end]);

  await markiere(0, 6);
  await expect(leiste).toBeVisible();
  const links = (await leiste.boundingBox())!;
  const feld = (await einleitung.boundingBox())!;
  // Über der ersten Zeile, also oberhalb des Felds
  expect(links.y + links.height).toBeLessThanOrEqual(feld.y + 12);

  await markiere(50, 55);
  await expect.poll(async () => (await leiste.boundingBox())!.x).toBeGreaterThan(links.x + 100);

  await page.keyboard.press("Escape");
  await expect(leiste).toBeHidden();
  await markiere(0, 6);
  await expect(leiste).toBeVisible();
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(3, 3));
  await expect(leiste).toBeHidden();
});

test("Textknöpfe: Doppelklick am rechten Rand markiert das Wort, das dort stand, bevor das Feld den Fokus hatte", async () => {
  await go("/rechnungen/neu");
  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  const woerter = Array.from({ length: 20 }, (_, i) => `wort${String(i).padStart(2, "0")}`);
  await einleitung.fill(woerter.join(" "));
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.blur());
  await einleitung.scrollIntoViewIfNeeded();

  // Wo das letzte Wort der ersten Zeile steht, solange das Feld keinen Fokus hat
  const ziel = await einleitung.evaluate((feld: HTMLTextAreaElement, liste: string[]) => {
    const stil = getComputedStyle(feld);
    const messen = document.createElement("canvas").getContext("2d")!;
    messen.font = stil.font;
    const links = parseFloat(stil.paddingLeft);
    const breite = feld.clientWidth - links - parseFloat(stil.paddingRight);
    let anzahl = 1;
    while (messen.measureText(liste.slice(0, anzahl + 1).join(" ")).width <= breite) anzahl++;
    const davor = messen.measureText(`${liste.slice(0, anzahl - 1).join(" ")} `).width;
    const box = feld.getBoundingClientRect();
    return {
      wort: liste[anzahl - 1]!,
      x: box.left + feld.clientLeft + links + davor + messen.measureText(liste[anzahl - 1]!).width / 2,
      y: box.top + feld.clientTop + parseFloat(stil.paddingTop) + parseFloat(stil.fontSize) / 2,
    };
  }, woerter);

  await page.mouse.dblclick(ziel.x, ziel.y);
  const markiert = await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.value.slice(feld.selectionStart, feld.selectionEnd).trim());
  expect(markiert).toBe(ziel.wort);
  await einleitung.fill("");
});

test("Wiederkehrende Rechnung: die Vorschau zeigt die Auszeichnung statt der Zeichen", async () => {
  await go("/rechnungen/wiederkehrend/neu");
  await page.getByLabel("Beschreibung Position 1").fill("Hosting");
  const text = page.getByLabel("Text zu Position 1 (optional)");
  await text.fill("Wartung");
  await text.focus();
  await text.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(0, 7));
  await page.getByRole("button", { name: "Fett", exact: true }).click();
  await expect(text).toHaveValue("*Wartung*");

  const vorschau = page.getByRole("region", { name: "Vorschau" });
  await expect(vorschau).toContainText("Wartung");
  await expect(vorschau).not.toContainText("*Wartung*");
});

test("Textknöpfe: Esc auf einem Knopf schließt die Leiste und führt zurück ins Feld", async () => {
  await go("/rechnungen/neu");
  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  const leiste = page.getByRole("toolbar", { name: "Textformatierung" });
  await einleitung.fill("Vielen Dank für Ihren Auftrag");
  await einleitung.focus();
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(17, 20));
  await expect(leiste).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Fett", exact: true })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(einleitung).toBeFocused();
  await expect(leiste).toBeHidden();
  await einleitung.fill("");
});

test("Textknöpfe: am ersten Wort einer umbrochenen Zeile steht die Leiste über dem Wort, nicht am Ende der Zeile davor", async () => {
  await go("/rechnungen/neu");
  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  const leiste = page.getByRole("toolbar", { name: "Textformatierung" });
  const woerter = Array.from({ length: 40 }, (_, i) => `wort${String(i).padStart(2, "0")}`);
  await einleitung.fill(woerter.join(" "));
  await einleitung.focus();

  // Wie viele Wörter in die erste Zeile passen; das nächste beginnt die zweite Zeile
  const start = await einleitung.evaluate((feld: HTMLTextAreaElement, liste: string[]) => {
    const stil = getComputedStyle(feld);
    const messen = document.createElement("canvas").getContext("2d")!;
    messen.font = stil.font;
    const breite = feld.clientWidth - parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight);
    let anzahl = 1;
    while (messen.measureText(liste.slice(0, anzahl + 1).join(" ")).width <= breite) anzahl++;
    return liste.slice(0, anzahl).join(" ").length + 1;
  }, woerter);
  await einleitung.evaluate((feld: HTMLTextAreaElement, von: number) => feld.setSelectionRange(von, von + 6), start);

  await expect(leiste).toBeVisible();
  const box = (await leiste.boundingBox())!;
  const feld = (await einleitung.boundingBox())!;
  expect(box.x - feld.x).toBeLessThan(40);
  await einleitung.fill("");
});

test("Textknöpfe: ein Klick zwischen die Knöpfe lässt Leiste und Markierung stehen", async () => {
  await go("/rechnungen/neu");
  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  const leiste = page.getByRole("toolbar", { name: "Textformatierung" });
  await einleitung.fill("Vielen Dank für Ihren Auftrag");
  await einleitung.focus();
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(17, 20));
  await expect(leiste).toBeVisible();

  const fett = (await page.getByRole("button", { name: "Fett", exact: true }).boundingBox())!;
  await page.mouse.click(fett.x + fett.width + 1, fett.y + fett.height / 2);

  await expect(einleitung).toBeFocused();
  await expect(leiste).toBeVisible();
  await einleitung.fill("");
});

test("Artikel und Textbausteine: die Liste zeigt die Auszeichnung statt der Zeichen", async () => {
  await go("/artikel");
  await page.getByRole("button", { name: "Neuer Artikel" }).click();
  const artikel = page.getByRole("form", { name: "Neuer Artikel" });
  await artikel.getByLabel("Bezeichnung").fill("Wartung mit Auszeichnung");
  await artikel.getByLabel("Text zur Position (optional)").fill("Monatliche Wartung");
  await artikel.getByLabel("Text zur Position (optional)").evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(0, 10));
  await artikel.getByLabel("Text zur Position (optional)").focus();
  await artikel.getByRole("button", { name: "Fett", exact: true }).click();
  await expect(artikel.getByLabel("Text zur Position (optional)")).toHaveValue("*Monatliche* Wartung");
  await artikel.getByLabel("Preis (€)").fill("10,00");
  await artikel.getByRole("button", { name: "Anlegen" }).click();
  const zeile = page.locator(".table-row").filter({ hasText: "Wartung mit Auszeichnung" });
  await expect(zeile.locator("strong").filter({ hasText: "Monatliche" })).toBeVisible();
  await expect(zeile).not.toContainText("*Monatliche*");

  await go("/textbausteine");
  await page.getByRole("button", { name: "Neuer Textbaustein" }).click();
  const baustein = page.getByRole("form", { name: "Neuer Textbaustein" });
  await baustein.getByLabel("Bezeichnung").fill("Baustein mit Auszeichnung");
  await baustein.getByRole("textbox", { name: "Text", exact: true }).fill("Bitte *sofort* zahlen");
  await baustein.getByRole("button", { name: "Anlegen" }).click();
  const liste = page.getByRole("region", { name: "Textbausteine" });
  await expect(liste.locator("strong").filter({ hasText: "sofort" })).toBeVisible();
  await expect(liste).not.toContainText("*sofort*");
});

/** Ob der Knopf in der Mitte wirklich oben liegt; verdeckt oder abgeschnitten bliebe er für Maus und Finger unerreichbar */
function liegtObenAuf(p: Page): Promise<boolean> {
  return p.getByRole("button", { name: "Fett", exact: true }).evaluate((knopf) => {
    const rect = knopf.getBoundingClientRect();
    return !!document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('[role="toolbar"]');
  });
}

test("Textknöpfe: auf dem Handy liegt die Leiste auch bei einem hochgescrollten Feld nicht hinter der Navigation", async ({ browser }) => {
  // Mit offener Tastatur bleibt auf dem Handy nur rund die halbe Höhe
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: HANDY.width, height: 420 },
    hasTouch: true,
    isMobile: true,
  });
  const handy = await context.newPage();
  await gehe(handy, "/textbausteine");
  await handy.getByRole("button", { name: "Neuer Textbaustein" }).click();
  const text = handy.getByRole("form", { name: "Neuer Textbaustein" }).getByLabel("Text", { exact: true });
  await text.fill(["eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "Wartung"].join("\n"));
  const zeileZuSehen = await text.evaluate((feld: HTMLTextAreaElement) => {
    // Das Feld steht oben unter der Navigation, sein unteres Ende ist noch zu sehen und wird markiert
    window.scrollBy(0, feld.getBoundingClientRect().top - 40);
    feld.focus({ preventScroll: true });
    feld.setSelectionRange(feld.value.length - 7, feld.value.length);
    feld.scrollTop = feld.scrollHeight;
    const rect = feld.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.bottom - 8) === feld;
  });
  expect(zeileZuSehen, "die markierte Zeile ist nicht verdeckt").toBe(true);
  await expect(handy.getByRole("toolbar", { name: "Textformatierung" })).toBeVisible();
  expect(await liegtObenAuf(handy)).toBe(true);
  await context.close();
});

test("Textknöpfe: im gescrollten Artikel-Dialog schneidet der Rand die Leiste nicht ab, Esc auf einem Knopf lässt den Dialog offen", async () => {
  await go("/rechnungen/neu");
  const beschreibung = page.getByLabel("Beschreibung Position 1");
  await beschreibung.fill("Lektorat im Dialog");
  await trefferliste(page).getByRole("option", { name: "„Lektorat im Dialog“ als neuen Artikel anlegen" }).click();
  const dialog = page.getByRole("dialog", { name: "Neuen Artikel anlegen" });
  const text = dialog.getByLabel("Text zur Position (optional)");
  await text.fill("Wartung");
  // Niedriges Fenster, etwa ein Handy quer oder mit offener Tastatur: Das Formular im Dialog scrollt
  await page.setViewportSize({ width: 1280, height: 460 });
  try {
    await text.evaluate((feld: HTMLTextAreaElement) => {
      const form = feld.closest("form")!;
      form.scrollTop += feld.getBoundingClientRect().top - form.getBoundingClientRect().top;
      feld.focus({ preventScroll: true });
      feld.setSelectionRange(0, 7);
    });
    const leiste = dialog.getByRole("toolbar", { name: "Textformatierung" });
    await expect(leiste).toBeVisible();
    expect(await liegtObenAuf(page)).toBe(true);

    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Fett", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(leiste).toBeHidden();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
  }
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

test("Absenderzeile: in der Vorschau von Rechnung und Angebot ganz zu sehen, lang umbrochen statt abgeschnitten (#518)", async () => {
  const firma = page.getByRole("form", { name: "Firmendaten" });
  const firmendaten = async (name: string, strasse: string, plz: string, ort: string) => {
    await go("/einstellungen");
    await firma.getByLabel("Name", { exact: true }).fill(name);
    await firma.getByLabel("Straße und Hausnummer").fill(strasse);
    await firma.getByLabel("PLZ").fill(plz);
    await firma.getByLabel("Ort").fill(ort);
    await firma.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
    await page.waitForLoadState("networkidle");
  };
  // Beispiel aus dem Issue, 81 Zeichen: im PDF bricht die Zeile im 85 mm breiten Anschriftfeld um
  const zeile = "Muster Consulting, Inh. Max Mustermann · Musterweg 8 · 09999 Musterhausen-Neudorf";
  await firmendaten("Muster Consulting, Inh. Max Mustermann", "Musterweg 8", "09999", "Musterhausen-Neudorf");
  try {
    for (const [pfad, vorschau] of [
      ["/rechnungen/neu", "Vorschau der Rechnung"],
      ["/angebote/neu", "Vorschau des Angebots"],
    ] as const) {
      await go(pfad);
      // Der Umbruch im 85 mm breiten Feld kommt jetzt aus derselben Vorlage wie das PDF
      await expect(page.getByLabel(vorschau)).toContainText(zeile);
    }
  } finally {
    await firmendaten("Mustermann IT · Max Mustermann", "Musterstraße 12", "93047", "Regensburg");
  }
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
  await artikelEinfuegen(page, "Fotoabzug 13 × 18 cm");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("8,24");

  // Brutto-Rechnung: der Endpreis bleibt, die Steuer steht unter dem Gesamtbetrag
  await page.getByLabel(/^Preise/).selectOption("brutto");
  await page.getByLabel(/Einzelpreis Position 1/).fill("9,80");
  const preview = page.getByLabel("Vorschau der Rechnung");
  await expect(preview).toContainText("Gesamtbetrag (inkl. USt): 9,80\u00a0€");
  await expect(preview).toContainText("darin enthalten");
  await expect(preview).toContainText("Umsatzsteuer 19 %: 1,56\u00a0€");
  await artikelEinfuegen(page, "Fotoabzug 13 × 18 cm");
  await expect(page.getByLabel(/Einzelpreis Position 2/)).toHaveValue("9,80");
});

test("Kunde suchen und mit Tastatur oder Maus wählen (#359)", async () => {
  await go("/rechnungen/neu");
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  const treffer = trefferliste(page);

  // Suche nach dem Ort, Name und Ort stehen im Treffer
  await kunde.fill("hamburg");
  await expect(kunde).toHaveAttribute("aria-expanded", "true");
  await expect(treffer.getByRole("option", { name: "Nordwerk Software GmbH" })).toContainText("Hamburg");

  // Enter übernimmt den ersten Treffer und schickt das Formular nicht ab
  await kunde.fill("rhein");
  await page.keyboard.press("Enter");
  await expect(kunde).toHaveValue("Rheinpixel GmbH · Köln");
  await expect(kunde).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/rechnungen\/neu/);
  await expect(page.locator(".sheet").getByText("Rheinpixel GmbH")).toBeVisible();

  // Pfeile bewegen den aktiven Eintrag, der Fokus bleibt im Feld
  await kunde.fill("gmbh");
  const ersterAktiv = await kunde.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  await expect(kunde).not.toHaveAttribute("aria-activedescendant", ersterAktiv!);
  await expect(kunde).toBeFocused();

  // Escape schließt; ohne Auswahl bleibt der bisherige Kunde
  await page.keyboard.press("Escape");
  await expect(kunde).toHaveAttribute("aria-expanded", "false");
  await page.getByLabel("Beschreibung Position 1").click();
  await expect(kunde).toHaveValue("Rheinpixel GmbH · Köln");

  // Klick zeigt die Liste mit dem gewählten Kunden, die Maus wählt einen anderen
  await kunde.click();
  await expect(treffer.getByRole("option", { selected: true })).toContainText("Rheinpixel GmbH");
  await treffer.getByRole("option", { name: "Alpenblick Media AG" }).click();
  await expect(kunde).toHaveValue("Alpenblick Media AG · München");

  // Tab übernimmt den aktiven Treffer
  await kunde.fill("nordwerk");
  await page.keyboard.press("Tab");
  await expect(kunde).toHaveValue("Nordwerk Software GmbH · Hamburg");

  // Ein geleertes Feld nimmt den Kunden weg
  await kunde.fill("");
  await page.getByLabel("Beschreibung Position 1").click();
  await expect(kunde).toHaveValue("");
  await expect(page.locator(".sheet").getByText("Nordwerk Software GmbH")).toHaveCount(0);
});

test("Suchfeld: Klick neben den Feldnamen und Mausbewegung stören nicht (#359)", async () => {
  await go("/rechnungen/neu");
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  const feldname = page.locator(".field-label", { hasText: /^Kunde$/ });

  // Der leere Bereich rechts vom Feldnamen gehört nicht zum Feld
  await kunde.scrollIntoViewIfNeeded();
  const feld = (await kunde.boundingBox())!;
  const name = (await feldname.boundingBox())!;
  const punkt = { x: feld.x + feld.width - 20, y: name.y + name.height / 2 };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, punkt)).toBe("field");
  await page.mouse.click(punkt.x, punkt.y);
  await expect(kunde).not.toBeFocused();
  await expect(kunde).toHaveAttribute("aria-expanded", "false");

  // Der Feldname selbst fokussiert wie jedes Label, öffnet die Liste aber nicht
  await feldname.click();
  await expect(kunde).toBeFocused();
  await expect(kunde).toHaveAttribute("aria-expanded", "false");

  // Die Maus ändert den aktiven Eintrag der Tastatur nicht, sonst rendert jede Zeile das Feld neu
  await kunde.fill("gmbh");
  const aktiv = await kunde.getAttribute("aria-activedescendant");
  await trefferliste(page).getByRole("option").nth(1).hover();
  await expect(kunde).toHaveAttribute("aria-activedescendant", aktiv!);
  await page.keyboard.press("Escape");
});

test("Kunde aus der Trefferliste neu anlegen, ohne die Eingaben zu verlieren (#359)", async () => {
  await go("/rechnungen/neu");
  // Ohne Eingabe steht das Anlegen am Ende der Liste und öffnet den leeren Dialog, auch neben Treffern
  await page.getByRole("combobox", { name: "Kunde", exact: true }).click();
  await trefferliste(page).getByRole("option", { name: "Neuen Kontakt anlegen" }).click();
  const leer = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
  await expect(leer.getByLabel("Name oder Firma")).toHaveValue("");
  await leer.getByRole("button", { name: "Abbrechen" }).click();
  await expect(leer).toBeHidden();

  // Trotz Teiltreffer: „Rhein“ findet Rheinpixel, das Anlegen bleibt daneben angeboten
  await page.getByRole("combobox", { name: "Kunde", exact: true }).fill("Rhein");
  await expect(trefferliste(page).getByRole("option", { name: "Rheinpixel GmbH" })).toBeVisible();
  await expect(trefferliste(page).getByRole("option", { name: "„Rhein“ als neuen Kunden anlegen" })).toBeVisible();

  await page.getByLabel("Beschreibung Position 1").fill("Workshop Suche");
  await page.getByLabel("Rechnungsdatum").fill(day(-3));
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  await kunde.fill("Kieler Neukunde KG");
  await trefferliste(page).getByRole("option", { name: "„Kieler Neukunde KG“ als neuen Kunden anlegen" }).click();

  const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
  await expect(dialog.getByLabel("Name oder Firma")).toHaveValue("Kieler Neukunde KG");
  await dialog.getByLabel("Ort").fill("Kiel");
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toBeHidden();

  await expect(kunde).toHaveValue("Kieler Neukunde KG · Kiel");
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Workshop Suche");
  await expect(page.getByLabel("Rechnungsdatum")).toHaveValue(day(-3));

  // Nicht speichern; den Kunden archivieren, damit die folgenden Tests mit den bisherigen Kunden rechnen
  await go("/kontakte");
  await page.getByRole("link", { name: /Kieler Neukunde KG/ }).click();
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Artikel in der Position suchen: übernimmt Preis, Einheit und USt, bleibt änderbar, Neuanlage aus der Liste (#359)", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Menge Position 1").fill("3");
  const beschreibung = page.getByLabel("Beschreibung Position 1");

  // Ein Klick zeigt den Katalog wie beim Kunden; vorgewählt ist nichts, denn die Eingabe bleibt frei
  await beschreibung.click();
  await expect(trefferliste(page).getByRole("option", { name: "Beratung Softwarearchitektur" })).toBeVisible();
  await expect(beschreibung).not.toHaveAttribute("aria-activedescendant", /.+/);
  // Das Anlegen steht immer am Ende, auch neben Treffern; ein schon vorhandener Name wird nicht angeboten
  await expect(trefferliste(page).getByRole("option", { name: "Neuen Artikel anlegen" })).toBeVisible();
  await beschreibung.fill("Beratung");
  await expect(trefferliste(page).getByRole("option", { name: "Beratung Softwarearchitektur" })).toBeVisible();
  await expect(trefferliste(page).getByRole("option", { name: "„Beratung“ als neuen Artikel anlegen" })).toBeVisible();
  await beschreibung.fill("beratung softwarearchitektur");
  await expect(trefferliste(page).getByRole("option", { name: "als neuen Artikel anlegen" })).toHaveCount(0);
  await expect(trefferliste(page).getByRole("option", { name: "Neuen Artikel anlegen" })).toBeVisible();
  await beschreibung.fill("");
  await page.keyboard.press("Escape");
  await expect(trefferliste(page)).toBeHidden();

  // Nichts passt: anlegen im Dialog, die Position übernimmt den neuen Artikel
  await beschreibung.fill("Lektorat Fachtext");
  await trefferliste(page).getByRole("option", { name: "„Lektorat Fachtext“ als neuen Artikel anlegen" }).click();
  const dialog = page.getByRole("dialog", { name: "Neuen Artikel anlegen" });
  await expect(dialog.getByLabel("Bezeichnung")).toHaveValue("Lektorat Fachtext");
  await randImDialog(dialog, [dialog.getByLabel("Bezeichnung"), dialog.getByRole("button", { name: "Anlegen" })]);
  await dialog.getByLabel("Artikelnummer (optional)").fill("L-07");
  await dialog.getByLabel("Einheit").selectOption("Stk.");
  await dialog.getByLabel("Preis (€)").fill("45,00");
  await dialog.getByRole("combobox", { name: "Umsatzsteuer", exact: true }).selectOption("700");
  await dialog.getByRole("button", { name: "Anlegen" }).click();
  await expect(dialog).toBeHidden();
  await expect(beschreibung).toHaveValue("Lektorat Fachtext");
  await expect(page.getByLabel("Artikelnummer Position 1 (optional)")).toHaveValue("L-07");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("45,00");
  await expect(page.getByLabel("Einheit Position 1")).toHaveValue("Stk.");
  await expect(page.getByLabel("Steuersatz Position 1")).toHaveValue("700");
  await expect(page.getByLabel("Menge Position 1")).toHaveValue("3");

  // Danach von Hand änderbar
  await page.getByLabel(/Einzelpreis Position 1/).fill("50,00");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("50,00");
  await expect(page.getByLabel("Steuersatz Position 1")).toHaveValue("700");

  // Suche nach der Nummer mit der Tastatur; der Treffer nennt Preis und Einheit
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  const zweite = page.getByLabel("Beschreibung Position 2");
  await zweite.fill("L-07");
  await expect(trefferliste(page).getByRole("option", { name: "Lektorat Fachtext" })).toContainText("45,00\u00a0€ netto je Stk.");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(zweite).toHaveValue("Lektorat Fachtext");
  await expect(page.getByLabel(/Einzelpreis Position 2/)).toHaveValue("45,00");

  // Freier Text bleibt frei, auch wenn er wie ein Artikel heißt: Nur die Auswahl übernimmt Preis und Einheit
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  const dritte = page.getByLabel("Beschreibung Position 3");
  await dritte.fill("Lektorat Fachtext");
  await page.keyboard.press("Escape");
  await expect(dritte).toHaveValue("Lektorat Fachtext");
  await expect(page.getByLabel(/Einzelpreis Position 3/)).toHaveValue("");
});

/** Testkunden direkt in die Datenbank; danach archiviert, damit die folgenden Tests mit den bisherigen Kunden rechnen */
async function mitKunden<T>(kunden: { name: string; ort: string }[], lauf: () => Promise<T>): Promise<T> {
  const sql = postgres(databaseUrlFuer("rechnungen"), { max: 1 });
  try {
    const angelegt = await sql<{ id: string }[]>`insert into contacts ${sql(kunden, "name", "ort")} returning id`;
    try {
      return await lauf();
    } finally {
      await sql`update contacts set archived_at = now() where id in ${sql(angelegt.map((k) => k.id))}`;
    }
  } finally {
    await sql.end();
  }
}

test("Katalogfeld: Klick und Tab fügen keine Position ein (#359)", async () => {
  await go("/rechnungen/neu");
  const katalog = page.getByLabel("Aus dem Artikelkatalog einfügen");
  await katalog.click();
  await expect(trefferliste(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(katalog).not.toBeFocused();
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("");
  await expect(page.getByLabel("Beschreibung Position 2")).toHaveCount(0);
});

test("Katalogfeld: Tab nach dem Tippen fügt keine Position ein, nur beim Kunden übernimmt Tab (#359)", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Beschreibung Position 1").fill("Eigene Leistung");
  await page.keyboard.press("Escape");
  const katalog = page.getByLabel("Aus dem Artikelkatalog einfügen");
  await katalog.fill("Beratung");
  await expect(trefferliste(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(katalog).not.toBeFocused();
  await expect(page.getByLabel("Beschreibung Position 2")).toHaveCount(0);
});

test("Kunde: geleertes Feld und Tab nehmen den Kunden weg (#359)", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  await kunde.fill("");
  await page.keyboard.press("Tab");
  await expect(kunde).not.toBeFocused();
  await expect(kunde).toHaveValue("");
  await expect(page.locator(".sheet").getByText("Rheinpixel GmbH")).toHaveCount(0);
});

test("Kunde: Klick ins leere Feld und Tab wählen niemanden (#359)", async () => {
  await go("/rechnungen/neu");
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  await kunde.click();
  await expect(trefferliste(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(kunde).not.toBeFocused();
  await expect(kunde).toHaveValue("");
});

test("Kunde außerhalb der ersten 50 Treffer: Klick und Tab oder Enter wechseln ihn nicht (#359)", async () => {
  const viele = Array.from({ length: 60 }, (_, i) => ({ name: `Aaa Testkunde ${String(i).padStart(2, "0")}`, ort: "Testdorf" }));
  await mitKunden(viele, async () => {
    await go("/rechnungen/neu");
    await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
    const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
    await kunde.click();
    await expect(trefferliste(page)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(kunde).toHaveValue("Rheinpixel GmbH · Köln");
    await kunde.click();
    await expect(trefferliste(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(kunde).not.toBeFocused();
    await expect(kunde).toHaveValue("Rheinpixel GmbH · Köln");
  });
});

test("Kunde: Der genau getippte Name gewinnt mit Enter gegen den schon gewählten Kunden (#359)", async () => {
  await mitKunden([{ name: "Rhein", ort: "Bonn" }], async () => {
    await go("/rechnungen/neu");
    await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
    const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
    await kunde.fill("Rhein");
    await expect(trefferliste(page).getByRole("option", { name: "Rhein Bonn" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(kunde).toHaveValue("Rhein · Bonn");
  });
});

test("Trefferliste ist barrierefrei, hell und dunkel (#359)", async () => {
  await go("/rechnungen/neu");
  const pruefen = async () => {
    const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
    await kunde.fill("gmbh");
    await expect(trefferliste(page)).toBeVisible();
    expect(await axeVerstoesse(page)).toEqual([]);
    await page.getByLabel("Beschreibung Position 1").fill("gibt es nicht im Katalog");
    await expect(trefferliste(page).getByRole("option")).toContainText("als neuen Artikel anlegen");
    expect(await axeVerstoesse(page)).toEqual([]);
  };
  await pruefen();
  await page.evaluate(() => localStorage.setItem("haben-modus", "dunkel"));
  await go("/rechnungen/neu");
  await pruefen();
  await page.evaluate(() => localStorage.removeItem("haben-modus"));
});

test("Angebot festschreiben, annehmen und abrechnen", async () => {
  await go("/angebote/neu");
  await expect(page.getByRole("heading", { name: /^Angebot AN-\d{4}-001$/, level: 1 })).toBeVisible();
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Workshop Softwarearchitektur");
  await page.getByLabel("Text zu Position 1 (optional)").fill("Agenda nach Abstimmung\nzwei Tage vor Ort");
  await page.getByLabel("Menge Position 1").fill("16");
  await page.getByLabel(/Einzelpreis Position 1/).fill("110");
  // Bestellnummer des Kunden (BT-13) als eigenes Feld; geht in die Rechnung aus dem Angebot über (#389)
  await page.getByLabel("Bestellnummer (optional)").fill("4500012345");
  await expect(page.getByLabel("Vorschau des Angebots")).toContainText("Dieses Angebot gilt bis zum");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  const antwort = page.getByRole("region", { name: /Antwort des Kunden/ });
  await expect(antwort).toContainText("Offen", { timeout: 30_000 });
  await expect(page.getByText("2.094,40\u00a0€").first()).toBeVisible();

  // Abschlag aus dem Angebot: Rechnungsart und Angebot vorbelegt, den Betrag trägt man selbst ein; danach wieder verwerfen
  const angebotUrl = page.url();
  await antwort.getByRole("button", { name: "Abschlagsrechnung erstellen" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Rechnungsart")).toHaveValue("abschlag");
  await expect(page.getByRole("combobox", { name: /^Angebot\b/ }).locator("option:checked")).toHaveText(/^Angebot AN-\d{4}-001 vom/);
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue(/^Abschlag gemäß Angebot AN-\d{4}-001 vom/);
  await page.getByRole("button", { name: "Entwurf löschen" }).click();
  await bestaetigen(page, "Entwurf löschen");
  await page.waitForURL(/\/rechnungen$/);
  await page.goto(angebotUrl);
  await page.waitForLoadState("networkidle");

  await antwort.getByRole("button", { name: "Rechnung erstellen", exact: true }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Workshop Softwarearchitektur");
  // Der Text zur Position geht aus dem Angebot in die Rechnung über
  await expect(page.getByLabel("Text zu Position 1 (optional)")).toHaveValue("Agenda nach Abstimmung\nzwei Tage vor Ort");
  await expect(page.getByLabel(/Hinweis auf der Rechnung/)).toHaveValue(/^Gemäß unserem Angebot AN-\d{4}-001 vom/);
  // Bestellnummer aus dem Angebot, als eigene Auftragsnummer (BT-14) dessen Nummer
  await expect(page.getByLabel("Bestellnummer (optional)")).toHaveValue("4500012345");
  await expect(page.getByLabel("Eigene Auftragsnummer (optional)")).toHaveValue(/^AN-\d{4}-001$/);
  // Den Entwurf wieder verwerfen; das Angebot lässt sich danach erneut abrechnen
  await page.getByRole("button", { name: "Entwurf löschen" }).click();
  await bestaetigen(page, "Entwurf löschen");
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

test("Angebot am Handy: Status bleibt beim Scrollen neben dem Titel sichtbar (#356)", async () => {
  const angebot = await firstLink(page, "/angebote", /^\/angebote\/[0-9a-f-]{36}$/);
  expect(angebot).not.toBeNull();
  await statusBleibtSichtbar(page, angebot as string);
});

test("Angebot mit Rabatt, Wahlpositionen und Zahlungsplan: Abschlag per Klick aus dem Plan", async () => {
  await go("/angebote/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Website Relaunch");
  await page.getByLabel(/Einzelpreis Position 1/).fill("10000");
  await page.getByLabel("Rabatt Position 1, Prozent oder Betrag").fill("10 %");
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 2").fill("Website Relaunch mit Shop");
  await page.getByLabel(/Einzelpreis Position 2/).fill("12000");
  await page.getByLabel("Art der Position 2").selectOption("alternative");
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 3").fill("Schulung");
  await page.getByLabel(/Einzelpreis Position 3/).fill("1000");
  await page.getByLabel("Art der Position 3").selectOption("optional");
  await page.getByLabel("Gesamtrabatt (optional)").fill("500");
  const vorschau = page.getByLabel("Vorschau des Angebots");
  // 10.000 € − 10 % = 9.000 €, Gesamtrabatt 500 € → 8.500 € netto, 10.115 € brutto; Alternative und Schulung zählen nicht
  await expect(vorschau).toContainText("Alternative zu Pos. 1, nicht in der Angebotssumme");
  await expect(vorschau).toContainText("abzüglich 10 % Rabatt (1.000,00 €)");
  await expect(vorschau).toContainText("10.115,00 €");

  const plan = page.getByRole("region", { name: "Zahlungsplan" });
  await plan.getByLabel("Vorlage übernehmen").selectOption("30/40/30");
  await expect(plan.getByText("2.550,00 € netto · 3.034,50 € brutto").first()).toBeVisible();
  await expect(plan.getByText("3.400,00 € netto · 4.046,00 € brutto")).toBeVisible();
  await expect(vorschau.locator('[data-teil="hinweise"]')).toContainText("2. Abschlag");
  await plan.getByLabel("Zahlungsplan auch in der Auftragsbestätigung").check();
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByRole("region", { name: /Antwort des Kunden/ })).toContainText("Offen", { timeout: 30_000 });

  // Auswahl des Kunden: Variante mit Shop und die Schulung
  const auswahl = page.getByRole("region", { name: "Auswahl des Kunden" });
  await auswahl.getByLabel(/Pos\. 2 Website Relaunch mit Shop/).check();
  await auswahl.getByLabel(/Pos\. 3 Schulung/).check();

  const zahlungsplan = page.getByRole("region", { name: "Zahlungsplan" });
  await expect(zahlungsplan).toContainText("Abgerechnet 0,00 € von 10.115,00 €");
  await zahlungsplan.getByRole("button", { name: "Abschlagsrechnung erstellen: Zahlung 1" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Rechnungsart")).toHaveValue("abschlag");
  // 30 % des Auftrags nach der Auswahl: 12.000 € + 1.000 € − 500 € = 12.500 € netto → 3.750 €
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue(/^1\. Anzahlung 30 % gemäß Angebot AN-\d{4}-002 vom/);
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("3.750,00");
  await page.goBack();
  await page.waitForLoadState("networkidle");
  await expect(zahlungsplan).toContainText("Entwurf");
  await expect(zahlungsplan).toContainText("Abgerechnet 0,00 € von 14.875,00 €");
  const response = await page.request.get((await page.getByRole("link", { name: "Auftragsbestätigung (PDF)" }).getAttribute("href"))!);
  expect(response.status()).toBe(200);

  // Den Abschlag wieder verwerfen, damit Buchungen und Konten der übrigen Schritte unverändert bleiben
  await zahlungsplan.getByRole("link", { name: "Abschlagsrechnung (Entwurf)" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Entwurf löschen" }).click();
  await bestaetigen(page, "Entwurf löschen");
  await page.waitForURL(/\/rechnungen$/);
});

test("Rechnung mit Positions- und Gesamtrabatt in der Vorschau", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("10");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100");
  await page.getByLabel("Rabatt Position 1, Prozent oder Betrag").fill("50");
  await page.getByLabel("Gesamtrabatt (optional)").fill("10 %");
  const vorschau = page.getByLabel("Vorschau der Rechnung");
  // 1.000 € − 50 € = 950 €, abzüglich 10 % = 855 € netto, 1.017,45 € brutto
  await expect(vorschau).toContainText("abzüglich 50,00 € Rabatt");
  await expect(vorschau).toContainText("Gesamtrabatt 10 %");
  await expect(vorschau).toContainText("1.017,45 €");
  await page.getByLabel("Gesamtrabatt (optional)").fill("2000");
  await expect(page.getByText("Der Gesamtrabatt ist höher als die Summe der Positionen")).toBeVisible();
  await expect(page.getByRole("button", { name: "Entwurf speichern" })).toBeDisabled();
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
  await kundeWaehlen(page, "Alpenblick Media AG · München");
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
  // Die Datei ist danach aus Haben weg, und der Knopf steht am Handy eng neben „Herunterladen“: erst nachfragen
  await anhaenge.getByRole("button", { name: "abnahme.pdf entfernen" }).click();
  const anhangRueckfrage = page.getByRole("dialog", { name: "abnahme.pdf entfernen?" });
  await expect(anhangRueckfrage).toContainText("aus Haben gelöscht");
  await anhangRueckfrage.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(anhaenge.getByRole("link", { name: "abnahme.pdf", exact: true })).toBeVisible();
  await anhaenge.getByRole("button", { name: "abnahme.pdf entfernen" }).click();
  await bestaetigen(page, "Entfernen");
  await expect(anhaenge.getByText("abnahme.pdf: entfernt.")).toBeVisible();
  await expect(anhaenge.getByRole("link", { name: "abnahme.pdf", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
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

test("Anhänge am Angebot: PDF im Entwurf hochladen, festschreiben, beim Versand auswählen, beim Kopieren übernehmen (#415)", async () => {
  await go("/angebote/neu");
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await page.getByLabel("Beschreibung Position 1").fill("Wartungsvertrag");
  await page.getByLabel("Menge Position 1").fill("12");
  await page.getByLabel(/Einzelpreis Position 1/).fill("150,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");

  const anhaenge = page.getByRole("region", { name: "Anhänge" });
  const auswahl = page.getByLabel("PDF-Anhänge auswählen");
  await auswahl.setInputFiles([
    { name: "AGB.pdf", mimeType: "application/pdf", buffer: attachmentPdf("AGB") },
    { name: "intern.pdf", mimeType: "application/pdf", buffer: attachmentPdf("Intern") },
  ]);
  await expect(anhaenge.getByText("AGB.pdf: angehängt.")).toBeVisible();
  await expect(anhaenge.getByRole("link", { name: "intern.pdf", exact: true })).toBeVisible();
  // Dieselbe Datei ein zweites Mal hängt nicht doppelt
  await auswahl.setInputFiles([{ name: "AGB-Kopie.pdf", mimeType: "application/pdf", buffer: attachmentPdf("AGB") }]);
  await expect(anhaenge.getByText("AGB-Kopie.pdf: hängt schon an diesem Angebot.")).toBeVisible();
  await anhaenge.getByRole("button", { name: "intern.pdf entfernen" }).click();
  await bestaetigen(page, "Entfernen");
  await expect(anhaenge.getByText("intern.pdf: entfernt.")).toBeVisible();
  await expect(anhaenge.getByRole("link", { name: "intern.pdf", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByRole("region", { name: /Antwort des Kunden/ })).toContainText("Offen", { timeout: 30_000 });
  const number = (await page.getByRole("heading", { level: 1 }).textContent())!.replace("Angebot ", "").trim();
  await expect(anhaenge).toContainText("Mit dem Angebot festgeschrieben.");
  await expect(anhaenge.getByRole("button", { name: /entfernen/ })).toHaveCount(0);
  const download = await page.request.get((await anhaenge.getByRole("link", { name: "AGB.pdf herunterladen" }).getAttribute("href"))!);
  expect(download.headers()["content-type"]).toBe("application/pdf");
  expect((await download.body()).toString()).toContain("AGB");

  // Der Zugang aus den Tests davor zeigt auf einen Port ohne Mailserver: der Versand scheitert, das Protokoll nennt die Dateien
  const bereich = page.getByRole("region", { name: "Per E-Mail" });
  await bereich.getByRole("button", { name: "Angebot senden" }).click();
  const formular = bereich.getByRole("form", { name: "Angebot per E-Mail senden" });
  await expect(formular.getByRole("group", { name: "Zusätzliche Anhänge mitsenden" }).getByRole("checkbox", { name: "AGB.pdf" })).toBeChecked();
  await formular.getByLabel("An", { exact: true }).fill("einkauf@rheinpixel.example");
  await formular.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(formular.getByRole("alert")).toContainText("Nicht gesendet");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Per E-Mail" })).toContainText(`Anhang: Angebot-${number}.pdf, AGB.pdf`);

  // Kopieren legt einen Entwurf mit denselben Anhängen an, die sich dort wieder ändern lassen
  const original = page.url();
  await page.getByRole("button", { name: "Kopieren" }).click();
  await page.waitForURL((url) => /angebote\/[0-9a-f-]{36}$/.test(url.pathname) && url.href !== original);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Anhänge" }).getByRole("button", { name: "AGB.pdf entfernen" })).toBeVisible();
});

test("Standardanhänge: AGB in den Einstellungen, jedes neue Angebot hat sie, im Entwurf abwählbar (#415)", async () => {
  await go("/einstellungen?bereich=rechnungen");
  const standard = page.getByRole("region", { name: "Standardanhänge für Angebote" });
  await standard.getByLabel("PDF-Anhänge auswählen").setInputFiles([
    { name: "AGB.pdf", mimeType: "application/pdf", buffer: attachmentPdf("AGB Stand 2026") },
    { name: "Widerrufsbelehrung.pdf", mimeType: "application/pdf", buffer: attachmentPdf("Widerruf") },
  ]);
  await expect(standard.getByText("AGB.pdf: angehängt.")).toBeVisible();
  await expect(standard.getByRole("link", { name: "Widerrufsbelehrung.pdf", exact: true })).toBeVisible();

  await go("/angebote/neu");
  await kundeWaehlen(page, "Alpenblick Media AG · München");
  await page.getByLabel("Beschreibung Position 1").fill("Konzeption Website");
  await page.getByLabel("Menge Position 1").fill("10");
  await page.getByLabel(/Einzelpreis Position 1/).fill("120,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const anhaenge = page.getByRole("region", { name: "Anhänge" });
  await expect(anhaenge.getByRole("link", { name: "AGB.pdf", exact: true })).toBeVisible();
  // Für dieses Angebot ohne Widerrufsbelehrung; die Einstellung bleibt
  await anhaenge.getByRole("button", { name: "Widerrufsbelehrung.pdf entfernen" }).click();
  await bestaetigen(page, "Entfernen");
  await expect(anhaenge.getByText("Widerrufsbelehrung.pdf: entfernt.")).toBeVisible();

  // Die Standardanhänge wieder herausnehmen, damit die folgenden Tests Angebote ohne sie anlegen
  await go("/einstellungen?bereich=rechnungen");
  for (const name of ["AGB.pdf", "Widerrufsbelehrung.pdf"]) {
    await standard.getByRole("button", { name: `${name} entfernen` }).click();
    // Die Datei hängt noch an Angeboten: Die Rückfrage darf nicht behaupten, sie sei dann weg
    await expect(page.getByRole("dialog", { name: `${name} entfernen?` })).toContainText("Neue Angebote");
    await expect(page.getByRole("dialog", { name: `${name} entfernen?` })).not.toContainText("gelöscht");
    await bestaetigen(page, "Entfernen");
    await expect(standard.getByText(`${name}: entfernt.`)).toBeVisible();
  }
  await expect(standard).toContainText("Keine Standardanhänge.");
});

test("Abschlagsrechnung festschreiben und Schlussrechnung vorbereiten", async () => {
  await go("/rechnungen/neu");
  await page.getByRole("combobox", { name: /^Rechnungsart/ }).selectOption("abschlag");
  await expect(page.getByRole("heading", { name: /^Abschlagsrechnung \d{4}-\d{3}$/, level: 1 })).toBeVisible();
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await page.getByLabel("Beschreibung Position 1").fill("1. Abschlag Relaunch Website");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("2000");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const number = (await page.getByRole("heading", { level: 1 }).textContent())!.replace("Abschlagsrechnung ", "").trim();
  const lieferschein = await page.request.get((await page.getByRole("link", { name: "Lieferschein" }).getAttribute("href"))!);
  expect(lieferschein.headers()["content-type"]).toBe("application/pdf");

  await page.getByRole("link", { name: "Schlussrechnung erstellen" }).click();
  await page.waitForURL(/rechnungen\/neu\?schluss=/);
  await expect(page.getByRole("heading", { name: /^Schlussrechnung /, level: 1 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Kunde", exact: true })).toHaveValue("Rheinpixel GmbH · Köln");
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
  await faktenZeigen(page, "Nummer", "Text", "Betrag");
  await bestaetigen(page, "Stornieren");
  await expect(page.getByRole("status").filter({ hasText: "Storniert mit Nr. 2" })).toBeVisible();
  await expect(liste).toContainText("Storno Nr. 1: Wechselgeld");
});

test("Kasse: Rechnung bar bezahlt, erst ein Teil, dann der Rest von der Rechnung aus, Storno der Bareinnahme", async ({ browser }) => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await page.getByLabel("Rechnungsdatum").fill(day(-3));
  await page.getByLabel("Beschreibung Position 1").fill("Flyer gedruckt, bar bezahlt");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const invoicePath = new URL(page.url()).pathname;
  const number = (await page.getByRole("heading", { level: 1 }).textContent())?.match(/^Rechnung (\S+)/)?.[1] ?? "";
  expect(number).not.toBe("");
  const zahlungen = page.getByRole("region", { name: "Zahlungen" });
  await expect(zahlungen).toContainText("Noch keine Zahlung");

  // Das Storno nennt, was storniert würde; hier nur ansehen
  await page.getByRole("button", { name: "Stornieren" }).click();
  await faktenZeigen(page, "Nummer", "Kunde", "Betrag");
  await page.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();

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
  // Mehr als offen wird nicht mehr abgelehnt, sondern aufgeteilt (#455): Der Teil darüber wäre eine weitere Einnahme
  await form.getByLabel("Betrag (€)").fill("70,00");
  await expect(form).toContainText(/1,00\s€ darüber werden eine weitere Einnahme/);
  await expect(form.getByRole("group", { name: /Weitere Einnahme über 1,00/ })).toBeVisible();
  await form.getByLabel("Betrag (€)").fill("69,00");
  await expect(form.getByRole("group", { name: /Weitere Einnahme/ })).toHaveCount(0);
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
  await bestaetigen(page, "Stornieren");
  await expect(page.getByRole("status").filter({ hasText: "Storniert mit Nr." })).toBeVisible();
  await expect(liste).toContainText(`Storno Nr. ${restNr}: Rechnung ${number}`);
  await go(invoicePath);
  await expect(page.getByText("Teilbezahlt").first()).toBeVisible();
  await expect(zahlungen).toContainText("storniert");
});

test("Kasse: Bareinnahme ohne Rechnung als Tagessumme mit Steuer und Notiz, Storno (#276)", async ({ browser }) => {
  await go("/kasse");
  const form = page.getByRole("form", { name: "Kassenbuchung eintragen" });
  await form.getByRole("button", { name: "Bareinnahme ohne Rechnung" }).click();
  await expect(form.getByRole("button", { name: "Bareinnahme ohne Rechnung" })).toHaveAttribute("aria-pressed", "true");
  // Regelbesteuert: 19 %, 7 % oder steuerfrei; die Kleinunternehmer-Option fehlt
  const steuer = form.getByLabel("Umsatzsteuer");
  await expect(steuer).toHaveValue("regulaer:1900");
  await expect(steuer.getByRole("option")).toHaveText(["Regulär 19 %", "Regulär 7 %", "steuerfrei (§ 4 Nr. 8 bis 29 UStG)"]);
  // Die Notiz ist Pflicht: Ohne Rechnung ist sie der Nachweis
  await expect(form.getByLabel("Notiz")).toHaveAttribute("required", "");
  // Das Formular der Bareinnahme prüft axe am Desktop und am Handy (WCAG 2.2 AA wie barrierefreiheit.spec.ts)
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const axePage = await context.newPage();
  for (const width of [1440, 390]) {
    await axePage.setViewportSize({ width, height: 900 });
    await axePage.goto(page.url());
    await axePage.waitForLoadState("networkidle");
    await axePage.getByRole("button", { name: "Bareinnahme ohne Rechnung" }).click();
    await expect(axePage.getByLabel("Umsatzsteuer")).toBeVisible();
    const { violations } = await new AxeBuilder({ page: axePage })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      `/kasse mit Bareinnahme bei ${width} px`,
    ).toEqual([]);
  }
  await context.close();

  await form.getByLabel("Betrag (€)").fill("107,00");
  await steuer.selectOption("regulaer:700");
  await form.getByLabel("Notiz").fill("Wochenmarkt, Tagessumme Bücher");
  await form.getByRole("button", { name: "Buchen" }).click();
  const gebucht = page.getByRole("status").filter({ hasText: "gebucht: Bareinnahme über 107,00 €, 7 %." });
  await expect(gebucht).toBeVisible();
  const nr = (await gebucht.textContent())?.match(/Nr\. (\d+) gebucht/)?.[1] ?? "";
  const liste = page.getByRole("region", { name: "Kassenbuch" });
  await expect(liste).toContainText("Wochenmarkt, Tagessumme Bücher");
  await expect(liste).toContainText("Bareinnahme · 7 %");

  await liste.getByRole("button", { name: `Nr. ${nr} stornieren` }).click();
  await bestaetigen(page, "Stornieren");
  await expect(page.getByRole("status").filter({ hasText: "Storniert mit Nr." })).toBeVisible();
  await expect(liste).toContainText(`Storno Nr. ${nr}: Wochenmarkt, Tagessumme Bücher`);
});

test("Kasse: Barzahlung aufteilen, Rechnung voll und Trinkgeld als weitere Einnahme (#455)", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await page.getByLabel("Rechnungsdatum").fill(day(-1));
  await page.getByLabel("Beschreibung Position 1").fill("Fotoshooting, bar bezahlt mit Trinkgeld");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const invoicePath = new URL(page.url()).pathname;
  const number = (await page.getByRole("heading", { level: 1 }).textContent())?.match(/^Rechnung (\S+)/)?.[1] ?? "";

  await go("/kasse");
  const form = page.getByRole("form", { name: "Kassenbuchung eintragen" });
  await form.getByRole("button", { name: "Rechnung bar bezahlt" }).click();
  const option = form.getByRole("option", { name: new RegExp(`^${number} · Rheinpixel GmbH`) });
  await form.getByRole("combobox", { name: /^Rechnung/ }).selectOption((await option.getAttribute("value"))!);
  // 125,00 € für 119,00 €: Die Rechnung ist bezahlt, 6,00 € werden eine weitere Einnahme
  await form.getByLabel("Betrag (€)").fill("125,00");
  await expect(form).toContainText(/6,00\s€ darüber werden eine weitere Einnahme/);
  const weitere = form.getByRole("group", { name: /Weitere Einnahme über 6,00/ });
  await expect(weitere.getByLabel("Umsatzsteuer")).toHaveValue("regulaer:1900");
  await weitere.getByLabel("Notiz zur weiteren Einnahme").fill("Trinkgeld");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `gebucht: Bareinnahme Rechnung ${number} über 119,00 €, dazu 6,00 € als weitere Einnahme (19 %).` }),
  ).toBeVisible();
  const liste = page.getByRole("region", { name: "Kassenbuch" });
  await expect(liste).toContainText(`Trinkgeld zu Rechnung ${number}`);
  await expect(liste).toContainText("Bareinnahme · 19 %");
  await go(invoicePath);
  await expect(page.getByText("Bezahlt").first()).toBeVisible();
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
  await bestaetigen(page, "Beleg löschen");
  await page.waitForURL(/\/belege$/);
  expect((await page.request.get(`/api/v1/belege/${document.id}`, { headers: auth })).status()).toBe(404);

  // Jeder Aufruf steht im Protokoll, ohne Inhalte
  await go("/einstellungen?bereich=ki");
  const calls = page.getByRole("region", { name: "Letzte Aufrufe" });
  await expect(calls.getByText("POST /rechnungen").first()).toBeVisible();
  await expect(calls.getByText("POST /belege").first()).toBeVisible();
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
  // Erst nach der Hydration wählen; sonst verwirft React die gewählte Datei
  await axePage.waitForLoadState("networkidle");
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

test("Ein langes Wort im Titel des Dialogs wird umbrochen, nicht abgeschnitten", async () => {
  const name = "Warenwirtschaftsbestelluebersichtsseiten"; // 40 Zeichen, mehr nimmt das Formular nicht
  await go("/einstellungen?bereich=seiten");
  const form = page.getByRole("form", { name: "Neue eigene Seite" });
  await form.getByLabel("Name im Menü").fill(name);
  await form.getByLabel("Adresse").fill("https://n8n.example.com/form");
  await form.getByRole("button", { name: "Seite hinzufügen" }).click();
  const entfernen = page.getByRole("button", { name: `${name} entfernen` });
  await expect(entfernen).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  await entfernen.click();
  const dialog = page.getByRole("dialog", { name: /aus dem Menü entfernen\?$/ });
  const titel = dialog.getByRole("heading");
  await expect(titel).toBeVisible();
  const passt = await titel.evaluate((element) => element.scrollWidth <= element.clientWidth);
  await dialog.getByRole("button", { name: "Entfernen" }).click();
  await expect(entfernen).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(passt).toBe(true);
});

test("Doppelklick auf Stornieren im Kassenbuch: Liegt der rote Knopf des Dialogs darunter, bestätigt der zweite Klick nicht", async () => {
  await go("/kasse");
  const form = page.getByRole("form", { name: "Kassenbuchung eintragen" });
  await form.getByLabel("Betrag (€)").fill("20");
  await form.getByLabel("Text (optional)").fill("Doppelklick");
  await form.getByRole("button", { name: "Buchen" }).click();
  const eintrag = page.getByRole("region", { name: "Kassenbuch" }).locator(".table-row").filter({ hasText: "Doppelklick" });
  await expect(eintrag).toBeVisible();

  // Handy: Der Knopf der Zeile steht rechts wie die Aktion im Dialog; ob sie sich decken, hängt nur noch an der Höhe
  await page.setViewportSize({ width: 375, height: 812 });
  const stornieren = eintrag.getByRole("button", { name: /stornieren$/ });
  await stornieren.click();
  const dialog = page.getByRole("dialog", { name: /stornieren\?$/ });
  const aktion = (await dialog.getByRole("button", { name: "Stornieren" }).boundingBox())!;
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.evaluate(() => window.scrollTo(0, 0));
  const unterDerAktion = aktion.y + aktion.height / 2 - 812 / 2;
  const zeile = (await stornieren.boundingBox())!;
  const mitte = { x: zeile.x + zeile.width / 2, y: zeile.y + zeile.height / 2 };
  expect(mitte.x).toBeGreaterThan(aktion.x);
  expect(mitte.x).toBeLessThan(aktion.x + aktion.width);
  await page.setViewportSize({ width: 375, height: Math.round(2 * (mitte.y - unterDerAktion)) });

  await page.mouse.dblclick(mitte.x, mitte.y);
  await expect(dialog).toBeVisible();
  await expect(eintrag).not.toContainText("storniert");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("Entwurf aus dem stehenden Kopf speichern: die Bestätigung erscheint im Fenster (#356)", async () => {
  const vorher = page.viewportSize();
  await page.setViewportSize(LAPTOP);
  await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100");
  const speichern = page.locator(".main > .page-head").getByRole("button", { name: "Entwurf speichern" });
  await speichern.click();
  await expect(page).toHaveURL(/\/rechnungen\/[0-9a-f-]{36}/);
  await expect(speichern).toBeDisabled();
  // Nach dem ersten Speichern lädt die Seite neu: eine zu frühe Eingabe ginge dabei verloren
  await expect(async () => {
    await page.getByLabel("Beschreibung Position 1").fill("Beratung geändert");
    await expect(speichern).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await zumEnde(page);
  await speichern.click();
  await sichtbar(page.getByRole("status").filter({ hasText: "Entwurf gespeichert." }));
  if (vorher) await page.setViewportSize(vorher);
});

test("Kasse: Bareinnahme ohne Rechnung aus einem Monat, in dem noch § 19 galt, bietet „Kleinunternehmer“ an (#276)", async () => {
  // Stand im Änderungsprotokoll: vor 40 Tagen Kleinunternehmer, heute nicht mehr (Ausschalten geht jederzeit), wie in
  // belege-steuern.spec.ts (#295). Der Server prüft die Behandlung gegen den Stand am Ende des Monats der Bareinnahme.
  const datum = day(-40);
  const sql = postgres(databaseUrlFuer("rechnungen"), { max: 1 });
  try {
    await sql`insert into audit_log (at, actor, table_name, row_id, action, new_value)
      values (${`${datum}T12:00:00Z`}::timestamptz, 'e2e', 'company', '1', 'UPDATE', ${sql.json({ kleinunternehmer: true })}),
             (now(), 'e2e', 'company', '1', 'UPDATE', ${sql.json({ kleinunternehmer: false })})`;
  } finally {
    await sql.end();
  }
  await go("/kasse");
  const form = page.getByRole("form", { name: "Kassenbuchung eintragen" });
  await form.getByRole("button", { name: "Bareinnahme ohne Rechnung" }).click();
  await form.getByLabel("Datum").fill(datum);
  const steuer = form.getByLabel("Umsatzsteuer");
  // Für dieses Datum ist nur „Kleinunternehmer“ oder „steuerfrei“ buchbar; 19 % lehnt der Server ab
  await expect(steuer.getByRole("option")).toHaveText(["Kleinunternehmer (§ 19 UStG)", "steuerfrei (§ 4 Nr. 8 bis 29 UStG)"]);
  await expect(steuer).toHaveValue("kleinunternehmer:0");
  await form.getByLabel("Betrag (€)").fill("25,00");
  await form.getByLabel("Notiz").fill("Flohmarkt, Tagessumme");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "gebucht: Bareinnahme über 25,00 €, Kleinunternehmer (§ 19 UStG)." })).toBeVisible();
});

test("Rechnung per SEPA-Lastschrift: Mandat wählen, festschreiben, Vorabankündigung und Zahlungsart 59 in der E-Rechnung (#445)", async () => {
  // Gläubiger-ID (Test-ID der Bundesbank) und ein Mandat für Alpenblick
  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("Gläubiger-ID").fill("DE98ZZZ09999999999");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
  await go("/kontakte");
  await go(
    (await page
      .getByRole("link", { name: /Alpenblick Media AG/ })
      .first()
      .getAttribute("href"))!,
  );
  const karte = page.getByRole("region", { name: "SEPA-Lastschriftmandate" });
  await karte.getByRole("button", { name: "Mandat anlegen" }).click();
  const mandat = karte.getByRole("form", { name: "Neues Mandat" });
  await mandat.getByLabel("Mandatsreferenz").fill("AB-2026-01");
  await mandat.getByLabel("Unterschrieben am").fill(day(-30));
  await mandat.getByLabel("IBAN").fill("DE02120300000000202051");
  await mandat.getByRole("button", { name: "Mandat speichern" }).click();
  await expect(page.getByText("Mandat angelegt.")).toBeVisible();

  await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
  await kundeWaehlen(page, "Alpenblick Media AG · München");
  // Fällig in 7 Tagen: Auch wenn ein Wochenende oder Ostern die Fälligkeit um bis zu 4 Tage verschiebt, liegt sie
  // weniger als 14 Tage entfernt, und der nächste Test kann die Lastschrift sofort einreichen (#904)
  await page.getByLabel("Rechnungsdatum").fill(day(-7));
  await page.getByLabel("Zahlungsart").selectOption("lastschrift");
  // Das jüngste gültige Mandat des Kunden ist vorgewählt; Skonto entfällt bei Lastschrift
  // Über die Rolle: getByLabel mit exact vergleicht den ganzen Text des umschließenden Labels samt gewählter Option
  const mandatFeld = page.getByRole("combobox", { name: "Mandat", exact: true });
  await expect(mandatFeld).toHaveValue(/.+/);
  await expect(mandatFeld.locator("option:checked")).toHaveText("AB-2026-01 · CORE");
  await expect(page.getByRole("button", { name: "Skontostufe hinzufügen" })).toHaveCount(0);
  await page.getByLabel("Beschreibung Position 1").fill("Wartung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("250");
  await page.getByRole("button", { name: "Entwurf speichern" }).first().click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Zahlungsart")).toHaveValue("lastschrift");
  await page.getByRole("button", { name: "Festschreiben" }).first().click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const id = /rechnungen\/([0-9a-f-]{36})/.exec(page.url())![1];
  const xml = await (await page.request.get(`/api/rechnung/${id}/xml`)).text();
  expect(xml).toMatch(/<ram:TypeCode>59<\/ram:TypeCode>/);
  expect(xml).toContain("<ram:DirectDebitMandateID>AB-2026-01</ram:DirectDebitMandateID>");
  expect(xml).toContain("<ram:CreditorReferenceID>DE98ZZZ09999999999</ram:CreditorReferenceID>");
  expect(xml).toContain("per SEPA-Lastschrift");
});

test("Lastschriftdatei: fällige Rechnung wählen, pain.008 herunterladen, danach nicht mehr angeboten (#445)", async () => {
  await go("/lastschriften");
  // Ohne Bankkonto gibt es kein Gläubigerkonto, auf dem der Betrag eingeht
  await expect(page.getByText(/braucht Haben das Konto, auf dem der Betrag eingeht/)).toBeVisible();
  await go("/bank");
  await page.getByRole("button", { name: "Konto hinzufügen" }).click();
  const kontoForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Konto anlegen" }) });
  await kontoForm.getByRole("textbox", { name: "Name" }).fill("Girokonto");
  await kontoForm.getByRole("textbox", { name: "IBAN" }).fill("DE89 3704 0044 0532 0130 00");
  await kontoForm.getByRole("button", { name: "Konto anlegen" }).click();
  await expect(page.getByRole("combobox", { name: "Konto" }).locator("option", { hasText: "Girokonto" })).toHaveCount(1);

  await go("/lastschriften");
  const form = page.getByRole("form", { name: "SEPA-Lastschrift erzeugen" });
  const zeile = form.getByRole("checkbox", { name: /Alpenblick Media AG .* einziehen/ });
  await expect(form).toContainText("AB-2026-01");
  await expect(form).toContainText("CORE · Erstlastschrift");
  await zeile.check();
  await expect(form.getByText("1 ausgewählt · 297,50 €")).toBeVisible();
  const download = page.waitForEvent("download");
  await form.getByRole("button", { name: "Lastschriftdatei erzeugen" }).click();
  const datei = await download;
  expect(datei.suggestedFilename()).toMatch(/^HABEN-[0-9A-F]{16}\.xml$/);
  const { readFile } = await import("node:fs/promises");
  const xml = await readFile((await datei.path())!, "utf8");
  expect(xml).toContain("urn:iso:std:iso:20022:tech:xsd:pain.008.001.08");
  expect(xml).toContain("<MndtId>AB-2026-01</MndtId>");
  expect(xml).toContain("<SeqTp>FRST</SeqTp>");
  // formatEuro trennt den Betrag mit einem geschützten Leerzeichen vom Euro-Zeichen
  await expect(page.getByText(/1 Lastschrift über 297,50\s€/)).toBeVisible();
  await expect(form.getByRole("checkbox", { name: /Alpenblick Media AG .* einziehen/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Erzeugte Dateien" })).toContainText("297,50 €");
});

test("Beleggestaltung: Einstellungen, die das zugeordnete eigene Layout nicht verwendet, sind aus und sagen warum (#113)", async () => {
  // Hier statt in layouts.spec.ts: Ein eigenes Layout für Rechnungen sähen dort die parallelen Tests der Rechnungsvorschau
  const karte = page.getByRole("region", { name: "Layouts", exact: true });
  const blatt = page.getByRole("region", { name: "Logo und Blatt" });
  const giroCode = blatt.getByRole("checkbox", { name: "GiroCode" });
  const falzmarken = blatt.getByRole("checkbox", { name: "Falz- und Lochmarken" });
  const zuordnen = async (art: string, layout: string) => {
    await karte.getByLabel(`Layout für ${art}`).selectOption({ label: layout });
    await expect(karte.getByRole("status").first()).toContainText("Gespeichert");
    await go("/einstellungen?bereich=gestaltung");
  };
  const hochladen = async (name: string, art: "beleg" | "mahnung") => {
    // Die eingebaute Vorlage ohne GiroCode und ohne Falz- und Lochmarken
    const quelltext = (await (await page.request.get(`/api/belegvorlagen?datei=start&art=${art}`)).text())
      .replace(/(?<![A-Za-z0-9_])qr(?![A-Za-z0-9_])/g, "ohneqr")
      .replaceAll("look.foldMarks", "false")
      .replaceAll("foldMarks: true, ", "");
    const form = karte.getByRole("form", { name: "Layout hochladen" });
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("Für").selectOption(art);
    await form.getByLabel("Typst-Datei").setInputFiles({ name: `${name}.typ`, mimeType: "text/plain", buffer: Buffer.from(quelltext) });
    await form.getByRole("button", { name: "Prüfen und speichern" }).click();
    // Die Meldung stünde vom vorigen Hochladen noch da; erst der Eintrag in der Liste zeigt, dass dieses gespeichert ist
    await expect(karte.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) })).toBeVisible({ timeout: 60_000 });
  };

  await go("/einstellungen?bereich=gestaltung");
  await expect(giroCode).toBeEnabled();
  await expect(giroCode).toHaveAccessibleDescription("");
  await hochladen("Schlicht", "beleg");
  await hochladen("Schlicht Mahnung", "mahnung");
  // Hochgeladen, aber noch nirgends zugeordnet: ändert nichts
  await go("/einstellungen?bereich=gestaltung");
  await expect(giroCode).toHaveAccessibleDescription("");

  try {
    // Die Mahnung hat noch das eingebaute Layout: GiroCode bleibt an, der Hinweis nennt die Rechnungen
    await zuordnen("Rechnung, Storno und Korrektur", "Schlicht");
    await expect(giroCode).toBeEnabled();
    await expect(giroCode).toHaveAccessibleDescription("Wirkt nicht auf Rechnungen: Das Layout „Schlicht“ verwendet qr nicht.");

    // GiroCode gibt es nur auf Rechnung und Mahnung; ohne qr in beiden Layouts ist er aus
    await zuordnen("Mahnung", "Schlicht Mahnung");
    await expect(giroCode).toBeDisabled();
    await expect(giroCode).toHaveAccessibleDescription("Die Layouts „Schlicht“ und „Schlicht Mahnung“ verwenden qr nicht.");
    await expect(blatt.getByText("Die Layouts „Schlicht“ und „Schlicht Mahnung“ verwenden qr nicht.")).toBeVisible();
    // Falzmarken wirken noch auf Angebot, Auftragsbestätigung und Lieferschein mit dem eingebauten Layout
    await expect(falzmarken).toBeEnabled();
    await expect(falzmarken).toHaveAccessibleDescription(/^Wirkt nicht auf Rechnungen und Mahnungen: /);
    await expect(blatt.getByRole("checkbox", { name: "Kundennummer" })).toHaveAccessibleDescription("");
    expect(await axeVerstoesse(page)).toEqual([]);
  } finally {
    // Löschen setzt die Zuordnung auf das eingebaute Layout zurück
    for (const name of ["Schlicht", "Schlicht Mahnung"]) {
      await karte
        .getByRole("listitem")
        .filter({ has: page.getByText(name, { exact: true }) })
        .getByRole("button", { name: "Löschen" })
        .click();
      await page
        .getByRole("dialog", { name: `Layout „${name}“ löschen?` })
        .getByRole("button", { name: "Layout löschen" })
        .click();
      await expect(karte.getByText(name, { exact: true })).toHaveCount(0);
    }
  }
  await go("/einstellungen?bereich=gestaltung");
  await expect(giroCode).toBeEnabled();
  await expect(giroCode).toHaveAccessibleDescription("");
});

test("Ansprechpartner: am Kontakt anlegen, in der Rechnung wählen und festschreiben; die Rechnung behält den Stand (#424)", async () => {
  await go("/kontakte");
  await go(
    (await page
      .getByRole("link", { name: /Rheinpixel GmbH/ })
      .first()
      .getAttribute("href"))!,
  );
  const karte = page.getByRole("region", { name: "Ansprechpartner" });
  await karte.getByRole("button", { name: "Ansprechpartner hinzufügen" }).click();
  const neu = karte.getByRole("form", { name: "Neuer Ansprechpartner" });
  await neu.getByLabel("Name").fill("Mara Beispiel");
  await neu.getByLabel("E-Mail").fill("mara@rheinpixel.example");
  await neu.getByLabel("Telefon").fill("+49 221 7654321");
  await neu.getByLabel("Funktion").fill("Einkauf");
  await neu.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Ansprechpartner angelegt.")).toBeVisible();
  await expect(karte).toContainText("Einkauf · mara@rheinpixel.example · +49 221 7654321");

  // Ein Kunde ohne Ansprechpartner bekommt das Feld nicht
  await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
  await kundeWaehlen(page, "Nordwerk Software GmbH · Hamburg");
  await expect(page.getByRole("combobox", { name: "Ansprechpartner" })).toHaveCount(0);

  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  const feld = page.getByRole("combobox", { name: "Ansprechpartner" });
  await expect(feld).toHaveValue("");
  await feld.selectOption({ label: "Mara Beispiel" });
  await page.getByLabel("Beschreibung Position 1").fill("Wartung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("300");
  await page.getByRole("button", { name: "Entwurf speichern" }).first().click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  // Gespeichert: die Auswahl steht nach dem Neuladen noch da
  await expect(page.getByRole("combobox", { name: "Ansprechpartner" }).locator("option:checked")).toHaveText("Mara Beispiel");
  await page.getByRole("button", { name: "Festschreiben" }).first().click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const id = /rechnungen\/([0-9a-f-]{36})/.exec(page.url())![1];
  const buyer = (xml: string) => /<ram:BuyerTradeParty>([\s\S]*?)<\/ram:BuyerTradeParty>/.exec(xml)![1]!;
  const xml = await (await page.request.get(`/api/rechnung/${id}/xml`)).text();
  expect(buyer(xml)).toContain("<ram:PersonName>Mara Beispiel</ram:PersonName>");

  // Die Person ändert sich und wird deaktiviert; die festgeschriebene Rechnung behält den Stand
  await go("/kontakte");
  await go(
    (await page
      .getByRole("link", { name: /Rheinpixel GmbH/ })
      .first()
      .getAttribute("href"))!,
  );
  await karte.getByRole("button", { name: "Mara Beispiel ändern" }).click();
  const aendern = karte.getByRole("form", { name: "Ansprechpartner ändern" });
  await aendern.getByLabel("Name").fill("Mara Beispielmann");
  await aendern.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Ansprechpartner gespeichert.")).toBeVisible();
  await karte.getByRole("button", { name: "Mara Beispielmann deaktivieren" }).click();
  // exact (case-sensitive, ganzes Wort): sonst trifft der Substring auch den Hinweis „Wer nicht mehr dabei ist, wird deaktiviert.“ (#881)
  await expect(karte.getByText("deaktiviert", { exact: true })).toBeVisible();
  expect(buyer(await (await page.request.get(`/api/rechnung/${id}/xml`)).text())).toContain("<ram:PersonName>Mara Beispiel</ram:PersonName>");

  // Eine deaktivierte Person wird im neuen Entwurf nicht mehr angeboten
  await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await expect(page.getByRole("combobox", { name: "Ansprechpartner" })).toHaveCount(0);
});

test("Seiten mit den Daten dieses Durchlaufs ohne axe-Verstöße", async () => {
  await ohneAxeVerstoesse(page, [
    "/rechnungen",
    "/angebote",
    "/artikel",
    "/textbausteine",
    "/kasse",
    "/kontakte",
    "/anlagen",
    "/einstellungen?bereich=email",
    "/einstellungen?bereich=ki",
  ]);
});

test("Leistungen: Eintrag mit eigenem Stundensatz anlegen, ändern, nach Kunde filtern und löschen (#417)", async () => {
  await go("/leistungen");
  await expect(page.getByText("Noch keine Einträge.")).toBeVisible();
  await page.getByRole("button", { name: "Neuer Eintrag" }).click();
  const neu = page.getByRole("form", { name: "Neuer Eintrag" });
  await neu.getByLabel("Kunde").selectOption({ label: "Rheinpixel GmbH" });
  await neu.getByLabel("Dauer", { exact: true }).fill("1:30");
  await neu.getByLabel(/Stundensatz/).fill("95");
  await neu.getByLabel(/Tätigkeit/).fill("Konzept Datenmodell");
  await neu.getByLabel(/Projekt/).fill("Relaunch Shop");
  await neu.getByLabel(/Abrechenbare Dauer/).fill("1:00");
  await neu.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("Eintrag angelegt.")).toBeVisible();

  const liste = page.getByRole("region", { name: "Leistungsliste" });
  await expect(liste).toContainText("Rheinpixel GmbH");
  await expect(liste).toContainText("Konzept Datenmodell");
  await expect(liste).toContainText("1:30 Std.");
  await expect(liste).toContainText("Relaunch Shop");
  // Berechnet wird die abrechenbare Stunde, nicht die erfassten 90 Minuten
  await expect(liste).toContainText("abrechenbar 1:00");
  await expect(liste).toContainText("95,00");
  await expect(liste).not.toContainText("142,50");
  // Mit Eintrag: keine axe-Verstöße, am Handy nicht breiter als der Bildschirm
  await ohneAxeVerstoesse(page, ["/leistungen"]);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Dauer unlesbar: Meldung, nichts gespeichert
  await liste.getByRole("button", { name: /bearbeiten/ }).click();
  const aendern = page.getByRole("form", { name: "Eintrag ändern" });
  await aendern.getByLabel("Dauer", { exact: true }).fill("abc");
  await aendern.getByRole("button", { name: "Speichern" }).click();
  await expect(aendern.getByRole("alert")).toContainText("Die Dauer ist nicht lesbar");
  await aendern.getByLabel("Dauer", { exact: true }).fill("2");
  await aendern.getByLabel(/Abrechenbare Dauer/).fill("");
  await aendern.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Eintrag gespeichert.")).toBeVisible();
  await expect(liste).toContainText("2:00 Std.");
  await expect(liste).toContainText("190,00");

  // Der Filter nach Kunde blendet fremde Einträge aus
  await page.getByRole("group", { name: "Filter" }).getByLabel("Kunde").selectOption({ label: "Nordwerk Software GmbH" });
  await expect(liste).toContainText("Keine Einträge für diesen Filter.");
  await page.getByRole("group", { name: "Filter" }).getByLabel("Kunde").selectOption({ label: "Alle Kunden" });
  await expect(liste).toContainText("Konzept Datenmodell");

  // Nicht abrechenbar: erfasst, aber ohne Betrag
  await liste.getByRole("button", { name: /bearbeiten/ }).click();
  await page
    .getByRole("form", { name: "Eintrag ändern" })
    .getByLabel(/Nicht abrechenbar/)
    .check();
  await page.getByRole("form", { name: "Eintrag ändern" }).getByRole("button", { name: "Speichern" }).click();
  await expect(liste).toContainText("nicht abrechenbar");
  await expect(liste).toContainText("davon abrechenbar 0:00 Std. mit 0,00");

  // Löschen fragt vorher nach; Abbrechen löscht nichts
  await liste.getByRole("button", { name: /löschen/ }).click();
  const dialog = page.getByRole("dialog", { name: "Eintrag löschen?" });
  await expect(dialog).toContainText("Rheinpixel GmbH");
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(liste).toContainText("Konzept Datenmodell");
  await liste.getByRole("button", { name: /löschen/ }).click();
  await page.getByRole("dialog", { name: "Eintrag löschen?" }).getByRole("button", { name: "Löschen" }).click();
  await expect(page.getByText("Eintrag gelöscht.")).toBeVisible();
  await expect(page.getByText("Noch keine Einträge.")).toBeVisible();
});

test("Leistungen abrechnen: Vorschau, Rechnungsentwurf mit Nachweis, Einträge gesperrt, nicht zweimal abrechenbar (#417)", async () => {
  await go("/leistungen");
  const eintraege: [string, string, boolean][] = [
    ["1:30", "Konzept Datenmodell", false],
    ["2:00", "Entwicklung Warenkorb", false],
    ["0:45", "Interne Abstimmung", true],
  ];
  for (const [dauer, text, intern] of eintraege) {
    await page.getByRole("button", { name: "Neuer Eintrag" }).click();
    const neu = page.getByRole("form", { name: "Neuer Eintrag" });
    await neu.getByLabel("Kunde").selectOption({ label: "Rheinpixel GmbH" });
    await neu.getByLabel("Dauer", { exact: true }).fill(dauer);
    await neu.getByLabel(/Stundensatz/).fill("95");
    await neu.getByLabel(/Tätigkeit/).fill(text);
    if (intern) await neu.getByLabel(/Nicht abrechenbar/).check();
    await neu.getByRole("button", { name: "Anlegen" }).click();
    await expect(page.getByText("Eintrag angelegt.")).toBeVisible();
  }

  await page.getByRole("button", { name: "Abrechnen", exact: true }).click();
  const abrechnen = page.getByRole("form", { name: "Leistungen abrechnen" });
  await abrechnen.getByLabel("Kunde").selectOption({ label: "Rheinpixel GmbH" });
  await abrechnen.getByLabel("Von").fill("2020-01-01");
  await abrechnen.getByLabel("Bis").fill("2099-12-31");
  // Vorschau: die abrechenbaren Einträge, ohne den internen; 3,5 Std. zu 95,00 € = 332,50 €
  await expect(abrechnen).toContainText("2 Einträge, 3:30 Std., zusammen 332,50");
  await abrechnen.getByRole("button", { name: "Rechnungsentwurf anlegen" }).click();

  // Der Entwurf zeigt, aus welchen Einträgen er entstanden ist
  await expect(page).toHaveURL(/\/rechnungen\/[0-9a-f-]{36}/);
  const nachweis = page.getByRole("region", { name: "Enthaltene Leistungen" });
  await expect(nachweis).toContainText("Konzept Datenmodell");
  await expect(nachweis).toContainText("Entwicklung Warenkorb");
  await expect(nachweis).not.toContainText("Interne Abstimmung");

  // Zurück in der Liste: abgerechnete Einträge sind verknüpft und nicht mehr änderbar, der interne bleibt offen
  await go("/leistungen");
  const liste = page.getByRole("region", { name: "Leistungsliste" });
  await expect(liste.getByRole("link", { name: "Rechnungsentwurf" })).toHaveCount(2);
  const zeile = (text: string) => liste.locator(".table-row").filter({ hasText: text });
  await expect(zeile("Konzept Datenmodell").getByRole("button", { name: /bearbeiten/ })).toBeDisabled();
  await expect(zeile("Konzept Datenmodell").getByRole("button", { name: /löschen/ })).toBeDisabled();
  await expect(zeile("Interne Abstimmung").getByRole("button", { name: /bearbeiten/ })).toBeEnabled();
  await page.getByRole("group", { name: "Filter" }).getByLabel("Stand").selectOption("abgerechnet");
  await expect(liste).toContainText("Konzept Datenmodell");
  await expect(liste).not.toContainText("Interne Abstimmung");

  // Ein zweites Abrechnen findet nichts mehr
  await page.getByRole("button", { name: "Abrechnen", exact: true }).click();
  const noch = page.getByRole("form", { name: "Leistungen abrechnen" });
  await noch.getByLabel("Kunde").selectOption({ label: "Rheinpixel GmbH" });
  await noch.getByLabel("Von").fill("2020-01-01");
  await noch.getByLabel("Bis").fill("2099-12-31");
  await expect(noch).toContainText("keine offenen, abrechenbaren Einträge");
  await expect(noch.getByRole("button", { name: "Rechnungsentwurf anlegen" })).toBeDisabled();
});

test("Keine Fehler im Browser", async () => {
  expect(pageErrors).toEqual([]);
});
