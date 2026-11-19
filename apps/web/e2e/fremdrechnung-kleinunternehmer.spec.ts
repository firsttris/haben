import { expect, type Page, test } from "@playwright/test";
import { day } from "./daten.ts";
import { CUSTOMERS, durchlaufSeite, einrichten, kontaktAnlegen, kundeWaehlen } from "./einrichtung.ts";
import { datei, formularOeffnen, fremdesPdf } from "./fremdrechnung-formular.ts";

/**
 * Eigener Durchlauf zu #660 mit einer Kleinunternehmer-Firma (der Wechsel geht nur ohne Buchungen im Jahr, deshalb nicht
 * im Durchlauf „fremdrechnung“): Das Formular bietet § 19 UStG und Auslandsleistungen mit Pflicht-Leistungsort an (#1392), und eine Rechnung, mit der die Umsatzgrenze
 * überschritten werden könnte, wird erst nach der Rückfrage übernommen. Die Prüfungen selbst stehen in fremdrechnung.test.ts.
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

const KUNDE = `${CUSTOMERS[0]!.name} · ${CUSTOMERS[0]!.city}`;

test("Einrichtung als Kleinunternehmer mit einem Kunden", async () => {
  await einrichten(page, true);
  await kontaktAnlegen(page, CUSTOMERS[0]!);
});

test("Kleinunternehmer: § 19 oder Auslandsleistung mit Pflicht-Leistungsort; über der Umsatzgrenze wird erst nach der Rückfrage übernommen", async () => {
  await formularOeffnen(page);
  await datei(page, "FS-2001.pdf", await fremdesPdf(page, "FS-2001"));
  const behandlung = page.getByLabel("Steuerbehandlung");
  await expect(behandlung.locator("option")).toHaveCount(4);
  await expect(behandlung.locator("option[value=regulaer]")).toHaveCount(0);
  await expect(behandlung.locator("option[value=steuerfrei]")).toHaveCount(0);
  await expect(behandlung).toHaveValue("kleinunternehmer");
  await expect(behandlung).toHaveAccessibleDescription(/Auslandsleistungen mit geklärtem Leistungsort/);
  // Für eine Auslandsleistung sind Land und Bestätigung Pflicht (§ 19 Abs. 2 UStG zählt nur steuerbare Umsätze)
  await behandlung.selectOption("drittland");
  await expect(page.getByLabel("Land des tatsächlichen Leistungsorts")).toHaveJSProperty("required", true);
  await expect(page.getByLabel("Ausländische Umsatzsteuer")).toHaveJSProperty("required", true);
  await behandlung.selectOption("kleinunternehmer");
  await expect(page.getByLabel("Land des tatsächlichen Leistungsorts")).toHaveCount(0);

  await page.getByLabel("Rechnungsnummer").fill("FS-2001");
  await page.getByLabel("Rechnungsdatum").fill(day(-20));
  await page.getByLabel("Fällig am").fill(day(-6));
  await page.getByLabel("Befreiungsvorschrift").fill("Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.");
  await page.getByLabel("Steuersatz 1").selectOption("0");
  await page.getByLabel("Netto 1 (€)").fill("120.000,00");
  await page.getByLabel("Steuer 1 (€)").fill("0,00");
  await kundeWaehlen(page, KUNDE);

  // 120.000 € netto liegen über der Jahresgrenze: Rückfrage; bei „Abbrechen“ bleibt alles, wie es ist
  const frage = page.getByRole("dialog", { name: /möglicher Überschreitung der Umsatzgrenze/ });
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await expect(frage).toBeVisible();
  await expect(frage).toContainText("120.000,00");
  await frage.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(frage).toHaveCount(0);
  await expect(page).toHaveURL(/\/rechnungen$/);

  await page.getByRole("button", { name: "Übernehmen" }).click();
  await expect(frage).toBeVisible();
  await frage.getByRole("button", { name: "Trotzdem übernehmen", exact: true }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Rechnung FS-2001" })).toBeVisible();
});

test("Keine Seitenfehler im ganzen Durchlauf", () => {
  expect(pageErrors).toEqual([]);
});
