import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { zipSync } from "fflate";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { currentDay, currentYear, day, EIGENE_SEITE, fakeEigeneSeite, SESSION, YEAR } from "./daten.ts";
import { databaseUrlFuer } from "./durchlaeufe.ts";
import {
  bestaetigen,
  faktenZeigen,
  CUSTOMERS,
  dkb,
  durchlaufSeite,
  einrichten,
  gehe,
  INVOICES,
  kontaktAnlegen,
  kundeWaehlen,
  receiptJpeg,
  rechnungFestschreiben,
  lieferantWaehlen,
} from "./einrichtung.ts";

/**
 * Ein Durchlauf wie im echten Betrieb, in einer leeren Datenbank: Konto einrichten, Kunden anlegen,
 * Rechnungen schreiben, einen Beleg buchen, den Kontoauszug importieren und zuordnen. Danach müssen
 * Buchungen und Konten stimmen. Dazu, was die Tests im Projekt „mit-daten“ (playwright.config.ts) vorfinden
 * müssen: Auftragsarchiv, eigene Seite, Mitarbeiter, Dauerbeleg. Zum Schluss speichert der Test die Sitzung
 * (SESSION); mit ihr und diesen Daten laufen danach die Tests im Projekt „mit-daten“ parallel. Was diese Daten
 * nicht braucht, spielen rechnungen.spec.ts und belege-steuern.spec.ts mit eigenem Server daneben durch.
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

test("Einrichtung: Konto, Firmendaten und Rechnungsnummer", async () => {
  await einrichten(page);
  const firma = page.getByRole("form", { name: "Firmendaten" });

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

  await go("/einstellungen?bereich=gestaltung");
  const logo = page.getByRole("region", { name: "Logo und Blatt" });
  await logo.getByLabel("Logodatei").setInputFiles("public/icon-192.png");
  await expect(logo.getByRole("status")).toContainText("Logo gespeichert.");
  await expect(logo.getByRole("img", { name: "Aktuelles Logo" })).toBeVisible();

  await go("/einstellungen?bereich=rechnungen");
  const format = page.getByRole("form", { name: "Nummernformat" });
  const rechnungen = format.getByRole("group", { name: "Rechnungen" });
  await rechnungen.getByLabel("Format").fill("RE-{NNN}");
  await expect(format.getByText(/braucht das Jahr/)).toBeVisible();
  await expect(format.getByRole("button", { name: "Format speichern" })).toBeDisabled();
  // Läuft der Zähler weiter, ist das Jahr frei; das Beispiel zeigt den Jahreswechsel (#328)
  await rechnungen.getByLabel("Zähler").selectOption({ label: "läuft weiter" });
  await expect(format).toContainText("Beispiel: RE-412, RE-413");
  await rechnungen.getByLabel("Zähler").selectOption({ label: "beginnt jedes Jahr neu" });
  await rechnungen.getByLabel("Format").fill("RE-{JJJJ}-{MM}-{NNNN}");
  await expect(format).toContainText(/Beispiel: RE-\d{4}-\d{2}-0001, RE-\d{4}-\d{2}-0002/);
  await format.getByRole("button", { name: "Format speichern" }).click();
  await expect(format.getByRole("status")).toContainText("Nummernformat gespeichert.");
  await expect(page.getByRole("form", { name: /^Rechnungsnummern/ })).toContainText(/Nächste Nummer: RE-\d{4}-\d{2}-0001/);
  await expect(page.getByRole("form", { name: /^Angebotsnummern/ })).toContainText(/Nächste Nummer: AN-\d{4}-001/);
  // Die folgenden Tests rechnen mit den Nummern ab Werk
  await format.getByRole("button", { name: "Auf Standard zurücksetzen" }).click();
  await expect(rechnungen.getByLabel("Format")).toHaveValue("{JJJJ}-{NNN}");
  await expect(rechnungen.getByLabel("Zähler")).toHaveValue("jaehrlich");

  await go("/einstellungen?bereich=gestaltung");
  const akzent = page.getByRole("form", { name: "Akzentfarbe" });
  await akzent.getByLabel("Hex-Wert").fill("#F5D90A");
  await expect(akzent.getByRole("status")).toContainText("schwer zu lesen");
  await akzent.getByLabel("Hex-Wert").fill("#1d4ed8");
  await akzent.getByRole("button", { name: "Übernehmen" }).click();
  await expect(akzent.getByRole("status")).toContainText("Akzentfarbe gespeichert.");
  await expect(akzent.getByLabel("Hex-Wert")).toHaveValue("#1D4ED8");
  // Das Zeichen in der Navigation hängt nicht an der Beleggestaltung (#504): das „H“ bleibt in der Farbe des Themes
  const marke = nav.locator(".brand-mark");
  await expect(marke).toHaveCSS("background-color", "rgb(63, 162, 132)");
  // Das „H“ des Themes hebt sich ohnehin ab und hat keine Innenkante
  await expect(marke).toHaveCSS("box-shadow", "none");
  // Die Vorschau im Editor übernimmt Akzentfarbe und Grautöne (#222): Text #191F27 statt des grünlichen #16211C
  await go("/rechnungen/neu");
  const vorschau = page.getByLabel("Vorschau der Rechnung");
  const blatt = () =>
    vorschau
      .locator(".sheet-page img")
      .first()
      .evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text());
  await expect.poll(blatt).toContain('fill="#191f27"');
  await go("/einstellungen?bereich=gestaltung");
  await akzent.getByRole("button", { name: "Auf Standard zurücksetzen" }).click();
  await expect(akzent.getByLabel("Hex-Wert")).toHaveValue("#1F6F5C");

  // Eigenes Zeichen der Firma (#504): „H“ in eigener Farbe, Schrift nach dem höheren Kontrast
  await go("/einstellungen");
  const zeichen = page.getByRole("form", { name: "Zeichen in der Navigation" });
  const zeichenSpeichern = async () => {
    await zeichen.getByRole("button", { name: "Übernehmen" }).click();
    await expect(zeichen.getByRole("status")).toContainText("Zeichen gespeichert.");
  };
  await zeichen.getByLabel("„H“ in eigener Farbe").check();
  await zeichen.getByLabel("Hex-Wert").fill("#b5462f");
  await zeichenSpeichern();
  await expect(marke).toHaveCSS("background-color", "rgb(181, 70, 47)");
  await expect(marke).toHaveCSS("color", "rgb(255, 255, 255)");
  // #B5462F hebt sich in allen Themes mit 3 : 1 ab: keine Kante. Eine dunkle Farbe bekommt eine helle Innenkante
  await expect(marke).toHaveCSS("box-shadow", "none");
  await zeichen.getByLabel("Hex-Wert").fill("#24323a");
  await zeichenSpeichern();
  await expect(marke).toHaveCSS("background-color", "rgb(36, 50, 58)");
  await expect(marke).toHaveCSS("box-shadow", /inset/);
  // Zurück zu #B5462F, das die folgenden Schritte als eigene Farbe erwarten
  await zeichen.getByLabel("Hex-Wert").fill("#b5462f");
  await zeichenSpeichern();
  await expect(marke).toHaveCSS("box-shadow", "none");
  // Das Logo der Belege nur auf ausdrückliche Wahl; statt des „H“ steht dann das Bild, auf Weiß
  await zeichen.getByLabel("Logo aus der Beleggestaltung").check();
  await zeichenSpeichern();
  const logoZeichen = nav.locator("img.brand-logo");
  await expect(logoZeichen).toBeVisible();
  await expect.poll(() => logoZeichen.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await expect(marke).toHaveCount(0);
  // Fest 40 × 40 wie das „H“, und das Bild kommt aus dem Cache: Die Adresse ändert sich mit dem Logo (?v=…)
  expect(await logoZeichen.boundingBox()).toMatchObject({ width: 40, height: 40 });
  const kennzeichen = await page.request.get((await logoZeichen.getAttribute("src"))!);
  expect(kennzeichen.status()).toBe(200);
  expect(kennzeichen.headers()["cache-control"]).toBe("private, max-age=31536000, immutable");
  // Das Bild hat kein alt: Der Name des Links bleibt „Haben“ und der Firmenname (#599), ohne Text aus dem Logo
  await expect(nav.getByRole("link", { name: "Haben Mustermann IT · Max Mustermann", exact: true })).toBeVisible();
  // Wechselt das Logo im Gestaltungs-Panel des Editors, zieht die Navigation sofort nach, ohne Neuladen und ohne
  // Seitenwechsel: ein neues Logo hat eine neue Adresse, ohne Logo gilt wieder die eigene Farbe
  const logoVorher = await logoZeichen.getAttribute("src");
  await go("/rechnungen/neu");
  const gestaltungKnopf = page.getByRole("button", { name: "Gestaltung" }).first();
  if (!(await gestaltungKnopf.isVisible())) await page.locator(".main > .page-head").getByRole("button", { name: "Vorschau", exact: true }).click();
  await gestaltungKnopf.click();
  const vorschauDialog = page.getByRole("dialog", { name: "Vorschau" });
  const gestaltung = vorschauDialog.getByRole("complementary", { name: "Gestaltung" });
  await gestaltung.getByLabel("Logodatei").setInputFiles("public/icon-512.png");
  await expect(gestaltung.getByRole("status")).toContainText("Logo gespeichert");
  await expect(logoZeichen).toHaveAttribute("src", /\/api\/kennzeichen\?v=/);
  await expect(logoZeichen).not.toHaveAttribute("src", logoVorher!);
  await gestaltung.getByRole("button", { name: "Entfernen" }).click();
  await expect(logoZeichen).toHaveCount(0);
  await expect(marke).toHaveCSS("background-color", "rgb(181, 70, 47)");
  // Das Logo aus der Einrichtung wieder herstellen; die Tests im Projekt „mit-daten“ rechnen damit
  await gestaltung.getByLabel("Logodatei").setInputFiles("public/icon-192.png");
  await expect(logoZeichen).toHaveAttribute("src", logoVorher!);
  await vorschauDialog.getByRole("button", { name: "Schließen" }).click();
  await go("/einstellungen");
  // Zurück zum „H“ des Themes; die eigene Farbe bleibt für später gespeichert, die übrigen Tests rechnen mit dem Standard
  await zeichen.getByLabel("„H“ in der Farbe des Themes").check();
  await zeichenSpeichern();
  await expect(marke).toHaveCSS("background-color", "rgb(63, 162, 132)");
  await expect(logoZeichen).toHaveCount(0);
});

test("Kunden anlegen", async () => {
  for (const c of CUSTOMERS) await kontaktAnlegen(page, c);
  await go("/kontakte");
  for (const c of CUSTOMERS) await expect(page.getByText(c.name).first()).toBeVisible();
  // Die Suche filtert die Liste, ohne neu zu laden
  const liste = page.getByRole("region", { name: "Kontaktliste" });
  await page.getByPlaceholder(/^Suchen:/).fill("hamburg");
  await expect(liste.getByRole("link")).toHaveCount(1);
  await expect(liste).toContainText("Nordwerk Software GmbH");
  // Auch nach der Telefonnummer (#322), die unter der E-Mail steht
  await page.getByPlaceholder(/^Suchen:/).fill("123456-0");
  await expect(liste.getByRole("link")).toHaveCount(1);
  await expect(liste).toContainText("+49 40 123456-0");
  await page.getByPlaceholder(/^Suchen:/).fill("gibt es nicht");
  await expect(liste).toContainText("Kein Kontakt passt");
});

test("Lastschriftmandat am Kunden: Gläubiger-ID, Mandat mit PDF anlegen und widerrufen (#445)", async ({ browser }) => {
  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("Gläubiger-ID").fill("DE97ZZZ09999999999");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Die Prüfziffer der Gläubiger-ID stimmt nicht.")).toBeVisible();
  // Test-ID der Bundesbank mit richtiger Prüfziffer
  await firma.getByLabel("Gläubiger-ID").fill("DE98 ZZZ0 9999 9999 99");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();

  await go("/kontakte");
  await page
    .getByRole("region", { name: "Kontaktliste" })
    .getByRole("link", { name: /Rheinpixel GmbH/ })
    .click();
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "SEPA-Lastschriftmandate" });
  await expect(karte).toContainText("Noch kein Mandat.");
  await karte.getByRole("button", { name: "Mandat anlegen" }).click();
  const form = karte.getByRole("form", { name: "Neues Mandat" });
  await form.getByLabel("Mandatsreferenz").fill("RP-2026-01");
  await form.getByLabel("Unterschrieben am").fill(day(-20));
  await form.getByLabel("IBAN").fill("DE02 1203 0000 0000 2020 51");
  // Das offene Formular prüft axe hier, am Desktop und am Handy (WCAG 2.2 AA wie barrierefreiheit.spec.ts)
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const axePage = await context.newPage();
  for (const width of [1440, 320]) {
    await axePage.setViewportSize({ width, height: 900 });
    await axePage.goto(page.url());
    await axePage.waitForLoadState("networkidle");
    await axePage.getByRole("button", { name: "Mandat anlegen" }).click();
    const { violations } = await new AxeBuilder({ page: axePage })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      `Mandatsformular bei ${width} px`,
    ).toEqual([]);
  }
  await context.close();
  await form.getByRole("button", { name: "Mandat speichern" }).click();
  await expect(page.getByText("Mandat angelegt.")).toBeVisible();
  await expect(karte).toContainText("RP-2026-01");
  await expect(karte).toContainText("DE02120300000000202051");
  await expect(karte).toContainText(/Gültig bis/);
  await expect(karte).toContainText("Noch kein PDF");

  await karte
    .getByLabel("PDF hinterlegen: RP-2026-01")
    .setInputFiles({ name: "mandat.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nMandat\n%%EOF") });
  await expect(page.getByText("PDF hinterlegt.")).toBeVisible();
  await expect(karte.getByRole("link", { name: "Mandat als PDF" })).toBeVisible();

  await karte.getByRole("button", { name: "Widerrufen" }).click();
  await faktenZeigen(page, "Mandatsreferenz", "Ab");
  await bestaetigen(page, "Widerrufen");
  await expect(page.getByText("Mandat widerrufen.")).toBeVisible();
  await expect(karte).toContainText(/Widerrufen ab/);
  await expect(karte.getByRole("button", { name: "Widerrufen" })).toHaveCount(0);
});

test("Rechnungen schreiben und festschreiben", async () => {
  for (const invoice of INVOICES) await rechnungFestschreiben(page, invoice);
});

test("Entwurf als PDF: speichert vorher, lädt herunter und vergibt keine Nummer (#342)", async () => {
  await go("/rechnungen/neu");
  const heading = await page.getByRole("heading", { level: 1 }).textContent();
  // Ohne Kunden gibt es noch kein Dokument
  await expect(page.getByRole("button", { name: "Speichern und als PDF" })).toBeDisabled();
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await page.getByLabel("Beschreibung Position 1").fill("Konzept zur Prüfung");
  await page.getByLabel("Menge Position 1").fill("2");
  await page.getByLabel(/Einzelpreis Position 1/).fill("300");

  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Speichern und als PDF" }).click();
  let file = await download;
  expect(file.suggestedFilename()).toMatch(/^Rechnung-Entwurf-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect(
    readFileSync(await file.path())
      .subarray(0, 5)
      .toString(),
  ).toBe("%PDF-");
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");

  // Gespeichert: der Knopf lädt direkt; nach einer Änderung speichert er wieder zuerst
  await expect(page.getByRole("button", { name: "Entwurf als PDF" })).toBeEnabled();
  await page.getByLabel("Menge Position 1").fill("3");
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Speichern und als PDF" }).click();
  file = await download;
  expect(file.suggestedFilename()).toMatch(/^Rechnung-Entwurf-/);
  await expect(page.getByText("Entwurf gespeichert, das PDF ist heruntergeladen.")).toBeVisible();
  // Weiter ein Entwurf mit derselben vorläufigen Nummer: der Download hat keine verbraucht
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading!);
  await expect(page.getByRole("button", { name: "Festschreiben" })).toBeVisible();

  await page.getByRole("button", { name: "Entwurf löschen" }).click();
  await bestaetigen(page, "Entwurf löschen");
  await page.waitForURL(/\/rechnungen$/);
});

test("Mahnung als Entwurf prüfen, bevor sie erstellt wird (#342)", async () => {
  await go("/rechnungen/mahnwesen");
  const offen = await page.getByText("noch nicht gemahnt").count();
  expect(offen).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Zahlungserinnerung", exact: true }).first().click();
  await page.waitForURL(/mahnwesen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Entwurf als PDF" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Zahlungserinnerung-Entwurf-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect(
    readFileSync(await file.path())
      .subarray(0, 5)
      .toString(),
  ).toBe("%PDF-");
  // Nichts gespeichert: jede Rechnung ist weiter „noch nicht gemahnt“
  await go("/rechnungen/mahnwesen");
  await expect(page.getByText("noch nicht gemahnt")).toHaveCount(offen);
});

test("Mahnung: Einleitung und Schluss lassen sich mit den Knöpfen auszeichnen (#359)", async () => {
  await go("/rechnungen/mahnwesen");
  await page.getByRole("link", { name: "Zahlungserinnerung", exact: true }).first().click();
  await page.waitForURL(/mahnwesen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const fett = page.getByRole("button", { name: "Fett", exact: true });
  const kursiv = page.getByRole("button", { name: "Kursiv", exact: true });
  const unterstrichen = page.getByRole("button", { name: "Unterstrichen", exact: true });

  const einleitung = page.getByRole("textbox", { name: "Einleitung", exact: true });
  await einleitung.fill("Bitte zahlen Sie sofort");
  await einleitung.focus();
  await expect(fett).toBeHidden();
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(6, 12));
  await expect(fett).toBeVisible();
  await fett.click();
  await expect(einleitung).toHaveValue("Bitte *zahlen* Sie sofort");
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(19, 25));
  await kursiv.click();
  await expect(einleitung).toHaveValue("Bitte *zahlen* Sie _sofort_");

  const schluss = page.getByRole("textbox", { name: "Schluss", exact: true });
  await schluss.fill("Mit Dank im Voraus");
  await schluss.focus();
  await schluss.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(4, 8));
  await expect(unterstrichen).toBeVisible();
  await unterstrichen.click();
  await expect(schluss).toHaveValue("Mit __Dank__ im Voraus");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(schluss).toHaveValue("Mit *__Dank__* im Voraus");

  // Die Auszeichnungen gehen mit in den Prüfausdruck, gespeichert wird nichts
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Entwurf als PDF" }).click();
  const file = await download;
  expect(
    readFileSync(await file.path())
      .subarray(0, 5)
      .toString(),
  ).toBe("%PDF-");
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
  await lieferantWaehlen(page, "Funknetz Mobil GmbH");
  await expect(page.getByLabel("Lieferant", { exact: true })).toHaveValue("Funknetz Mobil GmbH");
  await page.getByLabel("Rechnungsnummer").fill("MF-0815");
  await page.getByLabel("Belegdatum").fill(day(-9));
  await page.getByLabel("Kategorie").selectOption("telefon");
  await page.getByLabel("Netto", { exact: true }).fill("38,57");
  await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
  await faktenZeigen(page, "Betrag");
  await bestaetigen(page, "Buchen");
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
  expect(xml).toContain(`<ReqdExctnDt><Dt>${currentDay()}</Dt></ReqdExctnDt>`);
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
  await card.getByRole("button", { name: "Speichern" }).click();
  await expect(card.getByRole("status")).toHaveText("Gespeichert.");
  const link = card.getByRole("link", { name: "Buchungsstapel herunterladen" });
  const response = await page.request.get((await link.getAttribute("href"))!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toMatch(/EXTF_Buchungsstapel_\d{4}\.csv/);
  const body = new TextDecoder("latin1").decode(await response.body());
  expect(body.startsWith('"EXTF";700;21;"Buchungsstapel";13;')).toBe(true);
  expect(body).toContain(";29098;55003;");
  // Keine Nummern, die im Belegfeld 1 zusammenfallen: kein Hinweis
  expect(response.headers()["x-haben-hinweis"]).toBeUndefined();

  // Mit Hinweis (#675; welche Nummern zusammenfallen, prüft datev-belegfeld.test.ts): Die Datei kommt, die Karte nennt die Nummern
  const hinweis = "„RE.2026.001“ und „RE-2026-001“ stehen im Belegfeld 1 als „RE-2026-001“; DATEV kann ihre offenen Posten verwechseln.";
  await page.route("**/api/datev/*", async (route) => {
    const original = await route.fetch();
    await route.fulfill({ response: original, headers: { ...original.headers(), "x-haben-hinweis": encodeURIComponent(hinweis) } });
  });
  const download = page.waitForEvent("download");
  await link.click();
  expect((await download).suggestedFilename()).toMatch(/^EXTF_Buchungsstapel_\d{4}\.csv$/);
  await expect(card.getByRole("status")).toHaveText(hinweis);
  await page.unroute("**/api/datev/*");
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

test("Auftragsarchiv: suchen, Original-PDF nachreichen und unverändert herunterladen", async ({ browser }) => {
  const sql = postgres(databaseUrlFuer(), { max: 1 });
  const id = "723bf34b-f8ab-48f0-b391-656af4b72a96";
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'e2e', true)`;
      const [run] = await tx`insert into lexoffice_imports (source, status, progress)
        values ('sevdesk', 'fertig', '{"phase":"fertig","contacts":0,"contactsLinked":0,"listed":1,"imported":1,"skipped":0,"files":0,"failed":[]}') returning id`;
      await tx`insert into legacy_order_documents (id, external_id, import_id, kind, number, date, status, contact_name, currency, net, tax, gross, raw)
        values (${id}, 'e2e-order-1', ${run!.id}, 'AN', 'AN-ARCHIV-1', ${`${YEAR}-06-01`}, '300', 'Archivkunde GmbH', 'EUR', 10000, 1900, 11900,
        '{"order":{},"positions":[{"id":"1","name":"Archivleistung","quantity":"2","price":"50"}],"relatedObjects":[]}')`;
      await tx`insert into legacy_order_pdf_attempts (order_id, bookkeeping_version, "before", "after", error)
        values (${id}, '1.0', '{"status":"300"}', '{"status":"300"}', 'Original-PDF war beim Abruf nicht verfügbar.')`;
    });
  } finally {
    await sql.end();
  }
  await go(`/archiv?ansicht=auftraege&jahr=${YEAR}`);
  await page.getByLabel("Nummer oder Kontakt").fill("AN-ARCHIV-1");
  await page.getByRole("button", { name: "Suchen", exact: true }).click();
  await page.getByRole("link", { name: "AN-ARCHIV-1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AN-ARCHIV-1" })).toBeVisible();
  await expect(page.getByText("Archivleistung")).toBeVisible();
  await expect(page.getByText("Abgelehnt", { exact: true })).toBeVisible();
  const attempts = page.getByRole("region", { name: "PDF-Abrufprotokoll" });
  await attempts.getByText(/Buchhaltungsversion 1.0/).click();
  await expect(attempts.locator("pre")).toContainText('"status": "300"');
  await attempts.getByText(/Buchhaltungsversion 1.0/).click();
  const preview = await browser.newPage();
  await preview.setContent("<h1>Beispielangebot AN-ARCHIV-1</h1><p>Archivkunde GmbH</p><p>Archivleistung: 2 Stück, 100,00 EUR netto, 119,00 EUR brutto</p>");
  const pdf = await preview.pdf({ format: "A4" });
  await preview.close();
  await page.getByLabel("Original-PDF ergänzen").setInputFiles({ name: "Originalangebot.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "PDF anhängen" }).click();
  const download = page.getByRole("link", { name: "PDF herunterladen" });
  await expect(download).toBeVisible();
  const response = await page.request.get((await download.getAttribute("href"))!);
  expect(response.status()).toBe(200);
  expect(await response.body()).toEqual(pdf);
  await expect(page.getByText(/Manuell nachgereicht/)).toBeVisible();
  await go(`/archiv?ansicht=auftraege&jahr=${YEAR}`);
  await expect(page.getByRole("row").filter({ hasText: "AN-ARCHIV-1" })).toContainText("1 vorhanden");
});

// #472: Gutschrift auf ein Buchungskonto aus sevDesk folgt dem Kontostamm; ohne erkannte Kontoart markiert Haben sie. Die Daten
// stehen in 2019 und werden danach wieder entfernt, damit spätere Tests und Bilder das Archiv wie vorher sehen.
test("sevDesk-Gutschrift auf Buchungskonto: Ausgabe-Gutschrift oder Hinweis „Buchungskonto nicht erkannt“", async ({ browser }) => {
  const sql = postgres(databaseUrlFuer(), { max: 1 });
  const note = (id: string, accountingTypeId: string) => ({
    id,
    bookingCategory: "ACCOUNTING_TYPE",
    accountingType: { id: accountingTypeId, objectName: "AccountingType" },
  });
  let runId = "";
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'e2e', true)`;
      const [run] = await tx`insert into lexoffice_imports (source, status, progress)
        values ('sevdesk', 'fertig', '{"phase":"fertig","contacts":0,"contactsLinked":0,"listed":2,"imported":2,"skipped":0,"files":0,"failed":[]}') returning id`;
      runId = run!.id as string;
      await tx`insert into sevdesk_accounting_types (import_id, accounting_type_id, raw)
        values (${runId}, 'E2E-1', '{"id":"E2E-1","objectName":"AccountingType","skr03":"3100","skr04":"5900"}')`;
      for (const [id, number, accountingTypeId] of [
        ["901", "GS-E2E-1", "E2E-1"],
        ["902", "GS-E2E-2", "E2E-2"],
      ])
        await tx`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
          values (${`creditnote/${id}`}, 'sevdesk', ${runId}, 'creditnote', 'einnahme', ${number}, '2019-03-10', 'open', 'Erfundene Agentur', -10000, -1900, -11900,
          '[{"rate":1900,"net":-10000,"tax":-1900}]', '[]', '{"status":"open","openAmount":-11900,"paidDate":null,"items":[]}', ${tx.json(note(id!, accountingTypeId!))})`;
    });
    await go("/archiv?ansicht=belege&jahr=2019");
    await expect(page.getByRole("link", { name: /GS-E2E-1/ })).toContainText("Ausgabe-Gutschrift");
    await expect(page.getByRole("link", { name: /GS-E2E-1/ })).not.toContainText("Buchungskonto nicht erkannt");
    await expect(page.getByRole("link", { name: /GS-E2E-2/ })).toContainText("Buchungskonto nicht erkannt");
    await page.getByRole("link", { name: /GS-E2E-2/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "GS-E2E-2" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Buchungskonto nicht erkannt" })).toContainText("„Erneut abrufen“");
    // Markierung und Hinweis prüft axe am Desktop und am Handy (WCAG 2.2 AA wie barrierefreiheit.spec.ts)
    const context = await browser.newContext({ storageState: await page.context().storageState() });
    const axePage = await context.newPage();
    for (const url of ["/archiv?ansicht=belege&jahr=2019", page.url()])
      for (const width of [1440, 390]) {
        await axePage.setViewportSize({ width, height: 900 });
        await axePage.goto(new URL(url, page.url()).toString());
        await axePage.waitForLoadState("networkidle");
        const { violations } = await new AxeBuilder({ page: axePage })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
          .analyze();
        expect(
          violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
          `${url} bei ${width} px`,
        ).toEqual([]);
      }
    await context.close();
  } finally {
    if (runId)
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`delete from sevdesk_accounting_types where import_id = ${runId}`;
        await tx`delete from lexoffice_vouchers where import_id = ${runId}`;
        await tx`delete from lexoffice_imports where id = ${runId}`;
      });
    await sql.end();
  }
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
  await page.getByRole("button", { name: "Abholung entfernen" }).click();
  await bestaetigen(page, "Entfernen");
  await expect(page.getByText("Seite entfernt.")).toBeVisible();

  // #636: Eine Seite, die das Einbetten verbietet, erkennt Haben nach der Eingabe und öffnet sie auf Wunsch in einem neuen
  // Tab. Haben selbst unter 127.0.0.1 ist eine andere Herkunft und schickt frame-ancestors 'self'
  const verboten = new URL("/login", page.url());
  verboten.hostname = "127.0.0.1";
  await form.getByLabel("Name im Menü").fill("Paperless");
  await form.getByLabel("Adresse").fill(verboten.href);
  await expect(form.getByLabel("Öffnen")).toHaveValue("haben");
  await expect(form.getByRole("status")).toContainText("Diese Seite verbietet das Einbetten (Content-Security-Policy: frame-ancestors)");
  await form.getByLabel("Öffnen").selectOption({ label: "In neuem Tab" });
  await expect(form.getByRole("status")).toHaveCount(0);
  await form.getByRole("button", { name: "Seite hinzufügen" }).click();
  const paperless = menu.getByRole("link", { name: /^Paperless/ });
  await expect(paperless).toHaveAttribute("href", verboten.href);
  await expect(paperless).toHaveAttribute("target", "_blank");
  // Das Symbol zeigt, wohin der Eintrag führt: neuer Tab oder im Rahmen neben dem Menü
  await expect(paperless.locator("svg")).toHaveAttribute("data-icon", "external");
  await expect(menu.getByRole("link", { name: EIGENE_SEITE.name }).locator("svg")).toHaveAttribute("data-icon", "embed");
  // Danach ist das Formular wieder leer, mit der Vorgabe „In Haben“
  await expect(form.getByLabel("Adresse")).toHaveValue("");
  await expect(form.getByLabel("Öffnen")).toHaveValue("haben");
  await expect(paperless).toHaveAccessibleName("Paperless (öffnet in neuem Tab)");
  await expect(page.getByText("Öffnet in neuem Tab")).toBeVisible();
  await page.getByRole("button", { name: "Paperless bearbeiten" }).click();
  await expect(page.getByRole("form", { name: "Paperless bearbeiten" }).getByLabel("Öffnen")).toHaveValue("tab");
  await page.getByRole("button", { name: "Paperless entfernen" }).click();
  await bestaetigen(page, "Entfernen");
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
  await form.getByLabel("Eintritt", { exact: true }).fill(`${currentYear()}-01-01`);
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

test("Dauerbeleg: Miete mit Vertrag anlegen, Beleg zu prüfen, im Bankabgleich buchen und zuordnen", async () => {
  const termin = day(-4);
  await go("/dauerbelege");
  await page.getByRole("link", { name: "Neuer Dauerbeleg" }).click();
  await page.waitForURL(/\/dauerbelege\/neu$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Bezeichnung").fill("Büromiete Hafenstraße");
  await page.getByLabel("Lieferant", { exact: true }).fill("Hafen Immobilien GmbH");
  await page.getByLabel("Vertrags- oder Kundennummer (optional)").fill("MV-2026-17");
  // Eigene Kategorie für Miete (#312): DATEV 4210 bzw. 6310
  await page.getByLabel("Kategorie").selectOption({ label: "Miete für Geschäftsräume" });
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
  await expect(page.getByRole("link", { name: /Büromiete Hafenstraße/ })).toContainText("Miete für Geschäftsräume");
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
