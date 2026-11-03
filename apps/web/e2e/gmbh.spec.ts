import AxeBuilder from "@axe-core/playwright";
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

test("Die Rechtsform ist nach der ersten Buchung fest", async () => {
  await go("/einstellungen");
  await expect(page.getByRole("form", { name: "Firmendaten" }).getByLabel("Rechtsform")).toBeDisabled();
});
