import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { day, firstLink, YEAR } from "./daten.ts";
import { CUSTOMERS, durchlaufSeite, einrichten, gehe, INVOICES, kontaktAnlegen, ohneAxeVerstoesse, receiptJpeg, rechnungFestschreiben } from "./einrichtung.ts";

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

test("Kunden im Rechnungsentwurf anlegen, ohne die Eingaben zu verlieren (#330)", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Beschreibung Position 1").fill("Workshop Barrierefreiheit");
  const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
  await page.getByRole("button", { name: "Neuen Kontakt anlegen" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Kunde", { exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Lieferant", { exact: true })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Workshop Barrierefreiheit");

  await page.getByRole("button", { name: "Neuen Kontakt anlegen" }).click();
  await dialog.getByLabel("Name oder Firma").fill("Dialogkunde GmbH");
  await dialog.getByLabel("Ort").fill("Bremen");
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Kunde")).toHaveValue(/[0-9a-f-]{36}/);
  await expect(page.getByLabel("Kunde").locator("option:checked")).toHaveText("Dialogkunde GmbH · Bremen");
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Workshop Barrierefreiheit");

  // Nicht speichern; den Kunden archivieren, damit die folgenden Tests mit den bisherigen Kunden rechnen
  await go("/kontakte");
  await page.getByRole("link", { name: /Dialogkunde GmbH/ }).click();
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
  await page.getByLabel("Aus dem Artikelkatalog einfügen").selectOption({ label: "B-01 · Beratung Softwarearchitektur · 110,00\u00a0€/Std." });
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Beratung Softwarearchitektur");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("110,00");
  await expect(page.getByLabel("Beschreibung Position 2")).toHaveCount(0);
  // Bereits im Katalog: nicht noch einmal speichern
  await expect(page.getByRole("button", { name: "Position 1 als Artikel speichern" })).toBeDisabled();

  // Vorschlag aus dem Katalog beim Tippen: die Bezeichnung übernimmt Einheit und Preis
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 2").fill("Beratung Softwarearchitektur");
  await expect(page.getByLabel(/Einzelpreis Position 2/)).toHaveValue("110,00");

  // Eine neue Position als Artikel speichern; danach steht sie im Katalog
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
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
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
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

test("Angebot mit Rabatt, Wahlpositionen und Zahlungsplan: Abschlag per Klick aus dem Plan", async () => {
  await go("/angebote/neu");
  await page.getByLabel("Kunde").selectOption({ index: 1 });
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
  await expect(vorschau.getByRole("table", { name: "Zahlungsplan" })).toContainText("2. Abschlag");
  await plan.getByLabel("Zahlungsplan auch in der Auftragsbestätigung").check();
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await page.getByRole("button", { name: "Jetzt festschreiben" }).click();
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
  await page.getByRole("button", { name: "Entwurf endgültig löschen" }).click();
  await page.waitForURL(/\/rechnungen$/);
});

test("Rechnung mit Positions- und Gesamtrabatt in der Vorschau", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Kunde").selectOption({ index: 1 });
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

test("Keine Fehler im Browser", async () => {
  expect(pageErrors).toEqual([]);
});
