import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

/**
 * Eine GmbH in eigener, leerer Datenbank (Projekt „gmbh“ in playwright.config.ts, eigener Server): einrichten mit
 * Rechtsform und SKR04, dann was nur eine Kapitalgesellschaft hat, etwa manuelle Buchungen. Der Durchlauf in
 * app.spec.ts ist ein Einzelunternehmen; die Rechtsform ist ab der ersten Buchung fest.
 */

test.describe.configure({ mode: "serial" });

const SETUP_CODE = "e2e-einrichtungscode";
const USER = { name: "Erika Gesellschafter", email: "erika@example.com", password: "ein-sehr-langes-gmbh-passwort" };
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  // axe braucht einen eigenen Kontext, nicht browser.newPage()
  page = await (await browser.newContext()).newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
});

test.afterAll(async () => {
  expect(pageErrors).toEqual([]);
  await page.context().close();
});

async function go(path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function axe() {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${v.help} → ${n.target.join(" ")}`));
}

test("Einrichtung als GmbH mit SKR04", async () => {
  await go("/");
  await page.getByLabel("Einrichtungscode").fill(SETUP_CODE);
  await page.getByLabel("Name").fill(USER.name);
  await page.getByLabel("E-Mail").fill(USER.email);
  await page.getByLabel(/Passwort/).fill(USER.password);
  await page.getByRole("button", { name: "Konto anlegen" }).click();
  await page.getByRole("button", { name: "Später" }).click();
  await page.waitForURL("**/einstellungen");
  await page.waitForLoadState("networkidle");

  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("Name", { exact: true }).fill("Nordlicht Software GmbH");
  await firma.getByLabel("E-Mail", { exact: true }).fill("rechnung@nordlicht.example");
  await firma.getByLabel("Straße und Hausnummer").fill("Hafenallee 3");
  await firma.getByLabel("PLZ").fill("28217");
  await firma.getByLabel("Ort").fill("Bremen");
  await firma.getByLabel("Bundesland").selectOption("HB");
  await firma.getByLabel(/^Steuernummer/).fill("60/145/12345");
  await firma.getByLabel("IBAN").fill("DE89370400440532013000");
  await firma.getByLabel("Rechtsform").selectOption("gmbh");
  await firma.getByLabel(/^Kontenrahmen/).selectOption("SKR04");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByRole("link", { name: "Pauschalen" })).toHaveCount(0);
  await go(`/jahreserklaerung/${new Date().getFullYear() - 1}`);
  await expect(page.getByRole("heading", { name: /^Umsatzsteuererklärung/ }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Anlage EÜR/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Einkommensteuererklärung/ })).toHaveCount(0);
});

test("Manuelle Buchung: Stammkapital erfassen, prüfen, stornieren", async () => {
  await go("/buchungen");
  await page.getByRole("link", { name: "Buchung erfassen" }).click();
  await page.waitForURL("**/buchungen/neu");
  await page.waitForLoadState("networkidle");
  expect(await axe(), "/buchungen/neu").toEqual([]);

  const form = page.getByRole("form", { name: "Manuelle Buchung" });
  await form.getByLabel("Buchungstext").fill("Stammkapital, eingezahlt vom Gesellschafter");
  // Die Bank führt der Bankabgleich; das Formular sagt es, bevor gebucht wird
  await form.getByLabel("Konto Zeile 1").fill("1800");
  await form.getByLabel("Soll Zeile 1").fill("25.000,00");
  await expect(form.getByRole("status", { name: "Noch nicht buchbar" })).toContainText("Konto 1800 führt das Nebenbuch Bank");
  await expect(form.getByRole("button", { name: "Buchen" })).toBeDisabled();

  await form.getByLabel("Konto Zeile 1").fill("3510");
  await expect(form).toContainText("Verbindlichkeiten gegenüber Gesellschaftern");
  await form.getByLabel("Konto Zeile 2").fill("2900");
  await form.getByLabel("Haben Zeile 2").fill("20.000,00");
  await expect(form).toContainText("Differenz 5.000,00");
  await form.getByRole("button", { name: "Zeile hinzufügen" }).click();
  await form.getByLabel("Konto Zeile 3").fill("2900");
  await form.getByLabel("Haben Zeile 3").fill("5.000,00");
  await form.getByRole("button", { name: "Zeile 3 entfernen" }).click();
  await form.getByLabel("Haben Zeile 2").fill("25.000,00");
  await form.getByRole("button", { name: "Buchen" }).click();

  await page.waitForURL(/\/buchungen\?/);
  const journal = page.getByRole("region", { name: "Buchungen" });
  const row = journal.getByRole("row").filter({ hasText: "Stammkapital, eingezahlt vom Gesellschafter", hasNotText: "Storno:" });
  await expect(row).toContainText("Manuell");
  await expect(row).toContainText("3510");
  await expect(row).toContainText("2900");
  await expect(row).toContainText("25.000,00");
  expect(await axe(), "/buchungen").toEqual([]);

  await row.getByRole("button", { name: "Buchungszeilen anzeigen" }).click();
  const storno = journal.getByRole("button", { name: "Stammkapital, eingezahlt vom Gesellschafter stornieren" });
  await storno.click();
  await expect(storno).toHaveText("Jetzt stornieren");
  await storno.click();
  await expect(page.getByText("Storniert: Stammkapital, eingezahlt vom Gesellschafter")).toBeVisible();
  await expect(journal.getByRole("row").filter({ hasText: "Storno: Stammkapital" })).toContainText("Gegenbuchung");
  await expect(row).toContainText("storniert");
});

test("Eröffnungsbuchung: Bestände zum 1. Januar, in der Saldenliste als Eröffnung", async () => {
  const year = new Date().getFullYear();
  await go("/buchungen/neu");
  const form = page.getByRole("form", { name: "Manuelle Buchung" });
  await form.getByLabel("Eröffnungsbuchung").check();
  await expect(form.getByLabel("Datum")).toHaveValue(`${year}-01-01`);
  await form.getByLabel("Buchungstext").fill("Eröffnungsbilanz");
  // In der Eröffnung sind Bank und 9000 erlaubt, Erfolgskonten nicht
  await form.getByLabel("Konto Zeile 1").fill("6300");
  await form.getByLabel("Soll Zeile 1").fill("100,00");
  await expect(form.getByRole("status", { name: "Noch nicht buchbar" })).toContainText("Erfolgskonto");
  await form.getByLabel("Konto Zeile 1").fill("1800");
  await form.getByLabel("Soll Zeile 1").fill("40.000,00");
  await form.getByLabel("Konto Zeile 2").fill("9000");
  await form.getByLabel("Haben Zeile 2").fill("40.000,00");
  await form.getByRole("button", { name: "Buchen" }).click();
  await page.waitForURL(/\/buchungen\?/);
  await expect(page.getByRole("region", { name: "Buchungen" }).getByRole("row").filter({ hasText: "Eröffnungsbilanz" })).toContainText("Eröffnung");

  await go(`/konten?jahr=${year}`);
  const liste = page.getByRole("region", { name: "Saldenliste" });
  await expect(liste.getByRole("columnheader", { name: "Eröffnung" })).toBeVisible();
  await expect(liste.getByRole("row").filter({ hasText: "1800" }).first()).toContainText("40.000,00");
  await expect(page.getByText("Eröffnung = Saldenvortrag aus den Vorjahren")).toBeVisible();
  expect(await axe(), "/konten").toEqual([]);
});

test("Jahresabschluss: Bilanz und GuV der Kleinst-GmbH, Vorjahr abschließen", async () => {
  const year = new Date().getFullYear();
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await go("/");
  await nav.getByRole("link", { name: "Jahresabschluss" }).click();
  await page.waitForURL(`**/abschluss/${year - 1}`);
  await page.waitForLoadState("networkidle");

  await go(`/abschluss/${year}`);
  await expect(page.getByRole("note")).toContainText("Entwurf für die Steuerberatung");
  await expect(page.getByRole("region", { name: "Offene Punkte" })).toContainText(`Das Jahr ${year} ist noch nicht vorbei.`);
  const aktiva = page.getByRole("region", { name: `Aktiva zum 31.12.${year}` });
  await expect(aktiva.getByRole("row", { name: /B\. Umlaufvermögen/ })).toContainText("40.000,00");
  await aktiva.getByRole("button", { name: /B\. Umlaufvermögen/ }).click();
  await expect(aktiva.getByRole("link", { name: "1800" })).toBeVisible();
  await expect(page.getByRole("region", { name: `Passiva zum 31.12.${year}` })).toContainText("Summe Passiva");
  await expect(page.getByRole("region", { name: /Gewinn- und Verlustrechnung/ })).toContainText("1. Umsatzerlöse");
  await expect(page.getByRole("button", { name: `${year} abschließen` })).toBeDisabled();

  // Körperschaft- und Gewerbesteuer: Hebesatz speichern, dann rechnet die Seite
  const steuern = page.getByRole("form", { name: "Angaben zur Körperschaft- und Gewerbesteuer" });
  await steuern.getByLabel("Hebesatz der Gemeinde (%)").fill("400");
  await steuern.getByRole("button", { name: "Angaben speichern" }).click();
  await expect(page.getByText("Angaben gespeichert.")).toBeVisible();
  const rechnung = page.getByRole("region", { name: `Körperschaft- und Gewerbesteuer ${year}` });
  await expect(rechnung.getByRole("row", { name: /Zu versteuerndes Einkommen/ })).toContainText("0,00");
  await expect(rechnung.getByRole("row", { name: /Gewerbesteuer \(Hebesatz 400 %\)/ })).toBeVisible();
  expect(await axe(), `/abschluss/${year}`).toEqual([]);

  // Das Vorjahr ist leer und vorbei: abschließen mit Rückfrage
  await go(`/abschluss/${year - 1}`);
  const close = page.getByRole("button", { name: `${year - 1} abschließen` });
  await close.click();
  await page.getByRole("button", { name: `Jetzt ${year - 1} endgültig abschließen` }).click();
  await expect(page.getByText(`Das Jahr ${year - 1} ist abgeschlossen.`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Jahr abschließen" })).toContainText("Die Buchungen sind seitdem unverändert.");

  // E-Bilanz des abgeschlossenen Jahres: prüfen (ERiC simuliert), im Verlauf
  const ebilanz = page.getByRole("region", { name: `E-Bilanz ${year - 1}` });
  await expect(ebilanz).toContainText("HGB-Taxonomie 6.9");
  await page.getByRole("form", { name: "E-Bilanz übermitteln" }).getByRole("button", { name: "Nur prüfen" }).click();
  await expect(page.getByText("ERiC hat die Daten geprüft, keine Fehler.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Verlauf der E-Bilanz" })).toContainText("Prüfung");
  expect(await axe(), `/abschluss/${year - 1}`).toEqual([]);
});

test("Hinterlegung: Registerangaben in den Firmendaten, Bilanz des Vorjahres als PDF", async () => {
  const year = new Date().getFullYear();
  const regionName = (y: number) => `Hinterlegung beim Unternehmensregister ${y}`;

  // Das laufende Jahr ist nicht vorbei; ein altes, nicht abgeschlossenes Jahr zeigt Hinweis und abgelaufene Frist
  await go(`/abschluss/${year}`);
  await expect(page.getByRole("region", { name: regionName(year) })).toHaveCount(0);
  await go(`/abschluss/${year - 2}`);
  const alt = page.getByRole("region", { name: regionName(year - 2) });
  await expect(alt).toContainText(`Das Jahr ${year - 2} ist noch nicht abgeschlossen.`);
  await expect(alt).toContainText(`Die Frist ist am 31.12.${year - 1} abgelaufen`);

  // Ohne Registergericht und Registernummer gibt es keine Datei
  await go(`/abschluss/${year - 1}`);
  const region = page.getByRole("region", { name: regionName(year - 1) });
  await expect(region).toContainText(`Frist: bis 31.12.${year}`);
  await expect(region).toContainText("Das Registergericht fehlt in den Firmendaten.");
  await expect(region.getByRole("button", { name: "Bilanz als PDF herunterladen" })).toBeDisabled();

  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await expect(firma.getByRole("textbox", { name: /^Sitz/ })).toHaveAttribute("placeholder", "Bremen");
  await firma.getByLabel("Registergericht").fill("Amtsgericht Bremen");
  await firma.getByLabel("Registernummer").fill("HRB 12345 HB");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
  expect(await axe(), "/einstellungen").toEqual([]);

  await go(`/abschluss/${year - 1}`);
  await expect(region).not.toContainText("fehlt in den Firmendaten");
  await expect(region).toContainText("Ohne Vorjahresspalte");
  const form = region.getByRole("form", { name: "Bilanz zur Hinterlegung" });
  await form.getByLabel("Tag der Feststellung").fill(`${year}-01-01`);
  const haftung = form.getByRole("group", { name: /Haftungsverhältnisse/ });
  await expect(haftung.getByLabel("Keine")).toBeChecked();
  await haftung.getByLabel("Ja, folgende").check();
  await haftung.getByLabel(/Angaben, wie sie unter der Bilanz/).fill("Bürgschaft für die Muster KG über 5.000,00 EUR.");
  await expect(form.getByRole("group", { name: /Vorschüsse und Kredite/ }).getByLabel("Keine")).toBeChecked();
  expect(await axe(), `/abschluss/${year - 1} Hinterlegung`).toEqual([]);

  const [download] = await Promise.all([page.waitForEvent("download"), form.getByRole("button", { name: "Bilanz als PDF herunterladen" }).click()]);
  expect(download.suggestedFilename()).toBe(`Bilanz-${year - 1}-Hinterlegung.pdf`);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).subarray(0, 5).toString("latin1")).toBe("%PDF-");
});

test("Jahreserklärung der GmbH: Körperschaft- und Gewerbesteuer, Anteilseigner erfassen", async () => {
  const year = new Date().getFullYear() - 1;
  await go(`/jahreserklaerung/${year}`);
  await expect(page.getByRole("heading", { name: "Körperschaftsteuererklärung", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gewerbesteuererklärung", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Körperschaftsteuererklärung/ }).first()).toContainText("Die Anteilseigner fehlen.");

  const form = page.getByRole("form", { name: "Angaben zur Körperschaft- und Gewerbesteuererklärung" });
  await form.getByRole("button", { name: "Anteilseigner hinzufügen" }).click();
  await form.getByLabel("Name Anteilseigner 1").fill(USER.name);
  await form.getByLabel("Straße und Hausnummer Anteilseigner 1").fill("Hafenallee 3");
  await form.getByLabel("PLZ und Ort Anteilseigner 1").fill("28217 Bremen");
  await form.getByLabel("Identifikationsnummer oder Steuernummer (13 Ziffern) Anteilseigner 1").fill("86095742719");
  await form.getByLabel("Beteiligung in Euro Anteilseigner 1").fill("25.000,00");
  await form.getByLabel("Anteil in Prozent Anteilseigner 1").fill("100");
  await form.getByRole("button", { name: "Angaben speichern" }).click();
  await expect(page.getByText("Angaben gespeichert.")).toBeVisible();
  await expect(page.getByRole("region", { name: /^Körperschaftsteuererklärung/ }).first()).not.toContainText("Die Anteilseigner fehlen.");
  expect(await axe(), `/jahreserklaerung/${year}`).toEqual([]);
});

test("Ausschüttungen: Steuerabzug berechnen, ohne Gewinnvortrag nicht buchbar", async () => {
  const year = new Date().getFullYear();
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await go("/");
  await nav.getByRole("link", { name: "Ausschüttungen" }).click();
  await page.waitForURL("**/ausschuettungen");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: `Ausschüttungen ${year}` })).toBeVisible();

  const form = page.getByRole("form", { name: "Neue Ausschüttung" });
  await form.getByLabel("Datum des Beschlusses").fill(`${year}-01-02`);
  await form.getByLabel("Ausschüttung brutto").fill("1.000,00");
  await form.getByRole("button", { name: "Steuerabzug berechnen" }).click();
  // Anteilseigner aus den Angaben des Vorjahres; 25 % Kapitalertragsteuer, 5,5 % Soli
  const rechnung = page.getByRole("region", { name: "Berechnung der Ausschüttung" });
  await expect(rechnung.getByRole("row", { name: /^Summe/ })).toContainText("250,00");
  await expect(rechnung.getByRole("row", { name: /^Summe/ })).toContainText("13,75");
  await expect(rechnung).toContainText("mehr lässt sich nicht ausschütten");
  await expect(rechnung.getByRole("button", { name: "Beschluss buchen" })).toBeDisabled();
  expect(await axe(), "/ausschuettungen").toEqual([]);
});

test("Ausschüttung mit Gewinnvortrag buchen, Steuerbescheinigung des Gesellschafters herunterladen", async () => {
  const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const year = Number(heute.slice(0, 4));
  // Gewinnvortrag aus der bisherigen Buchhaltung, damit es etwas auszuschütten gibt
  await go("/buchungen/neu");
  const buchung = page.getByRole("form", { name: "Manuelle Buchung" });
  await buchung.getByLabel("Eröffnungsbuchung").check();
  await buchung.getByLabel("Buchungstext").fill("Gewinnvortrag aus dem Vorjahr");
  await buchung.getByLabel("Konto Zeile 1").fill("9000");
  await buchung.getByLabel("Soll Zeile 1").fill("1.000,00");
  await buchung.getByLabel("Konto Zeile 2").fill("2970");
  await buchung.getByLabel("Haben Zeile 2").fill("1.000,00");
  await buchung.getByRole("button", { name: "Buchen" }).click();
  await page.waitForURL(/\/buchungen\?/);

  await go(`/ausschuettungen?jahr=${year}`);
  const form = page.getByRole("form", { name: "Neue Ausschüttung" });
  await form.getByLabel("Datum des Beschlusses").fill(heute);
  await form.getByLabel("Auszahlungstag laut Beschluss (optional)").fill(heute);
  await form.getByLabel("Ausschüttung brutto").fill("1.000,00");
  await form.getByRole("button", { name: "Steuerabzug berechnen" }).click();
  await page.getByRole("button", { name: "Beschluss buchen" }).click();
  await expect(page.getByText("Ausschüttung gebucht.")).toBeVisible();

  const [y, m, d] = heute.split("-");
  const karte = page.getByRole("region", { name: `Beschluss vom ${d}.${m}.${y}` });
  const bescheinigungen = karte.getByRole("region", { name: "Steuerbescheinigungen" });
  await expect(bescheinigungen).toContainText("Gib jedem Gesellschafter seine Bescheinigung");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    bescheinigungen.getByRole("link", { name: `Steuerbescheinigung ${USER.name} (PDF)` }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`Steuerbescheinigung-${heute}-Erika-Gesellschafter.pdf`);
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(await axe(), "/ausschuettungen mit Ausschüttung").toEqual([]);
});

test("Archiv: Abschluss eines alten Jahres aus dem DATEV-Stapel", async () => {
  const year = new Date().getFullYear() - 3;
  // Stapel wie aus Lexware Office (SKR04): Eröffnung über 9000, eine Ausgangsrechnung mit Steuerautomatik
  const header = `"EXTF";700;21;"Buchungsstapel";13;${year + 1}0102120000000;;"LO";"";"";1001;12345;${year}0101;4;${year}0101;${year}1231;"Lexware Export";"";1;0;0;"EUR";;"";;;"04";;;"";""`;
  const columns =
    "Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext";
  const csv = [
    header,
    columns,
    `25000,00;"S";"EUR";;;;1800;9000;"";0101;"";"";;"Eröffnung Bank"`,
    `25000,00;"S";"EUR";;;;9000;2900;"";0101;"";"";;"Eröffnung Stammkapital"`,
    `1190,00;"S";"EUR";;;;1800;4400;"";1503;"RE-1";"";;"Rechnung RE-1"`,
  ].join("\r\n");

  await go("/archiv");
  await page.getByLabel("Dateien für das Archiv").setInputFiles({ name: `EXTF_Buchungsstapel_${year}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Ins Archiv legen" }).click();
  await expect(page.getByText(`EXTF_Buchungsstapel_${year}.csv: archiviert, 3 Buchungen übernommen.`)).toBeVisible();

  await go(`/archiv?ansicht=buchungen&jahr=${year}`);
  const abschluss = page.getByRole("region", { name: `Abschluss aus dem DATEV-Stapel ${year}` });
  await expect(abschluss).toContainText("Eröffnungsbuchungen im Stapel");
  await expect(abschluss).toContainText("Hebesatz");
  const aktiva = page.getByRole("region", { name: `Aktiva zum 31.12.${year}` });
  await expect(aktiva.getByRole("row", { name: "Summe Aktiva" })).toContainText("26.190,00");
  await expect(page.getByRole("region", { name: `Passiva zum 31.12.${year}` }).getByRole("row", { name: "Summe Passiva" })).toContainText("26.190,00");
  await expect(page.getByRole("region", { name: /Gewinn- und Verlustrechnung/ }).getByRole("row", { name: /Umsatzerlöse/ })).toContainText("1.000,00");
  expect(await axe(), "/archiv?ansicht=buchungen").toEqual([]);
});

test("Eröffnung aus der Schlussbilanz des DATEV-Stapels: prüfen, bestätigen, Kasse und Forderungen stehen drin", async () => {
  const year = new Date().getFullYear();
  const schluss = year - 1;
  // Stapel des Vorjahres (SKR04): Eröffnung über 9000 mit Bank, Kasse und Stammkapital, eine Rechnung an einen Debitor
  const header = `"EXTF";700;21;"Buchungsstapel";13;${year}0102120000000;;"LO";"";"";1001;12345;${schluss}0101;4;${schluss}0101;${schluss}1231;"Lexware Export";"";1;0;0;"EUR";;"";;;"04";;;"";""`;
  const columns =
    "Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext";
  const csv = [
    header,
    columns,
    `25000,00;"S";"EUR";;;;1800;9000;"";0101;"";"";;"Eröffnung Bank"`,
    `25000,00;"S";"EUR";;;;9000;2900;"";0101;"";"";;"Eröffnung Stammkapital"`,
    `300,00;"S";"EUR";;;;1600;9000;"";0101;"";"";;"Eröffnung Kasse"`,
    `300,00;"S";"EUR";;;;9000;3510;"";0101;"";"";;"Eröffnung Gesellschafter"`,
    `1190,00;"S";"EUR";;;;10000;4400;"";1503;"RE-7";"";;"Rechnung RE-7"`,
  ].join("\r\n");
  await go("/archiv");
  await page.getByLabel("Dateien für das Archiv").setInputFiles({ name: `EXTF_Buchungsstapel_${schluss}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Ins Archiv legen" }).click();
  await expect(page.getByText(`EXTF_Buchungsstapel_${schluss}.csv: archiviert, 5 Buchungen übernommen.`)).toBeVisible();

  // Die Eröffnung von Hand aus dem Test oben steht noch: Der Vorschlag sagt es, statt doppelt zu eröffnen
  await go("/buchungen/neu");
  await page.getByRole("form", { name: "Manuelle Buchung" }).getByLabel("Eröffnungsbuchung").check();
  const vorschlag = page.getByRole("region", { name: `Eröffnung aus dem DATEV-Stapel ${schluss}` });
  await expect(vorschlag.getByRole("status", { name: "Eröffnung aus dem Stapel nicht buchbar" })).toContainText("zuerst stornieren");
  await expect(vorschlag.getByRole("button", { name: "Eröffnung buchen" })).toHaveCount(0);

  await go(`/buchungen?jahr=${year}&monat=1`);
  const journal = page.getByRole("region", { name: "Buchungen" });
  // Alle Eröffnungen von Hand stornieren: die Eröffnungsbilanz und den Gewinnvortrag aus dem Ausschüttungs-Test
  for (const text of ["Eröffnungsbilanz", "Gewinnvortrag aus dem Vorjahr"]) {
    await journal.getByRole("row").filter({ hasText: text, hasNotText: "Storno:" }).getByRole("button", { name: "Buchungszeilen anzeigen" }).click();
    const storno = journal.getByRole("button", { name: `${text} stornieren` });
    await storno.click();
    await storno.click();
    await expect(page.getByText(`Storniert: ${text}`)).toBeVisible();
  }

  await go("/buchungen/neu");
  await page.getByRole("form", { name: "Manuelle Buchung" }).getByLabel("Eröffnungsbuchung").check();
  await expect(vorschlag).toContainText("Bilanzsumme 26.490,00");
  const zeilen = vorschlag.getByRole("table", { name: `Zeilen der Eröffnung zum 1.1.${year}` });
  await expect(zeilen.getByRole("row").filter({ hasText: "1600" })).toContainText("300,00");
  await expect(zeilen.getByRole("row").filter({ hasText: "1200" })).toContainText("1.190,00");
  await expect(zeilen.getByRole("row").filter({ hasText: "3806" })).toContainText("190,00");
  await expect(zeilen.getByRole("row").filter({ hasText: "2970" })).toContainText("1.000,00");
  await expect(zeilen.getByRole("row", { name: /Summe/ })).toContainText("26.490,00");
  expect(await axe(), "/buchungen/neu mit Vorschlag").toEqual([]);
  const buchen = vorschlag.getByRole("button", { name: "Eröffnung buchen" });
  await buchen.click();
  await expect(vorschlag.getByRole("button", { name: "Jetzt buchen" })).toBeVisible();
  await vorschlag.getByRole("button", { name: "Jetzt buchen" }).click();

  await page.waitForURL(/\/buchungen\?/);
  await expect(
    page
      .getByRole("region", { name: "Buchungen" })
      .getByRole("row")
      .filter({ hasText: `Eröffnung aus der Schlussbilanz ${schluss}` }),
  ).toContainText("Eröffnung");
  await go(`/konten?jahr=${year}`);
  const liste = page.getByRole("region", { name: "Saldenliste" });
  await expect(liste.getByRole("row").filter({ hasText: "1200" }).first()).toContainText("1.190,00");
  await expect(liste.getByRole("row").filter({ hasText: /^9000/ })).toHaveCount(0);
  await go(`/kasse?jahr=${year}`);
  await expect(page.getByText(/300,00\s€ → 300,00\s€/)).toBeVisible();
});

test("Die Rechtsform ist nach der ersten Buchung fest", async () => {
  await go("/einstellungen");
  await expect(page.getByRole("form", { name: "Firmendaten" }).getByLabel("Rechtsform")).toBeDisabled();
});

test("Beleg stornieren und neu erfassen: Gegenbuchung, Hinweis am Beleg, Entwurf mit derselben Datei", async ({ browser }) => {
  const shot = await browser.newPage({ viewport: { width: 620, height: 400 } });
  await shot.setContent(`<body style="font: 14px sans-serif; padding: 40px"><h2>Codewerk Lizenzen GmbH</h2>
    <p>Rechnung L-4711</p><p>Lizenz 100,00 € · USt 19 % 19,00 € · Gesamt 119,00 €</p></body>`);
  const jpeg = await shot.screenshot({ type: "jpeg", quality: 80 });
  await shot.close();

  await go("/belege");
  await page.locator("input[type=file][multiple]").setInputFiles([{ name: "lizenz.jpg", mimeType: "image/jpeg", buffer: jpeg }]);
  await expect(page.getByText("lizenz.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /lizenz\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const original = page.url();
  await page.getByLabel("Lieferant", { exact: true }).fill("Codewerk Lizenzen GmbH");
  await page.getByLabel("Rechnungsnummer").fill("L-4711");
  await page.getByLabel("Belegdatum").fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel("Kategorie").selectOption("software");
  // Wie im Anlass (#237): der Bruttobetrag im Feld „Netto“
  await page.getByLabel("Netto", { exact: true }).fill("119,00");
  await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
  await page.getByRole("button", { name: "Jetzt buchen" }).click();
  await expect(page.getByText(/Gebucht .*festgeschrieben/)).toBeVisible();

  await page.getByRole("button", { name: "Beleg stornieren" }).click();
  await expect(page.getByRole("alert")).toContainText("bucht den Beleg mit heutigem Datum zurück");
  await page.getByLabel("Grund (optional)").fill("Brutto als Netto erfasst");
  await page.getByRole("button", { name: "Jetzt stornieren" }).click();
  await expect(page.getByText(/Storniert am .* Grund: Brutto als Netto erfasst/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Gegenbuchung" })).toBeVisible();
  await expect(page.locator(".page-head").getByText("Storniert", { exact: true })).toBeVisible();
  expect(await axe(), "/belege/… storniert").toEqual([]);

  await page.getByRole("button", { name: "Neu erfassen" }).click();
  await page.waitForURL((url) => url.href !== original && /belege\/[0-9a-f-]{36}$/.test(url.pathname));
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Neu erfasst aus einem")).toBeVisible();
  await expect(page.getByLabel("Lieferant", { exact: true })).toHaveValue("Codewerk Lizenzen GmbH");
  await expect(page.getByLabel("Netto", { exact: true })).toHaveValue("119,00");
  await page.getByLabel("Netto", { exact: true }).fill("100,00");
  await page.getByLabel("Vorsteuer", { exact: true }).fill("19,00");
  await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
  await page.getByRole("button", { name: "Jetzt buchen" }).click();
  await expect(page.getByText(/Gebucht .*festgeschrieben/)).toBeVisible();

  // Der stornierte Beleg führt jetzt zur Neuerfassung
  await go(new URL(original).pathname);
  await expect(page.getByRole("link", { name: "Zur Neuerfassung" })).toBeVisible();
  await page.getByRole("link", { name: "Gegenbuchung" }).click();
  await page.waitForURL(/\/buchungen/);
  await expect(page.getByText(/Storno: Beleg L-4711/)).toBeVisible();
});
