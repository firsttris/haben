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
  // Das Register wandelt ein PDF gegen Entgelt um; die Seite nennt Kosten und den Weg übers Webformular
  await expect(region).toContainText("1,75 Cent je sichtbarem Zeichen");
  await expect(region).toContainText("Webformular");
  // Gebühren nach dem JVKostG fallen auf jedem Weg an, das Entgelt kommt hinzu (D051, Abschnitte 1 und 2)
  await expect(region).toContainText("Das Register berechnet eine Gebühr und für ein PDF ein Entgelt");
  await expect(region).not.toContainText("Kostenlos");
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
  // Beim Tippen meldet das Datumsfeld schon Zwischenstände wie 0002-01-02; das Geschäftsjahr folgt dem fertigen Datum
  await form.getByLabel("Datum des Beschlusses").fill("0002-01-02");
  await form.getByLabel("Datum des Beschlusses").fill(`${year}-01-02`);
  // Vorbelegt mit dem Vorjahr; steht in der Steuerbescheinigung als Zeitraum (Muster II)
  await expect(form.getByLabel("Geschäftsjahr, dessen Gewinn ausgeschüttet wird")).toHaveValue(String(year - 1));
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

test("Geschäftsbrief (§ 35a GmbHG): Geschäftsführer in den Firmendaten, Pflichtangaben im Fuß der Rechnung und im XML", async () => {
  // Registergericht und -nummer stehen seit der Hinterlegung in den Firmendaten, die Geschäftsführung fehlt noch
  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await expect(firma.locator("#letter-issues")).toContainText("Für Rechnungen und Geschäftsbriefe fehlt noch (§ 35a GmbHG): Geschäftsführer fehlt.");

  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Hafenkontor Logistik GmbH");
  await page.getByLabel("Straße und Hausnummer").fill("Kaiserkai 7");
  await page.getByLabel("PLZ").fill("20457");
  await page.getByLabel("Ort").fill("Hamburg");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  // Fehlende Angaben sind ein Hinweis, keine Sperre (eine Vor-GmbH hat noch keine Registernummer)
  await go("/rechnungen/neu");
  await expect(page.locator("#letter-issues")).toContainText("Pflichtangaben für Geschäftsbriefe unvollständig (§ 35a GmbHG): Geschäftsführer fehlt.");
  await page.getByLabel("Kunde").selectOption({ label: "Hafenkontor Logistik GmbH · Hamburg" });
  await page.getByLabel("Beschreibung Position 1").fill("Softwarewartung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("500");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const entwurf = new URL(page.url()).pathname;

  await go("/einstellungen");
  await firma.getByRole("textbox", { name: /^Geschäftsführer/ }).fill("E. Gesellschafter");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
  await expect(firma.locator("#letter-issues")).toContainText("„E. Gesellschafter“: Familienname und ausgeschriebener Vorname");
  await firma.getByRole("textbox", { name: /^Geschäftsführer/ }).fill("Erika Gesellschafter");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(firma.locator("#letter-issues")).toHaveCount(0);
  expect(await axe(), "/einstellungen Geschäftsführer").toEqual([]);

  const fuss = "Sitz der Gesellschaft: Bremen · Registergericht: Amtsgericht Bremen, HRB 12345 HB · Geschäftsführung: Erika Gesellschafter";
  await go(entwurf);
  await expect(page.locator("#letter-issues")).toHaveCount(0);
  await expect(page.getByLabel("Vorschau der Rechnung")).toContainText(fuss);
  expect(await axe(), "/rechnungen/… Entwurf der GmbH").toEqual([]);
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await page.getByRole("button", { name: "Jetzt festschreiben" }).click();
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });

  const id = entwurf.split("/").pop();
  // EN 16931: Registernummer als BT-30, Pflichtangaben als BT-33 (in CII die Description des Verkäufers)
  const xml = await (await page.request.get(`/api/rechnung/${id}/xml`)).text();
  expect(xml).toContain(`<ram:Description>${fuss}</ram:Description>`);
  expect(xml).toMatch(/<ram:SpecifiedLegalOrganization>\s*<ram:ID>HRB 12345 HB<\/ram:ID>/);
  const pdf = await (await page.request.get(`/api/rechnung/${id}/pdf`)).body();
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
});

test("Restlaufzeiten und Vermerke: Gesellschafter-Verrechnungskonto, vorschlagen und bestätigen", async () => {
  const year = new Date().getFullYear();
  // Seit der Eröffnung aus dem DATEV-Stapel steht der Gesellschafter mit 300 € unter den Verbindlichkeiten
  await go(`/abschluss/${year}`);
  const passiva = page.getByRole("region", { name: `Passiva zum 31.12.${year}` });
  // § 42 Abs. 3 GmbHG: ohne Bestätigung schon da; Restlaufzeiten (§ 268 Abs. 5 HGB) erst nach der Bestätigung
  await expect(passiva.getByRole("row", { name: "davon gegenüber Gesellschaftern" })).toBeVisible();
  await expect(passiva).not.toContainText("davon mit einer Restlaufzeit");

  const rlz = page.getByRole("form", { name: `Restlaufzeiten ${year}` });
  await expect(rlz).toContainText("Noch nicht bestätigt.");
  await expect(rlz).toContainText("§ 271 Abs. 1 BGB");
  const feld = rlz.getByLabel(`Konto 3510 zum 31.12.${year}: davon Restlaufzeit von mehr als einem Jahr`);
  await expect(feld).toHaveValue("0,00");
  // Vorjahresspalte: der Stand der Eröffnung
  await expect(rlz.getByLabel(`Konto 3510 zum 31.12.${year - 1}: davon Restlaufzeit von mehr als einem Jahr`)).toHaveValue("0,00");
  expect(await axe(), `/abschluss/${year} Restlaufzeiten`).toEqual([]);

  // 100 € hat der Gesellschafter bis nach dem Folgejahr gestundet
  await feld.fill("100,00");
  await rlz.getByRole("button", { name: "Restlaufzeiten bestätigen" }).click();
  await expect(page.getByText("Restlaufzeiten bestätigt.")).toBeVisible();
  await expect(passiva.getByRole("row", { name: "davon mit einer Restlaufzeit von mehr als einem Jahr" })).toContainText("100,00");
  await expect(passiva.getByRole("row", { name: "davon mit einer Restlaufzeit bis zu einem Jahr" })).toBeVisible();
  await expect(rlz).toContainText("Zuletzt bestätigt am");
  expect(await axe(), `/abschluss/${year} Restlaufzeiten bestätigt`).toEqual([]);
});

/*
 * Lohn im laufenden Monat: Der Test „Jahresabschluss“ schließt das Vorjahr ab, und die Abrechnung bucht am Monatsende. Ein
 * fester Monat läge ab dem Folgejahr im abgeschlossenen Jahr, das Festschreiben schlüge fehl. Die Beträge hängen vom
 * Programmablaufplan des Jahres ab: BMF-Steuerrechner, 6.000 € in Klasse I ohne Renten- und Arbeitslosenversicherung,
 * KVZ 2,9 %, kinderlos, evangelisch.
 */
const LOHN_BMF: Record<number, { lohnsteuer: string; kirchensteuer: string; auszahlung: string; gesamt: string }> = {
  // gesamt: Kz 83 der Lohnsteuer-Anmeldung, Lohnsteuer und Kirchensteuer (kein Soli unter der Freigrenze)
  2026: { lohnsteuer: "1.289,33", kirchensteuer: "116,03", auszahlung: "4.594,64", gesamt: "1.405,36" },
};
const lohnHeute = new Date();
const lohnJahr = lohnHeute.getFullYear();
const lohnMonat = lohnHeute.getMonth() + 1;
const mm = String(lohnMonat).padStart(2, "0");
const lohnMonatsname = new Date(lohnJahr, lohnMonat - 1, 1).toLocaleString("de-DE", { month: "long" });
const lohnLetzter = new Date(lohnJahr, lohnMonat, 0).getDate();
const zahlungTag = `${String(lohnHeute.getDate()).padStart(2, "0")}.${mm}.${String(lohnJahr).slice(2)}`;
const lohnText = `Lohn ${lohnMonatsname} ${lohnJahr} · Erika Gesellschafter`;
const lohnSeite = `/lohn?jahr=${lohnJahr}&monat=${lohnMonat}`;
const buchungenSeite = `/buchungen?jahr=${lohnJahr}&monat=${lohnMonat}`;

test("Lohn: Gesellschafter-Geschäftsführer anlegen, im laufenden Monat abrechnen, festschreiben und buchen, PDF, Lohnkonto, Auszahlung und Storno", async () => {
  const bmf = LOHN_BMF[lohnJahr];
  test.skip(!bmf, `Beträge für ${lohnJahr} aus dem BMF-Steuerrechner in LOHN_BMF ergänzen`);
  await go(lohnSeite);
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByRole("group", { name: "Personal" }).getByRole("link", { name: "Lohn" })).toBeVisible();
  expect(await axe(), "/lohn ohne Mitarbeiter").toEqual([]);
  await page.getByRole("link", { name: "Mitarbeiter anlegen" }).click();
  await page.waitForURL("**/lohn/mitarbeiter/neu");
  await page.waitForLoadState("networkidle");
  expect(await axe(), "/lohn/mitarbeiter/neu").toEqual([]);

  const form = page.getByRole("form", { name: "Stammdaten des Mitarbeiters" });
  await form.getByLabel("Vorname").fill("Erika");
  await form.getByLabel("Nachname").fill("Gesellschafter");
  await form.getByLabel("Straße und Hausnummer").fill("Lindenweg 1");
  await form.getByLabel("PLZ").fill("28195");
  await form.getByLabel("Ort", { exact: true }).fill("Bremen");
  await form.getByLabel("Geburtsdatum").fill("1980-04-12");
  await form.getByLabel("IBAN für die Auszahlung").fill("DE89 3704 0044 0532 0130 00");
  await expect(form.getByLabel("Art der Beschäftigung")).toHaveValue("ggf");
  await form.getByLabel("Monatsgehalt brutto in Euro").fill("6.000,00");
  await form.getByLabel("Eintritt", { exact: true }).fill("2024-01-01");
  await form.getByLabel("Statusfeststellung (§ 7a SGB IV)").selectOption("versicherungsfrei");
  await form.getByLabel("Steuer-ID").fill("86095742719");
  await form.getByLabel("Kirchensteuermerkmal").selectOption("ev");
  await form.getByLabel("Zusatzbeitrag der Kasse in Prozent").fill("2,90");
  await form.getByLabel(/Zuschlag für Kinderlose/).check();
  await form.getByRole("button", { name: "Mitarbeiter anlegen" }).click();
  await page.waitForURL(/\/lohn$/);

  await go(lohnSeite);
  const monat = page.getByRole("form", { name: `${lohnMonatsname} ${lohnJahr} abrechnen` });
  await monat.getByLabel("Zahltag").fill(`${lohnJahr}-${mm}-28`);
  await monat.getByRole("button", { name: "Monat abrechnen" }).click();
  await expect(page.getByText("Ein Entwurf angelegt.")).toBeVisible();

  const mitarbeiterin = page.getByRole("region", { name: "Erika Gesellschafter" });
  const abrechnung = mitarbeiterin.getByRole("region", { name: new RegExp(`^1\\. Abrechnung Stufe A, Zahltag 28\\.${mm}\\.${lohnJahr}`) });
  await expect(abrechnung.getByRole("row", { name: "Lohnsteuer" })).toContainText(`-${bmf!.lohnsteuer}`);
  await expect(abrechnung.getByRole("row", { name: "Kirchensteuer" })).toContainText(`-${bmf!.kirchensteuer}`);
  await expect(abrechnung.getByText("Entwurf", { exact: true })).toBeVisible();
  expect(await axe(), "/lohn mit Entwurf").toEqual([]);
  const entwurfPdf = await page.request.get((await abrechnung.getByRole("link", { name: "Entwurf ansehen (PDF)" }).getAttribute("href"))!);
  expect((await entwurfPdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  await abrechnung.getByRole("button", { name: "Festschreiben" }).click();
  await abrechnung.getByRole("button", { name: "Jetzt festschreiben" }).click();
  await expect(page.getByText("Abrechnung festgeschrieben.")).toBeVisible();
  await expect(abrechnung.getByText("festgeschrieben und gebucht", { exact: true })).toBeVisible();
  const pdf = await page.request.get((await abrechnung.getByRole("link", { name: "Entgeltabrechnung (PDF)" }).getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // Lohnkonto des Jahres (§ 41 EStG) als CSV und PDF
  const mitarbeiterLink = page.getByRole("link", { name: "Erika Gesellschafter", exact: true });
  const id = (await mitarbeiterLink.getAttribute("href"))!.split("/").pop();
  const csv = await (await page.request.get(`/api/lohn/lohnkonto/${id}/${lohnJahr}/csv`)).text();
  expect(csv).toContain(`Lohnkonto;${lohnJahr}`);
  expect(csv).toContain(`28.${mm}.${lohnJahr};${mm}/${lohnJahr};Abrechnung;StKl I, Kfb 0, ev;6000,00;6000,00;0,00;0,00;${bmf!.lohnsteuer.replace(".", "")}`);
  const konto = await page.request.get(`/api/lohn/lohnkonto/${id}/${lohnJahr}/pdf`);
  expect((await konto.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // Lohnsteuer-Anmeldung des Monats: Kennzahlen aus der festgeschriebenen Abrechnung, Ausfüllliste ohne Hersteller-ID, prüfen
  await go(lohnSeite);
  await page.getByRole("link", { name: "Lohnsteuer-Anmeldung" }).click();
  await page.waitForURL(/\/lohn\/anmeldung\/\d{4}(-(\d{2}|Q[1-4]))?$/);
  await go(`/lohn/anmeldung/${lohnJahr}-${mm}`);
  const turnus = page.getByRole("region", { name: `Anmeldungszeitraum ${lohnJahr}` });
  await turnus.getByLabel(`Anmeldungszeitraum ${lohnJahr}`).selectOption("monatlich");
  await turnus.getByRole("button", { name: "Speichern" }).click();
  await expect(turnus.getByText("Anmeldungszeitraum gespeichert.")).toBeVisible();
  await expect(turnus.getByText("monatlich (festgelegt)")).toBeVisible();
  const kennzahlen = page.getByRole("table", { name: `Kennzahlen ${lohnMonatsname} ${lohnJahr}` });
  await expect(kennzahlen.getByRole("row", { name: /Summe der einzubehaltenden Lohnsteuer/ })).toContainText(bmf!.lohnsteuer);
  await expect(kennzahlen.getByRole("row", { name: /Evangelische Kirchensteuer/ })).toContainText(bmf!.kirchensteuer);
  await expect(kennzahlen.getByRole("row", { name: /Gesamtbetrag/ })).toContainText(bmf!.gesamt);
  await expect(kennzahlen.getByRole("row", { name: /Zahl der Arbeitnehmer/ })).toContainText("1");
  await expect(page.getByText(/Der Zeitraum endet erst am/)).toBeVisible();
  const liste = page.getByRole("table", { name: "Ausfüllliste für Mein ELSTER" });
  await expect(liste.getByRole("row", { name: /laufendes Jahr \(Kz 42\)/ })).toContainText(bmf!.lohnsteuer.replace(".", ""));
  await page.getByRole("button", { name: "Nur prüfen" }).click();
  await expect(page.getByText("ERiC hat die Daten geprüft, keine Fehler.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Verlauf" })).toContainText("Prüfung OK");
  expect(await axe(), "/lohn/anmeldung").toEqual([]);
  await go("/fristen");
  for (const alle of await page.getByRole("button", { name: /^Alle \d+ zeigen$/ }).all()) await alle.click();
  await expect(page.getByText(`Lohnsteuer-Anmeldung ${lohnMonatsname} ${lohnJahr}`, { exact: true }).first()).toBeVisible();

  // Buchung am Monatsende (SKR04): Geschäftsführergehalt an Verbindlichkeiten aus Lohn und Gehalt bzw. Lohn- und Kirchensteuer
  await go(buchungenSeite);
  const journal = page.getByRole("region", { name: "Buchungen" });
  const lohnzeile = journal.getByRole("row").filter({ hasText: lohnText });
  await expect(lohnzeile).toContainText(`${lohnLetzter}.${mm}.`);
  await expect(lohnzeile.getByRole("link", { name: "Lohn" })).toBeVisible();
  await expect(lohnzeile).toContainText("6024");
  await expect(lohnzeile).toContainText("3720");
  await expect(lohnzeile).toContainText("6.000,00");
  await lohnzeile.getByRole("button", { name: "Buchungszeilen anzeigen" }).click();
  await expect(journal.getByText("3730").first()).toBeVisible();
  expect(await axe(), "/buchungen mit Lohn").toEqual([]);

  // Auszahlung im Bankabgleich: Lohn/Gehalt an Mitarbeiter gleicht 3720 aus
  const auszug =
    "\ufeff" +
    `"Girokonto";"DE89 3704 0044 0532 0130 00"\n""\n"Kontostand vom ${zahlungTag}:";"35.405,36 €"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    `"${zahlungTag}";"${zahlungTag}";"Gebucht";"Nordlicht Software GmbH";"Erika Gesellschafter";"Gehalt ${mm}/${lohnJahr}";"Ausgang";"DE89370400440532013000";"-${bmf!.auszahlung}";"";"";""\n`;
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "lohn.csv", mimeType: "text/csv", buffer: Buffer.from(auszug) }]);
  await expect(page.getByText(/1 neuer Umsatz|1 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  await go("/bank");
  await page
    .getByRole("link", { name: /Erika Gesellschafter/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Erika Gesellschafter" })).toBeVisible();
  await page.getByRole("button", { name: "Ohne Rechnung buchen" }).click();
  await page.getByLabel("Buchen als").selectOption({ label: "Lohn/Gehalt an Mitarbeiter" });
  expect(await axe(), "/bank Lohnzahlung").toEqual([]);
  await page.getByRole("button", { name: "Buchen", exact: true }).click();
  // Der einzige Umsatz bleibt ausgewählt, jetzt zugeordnet
  await expect(page.getByRole("complementary", { name: "Zuordnung" }).getByRole("button", { name: "Aufheben" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Zuordnung" })).toContainText("Lohn/Gehalt");
  await go(`/konten/3720?jahr=${lohnJahr}&zeitraum=jahr`);
  await expect(page.getByRole("heading", { name: /3720/ })).toContainText("Verbindlichkeiten aus Lohn und Gehalt");
  await expect(page.getByText(lohnText)).toBeVisible();
  await expect(page.getByText(/Erika Gesellschafter · lohn/)).toBeVisible();

  // Storno: die Abrechnung bleibt, daneben ein neuer Entwurf für denselben Monat; die Buchung wird gegengebucht
  await go(lohnSeite);
  await abrechnung.getByRole("button", { name: "Stornieren" }).click();
  const storno = page.getByRole("form", { name: "Abrechnung stornieren" });
  await storno.getByLabel("Grund des Stornos").fill("Gehalt rückwirkend geändert");
  await storno.getByRole("button", { name: "Jetzt stornieren" }).click();
  await expect(mitarbeiterin.getByText(/^storniert am/)).toBeVisible();
  await expect(mitarbeiterin.getByRole("region", { name: /Abrechnung Stufe A/ })).toHaveCount(2);
  await expect(mitarbeiterin.getByText("Grund des Stornos: Gehalt rückwirkend geändert")).toBeVisible();
  expect(await axe(), "/lohn nach Storno").toEqual([]);
  await go(buchungenSeite);
  const gegen = page
    .getByRole("region", { name: "Buchungen" })
    .getByRole("row")
    .filter({ hasText: new RegExp(`Storno vom .*: ${lohnText}`) });
  await expect(gegen).toContainText("Gegenbuchung");
  await expect(gegen).toContainText("6.000,00");
  await go(lohnSeite);

  await mitarbeiterLink.click();
  await page.waitForURL(/\/lohn\/mitarbeiter\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Erika Gesellschafter");
  expect(await axe(), "/lohn/mitarbeiter/<id>").toEqual([]);
});

/*
 * Lohnsteuerbescheinigung im laufenden Jahr: Ein Geschäftsführer, der nur im Vormonat beschäftigt war, hat ein
 * abgeschlossenes Lohnkonto (§ 41b Abs. 1 EStG); Erika aus dem Test davor hat nach dem Storno nur einen Entwurf. Ab 2026 übermittelt Haben
 * nicht über ERiC (LSTMitteilung), sondern vermerkt die Übermittlung im ELSTER-Portal. Im Januar liegt der Vormonat im
 * abgeschlossenen Vorjahr: dann übersprungen.
 */
test("Lohnsteuerbescheinigung: Austritt im Vormonat, Werte, Entwurf und Ausdruck, Übermittlung im ELSTER-Portal vermerken, Frist, Stornierung", async () => {
  const bmf = LOHN_BMF[lohnJahr];
  test.skip(!bmf || lohnMonat === 1, `Im Januar oder ohne Beträge für ${lohnJahr} in LOHN_BMF`);
  const vm = lohnMonat - 1;
  const vmm = String(vm).padStart(2, "0");
  const vmName = new Date(lohnJahr, vm - 1, 1).toLocaleString("de-DE", { month: "long" });
  const vmLetzter = String(new Date(lohnJahr, vm, 0).getDate()).padStart(2, "0");

  await go("/lohn/mitarbeiter/neu");
  const form = page.getByRole("form", { name: "Stammdaten des Mitarbeiters" });
  await form.getByLabel("Vorname").fill("Max");
  await form.getByLabel("Nachname").fill("Kurzzeit");
  await form.getByLabel("Straße und Hausnummer").fill("Am Deich 7");
  await form.getByLabel("PLZ").fill("28199");
  await form.getByLabel("Ort", { exact: true }).fill("Bremen");
  await form.getByLabel("Geburtsdatum").fill("1975-09-30");
  await form.getByLabel("IBAN für die Auszahlung").fill("DE89 3704 0044 0532 0130 00");
  await form.getByLabel("Monatsgehalt brutto in Euro").fill("6.000,00");
  await form.getByLabel("Eintritt", { exact: true }).fill(`${lohnJahr}-${vmm}-01`);
  await form.getByLabel("Austritt (optional)").fill(`${lohnJahr}-${vmm}-${vmLetzter}`);
  await form.getByLabel("Statusfeststellung (§ 7a SGB IV)").selectOption("versicherungsfrei");
  await form.getByLabel("Steuer-ID").fill("47291830467");
  await form.getByLabel("Kirchensteuermerkmal").selectOption("ev");
  await form.getByLabel("Zusatzbeitrag der Kasse in Prozent").fill("2,90");
  await form.getByLabel(/Zuschlag für Kinderlose/).check();
  await form.getByRole("button", { name: "Mitarbeiter anlegen" }).click();
  await page.waitForURL(/\/lohn$/);

  // Vormonat abrechnen: Max festschreiben, Erikas Entwurf wieder löschen
  await go(`/lohn?jahr=${lohnJahr}&monat=${vm}`);
  const monat = page.getByRole("form", { name: `${vmName} ${lohnJahr} abrechnen` });
  await monat.getByLabel("Zahltag").fill(`${lohnJahr}-${vmm}-28`);
  await monat.getByRole("button", { name: "Monat abrechnen" }).click();
  await expect(page.getByText("2 Entwürfe angelegt.")).toBeVisible();
  const max = page.getByRole("region", { name: "Max Kurzzeit" }).getByRole("region", { name: /^1\. Abrechnung Stufe A/ });
  await max.getByRole("button", { name: "Festschreiben" }).click();
  await max.getByRole("button", { name: "Jetzt festschreiben" }).click();
  await expect(max.getByText("festgeschrieben und gebucht", { exact: true })).toBeVisible();
  const erika = page.getByRole("region", { name: "Erika Gesellschafter" });
  await erika.getByRole("button", { name: "Entwurf löschen" }).click();
  await expect(erika.getByRole("button", { name: "Entwurf löschen" })).toHaveCount(0);

  await page.getByRole("link", { name: `Lohnsteuerbescheinigungen ${lohnJahr}` }).click();
  await page.waitForURL(`**/lohn/bescheinigung/${lohnJahr}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Lohnsteuerbescheinigungen ${lohnJahr}`);
  await expect(page.getByText(/LSTMitteilung über ElsterKMV/)).toBeVisible();
  const karte = page.getByRole("region", { name: "Max Kurzzeit" });
  await expect(karte).toContainText("bereit zur Übermittlung");
  await expect(karte.getByRole("row", { name: /^1\. Bescheinigungszeitraum/ })).toContainText(`01.${vmm}.${lohnJahr} – ${vmLetzter}.${vmm}.${lohnJahr}`);
  await expect(karte.getByRole("row", { name: /^3\. Bruttoarbeitslohn/ })).toContainText("6.000,00");
  await expect(karte.getByRole("row", { name: /^4\. Lohnsteuer/ })).toContainText(bmf!.lohnsteuer);
  await expect(karte.getByRole("row", { name: /^6\. Kirchensteuer/ })).toContainText(bmf!.kirchensteuer);
  // Erika hat nach dem Storno nur einen Entwurf: noch nicht fertig
  await expect(page.getByRole("region", { name: "Erika Gesellschafter" })).toContainText(`Für ${lohnMonatsname} gibt es einen Entwurf`);
  expect(await axe(), `/lohn/bescheinigung/${lohnJahr}`).toEqual([]);

  // Ohne den Namen des Finanzamts in den Firmendaten kein Ausdruck und kein Vermerk
  await expect(page.getByText(/Firmendaten: Name des Finanzamts fehlt/)).toBeVisible();
  await expect(karte.getByRole("link", { name: /Ausdruck/ })).toHaveCount(0);
  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("Finanzamt", { exact: true }).fill("Finanzamt Bremen");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
  await go(`/lohn/bescheinigung/${lohnJahr}`);
  await expect(page.getByText(/Firmendaten: /)).toHaveCount(0);

  const entwurf = await page.request.get((await karte.getByRole("link", { name: /Ausdruck/ }).getAttribute("href"))!);
  expect(entwurf.headers()["content-disposition"]).toContain("Entwurf");
  expect((await entwurf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // Im ELSTER-Portal übermittelt: Tag und Transferticket vermerken
  const vermerk = karte.getByRole("form", { name: "Bescheinigung im ELSTER-Portal vermerken: Max Kurzzeit" });
  await vermerk.getByLabel("Transferticket").fill("et9f3k2m7q1x");
  await vermerk.getByRole("button", { name: "Übermittlung vermerken" }).click();
  await expect(karte.getByText("Nr. 2 · übermittelt")).toBeVisible();
  await expect(karte.getByRole("list")).toContainText("Transferticket et9f3k2m7q1x");
  const ausdruck = await page.request.get((await karte.getByRole("link", { name: /Ausdruck/ }).getAttribute("href"))!);
  expect(ausdruck.headers()["content-disposition"]).not.toContain("Entwurf");
  expect((await ausdruck.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(await axe(), `/lohn/bescheinigung/${lohnJahr} übermittelt`).toEqual([]);

  // Frist bis Ende Februar des Folgejahres, offen wegen Erikas Entwurf
  await go("/fristen");
  await expect(page.getByText(`Lohnsteuerbescheinigungen ${lohnJahr}`)).toBeVisible();
  expect(await axe(), "/fristen mit Lohnsteuerbescheinigung").toEqual([]);

  // Stornierung im Portal vermerken: danach wieder bereit für eine neue Bescheinigung
  await go(`/lohn/bescheinigung/${lohnJahr}`);
  const storno = karte.getByRole("form", { name: "Stornierung im ELSTER-Portal vermerken: Max Kurzzeit" });
  await storno.getByLabel("Transferticket").fill("et9f3k2m7q2y");
  await storno.getByLabel("Grund").fill("Test der Stornierung");
  await storno.getByRole("button", { name: "Stornierung vermerken" }).click();
  await expect(karte.getByText("Nr. 2 · storniert")).toBeVisible();
  await expect(karte.getByRole("form", { name: "Bescheinigung im ELSTER-Portal vermerken: Max Kurzzeit" })).toBeVisible();
  expect(await axe(), `/lohn/bescheinigung/${lohnJahr} storniert`).toEqual([]);
});
