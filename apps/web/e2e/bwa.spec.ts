import { FORM43 } from "@haben/core";
import { expect, test } from "@playwright/test";
import { SESSION, YEAR } from "./daten.ts";

/*
 * BWA (#1380) mit den Daten aus app.spec.ts: von den Auswertungen aus öffnen, Zeitraum und Vergleich umschalten, eine Zeile
 * bis zur Rechnung aufklappen, „Warum?“ zum Vorjahr, leere Zeilen einblenden, Anteile und Kennzahlen (#1635).
 */

test.use({ storageState: SESSION });

test("BWA: Zeitraum und Vergleich wählen, Erlöse bis zur Rechnung aufklappen", async ({ page }) => {
  await page.goto(`/auswertungen?jahr=${YEAR}`);
  await page.getByRole("link", { name: "BWA", exact: true }).click();
  await expect(page).toHaveURL(/\/auswertungen\/bwa/);

  await page.getByLabel("Zeitraum").selectOption("jahr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`BWA ${YEAR}`);
  const tabelle = page.getByRole("table", { name: `BWA ${YEAR}` });
  await expect(tabelle.getByRole("columnheader", { name: String(YEAR - 1), exact: true })).toBeVisible();
  await expect(tabelle.getByRole("rowheader", { name: "Gewinn laut EÜR" })).toBeVisible();

  await page.getByLabel("Vergleich").selectOption("keiner");
  await expect(tabelle.getByRole("columnheader", { name: "Abweichung" })).toHaveCount(0);

  // app.spec.ts ordnet Zahlungen auf Rechnungen zu: Die Erlöse führen zur Rechnung
  await tabelle.getByRole("link", { name: "Erlöse aus betrieblicher Tätigkeit" }).click();
  const details = page.getByRole("region", { name: `Erlöse aus betrieblicher Tätigkeit · ${YEAR}` });
  await expect(details).toBeVisible();
  await details
    .getByRole("link", { name: /^Rechnung / })
    .first()
    .click();
  await expect(page).toHaveURL(/\/rechnungen\/[0-9a-f-]{36}$/);
});

test("BWA: Warum? erklärt die Abweichung zum Vorjahr nach Kontakt", async ({ page }) => {
  await page.goto(`/auswertungen/bwa?jahr=${YEAR}&zeitraum=jahr&vergleich=vorjahr`);
  const tabelle = page.getByRole("table", { name: `BWA ${YEAR}` });
  await tabelle.getByRole("link", { name: "Erlöse aus betrieblicher Tätigkeit" }).click();
  const details = page.getByRole("region", { name: `Erlöse aus betrieblicher Tätigkeit · ${YEAR}` });
  const warum = details.getByRole("region", { name: "Warum?" });
  await expect(warum).toBeVisible();
  await expect(warum.getByRole("rowheader", { name: "Abweichung der Zeile" })).toBeVisible();
  // Die Erlöse kommen aus bezahlten Rechnungen (app.spec.ts), deren Kunde ist ein Kontakt
  await expect(warum.getByRole("link").first()).toHaveAttribute("href", /\/kontakte\/[0-9a-f-]{36}$/);
});

test("BWA: freier Zeitraum von–bis", async ({ page }) => {
  await page.goto(`/auswertungen/bwa?jahr=${YEAR}&zeitraum=jahr`);
  await page.getByLabel("Zeitraum").selectOption("frei");
  const form = page.getByRole("form", { name: "Freier Zeitraum" });
  await form.getByLabel("Von").fill(`${YEAR}-03-01`);
  await form.getByLabel("Bis").fill(`${YEAR}-05-15`);
  await form.getByRole("button", { name: "Anzeigen" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`BWA 01.03.${YEAR}–15.05.${YEAR}`);
  await expect(page.getByRole("columnheader", { name: `01.03.–15.05.${YEAR - 1}` })).toBeVisible();
});

test("BWA: leere Zeilen anzeigen, der Schalter bleibt beim Wechsel von Zeitraum und Zeile in der Adresse", async ({ page }) => {
  await page.goto(`/auswertungen/bwa?jahr=${YEAR}&zeitraum=jahr`);
  const tabelle = page.getByRole("table", { name: `BWA ${YEAR}` });
  const zeilen = tabelle.locator("tbody tr");
  const schalter = page.getByRole("checkbox", { name: "Leere Zeilen anzeigen" });
  await expect(schalter).not.toBeChecked();
  await expect(tabelle.getByRole("rowheader", { name: "Gewinn laut EÜR" })).toBeVisible();
  const ohneLeere = await zeilen.count();
  expect(ohneLeere).toBeLessThan(FORM43.length);

  await schalter.check();
  await expect(page).toHaveURL(/[?&]leer=1/);
  await expect(zeilen).toHaveCount(FORM43.length);

  await page.getByLabel("Zeitraum").selectOption("q1");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`BWA 1. Quartal ${YEAR}`);
  await expect(page).toHaveURL(/[?&]leer=1/);
  await expect(page.getByRole("table", { name: `BWA 1. Quartal ${YEAR}` }).locator("tbody tr")).toHaveCount(FORM43.length);

  await page.getByLabel("Vergleich").selectOption("vorperiode");
  await expect(page).toHaveURL(/[?&]leer=1/);
  await page.getByRole("link", { name: "Erlöse aus betrieblicher Tätigkeit" }).click();
  await expect(page.getByRole("region", { name: `Erlöse aus betrieblicher Tätigkeit · 1. Quartal ${YEAR}` })).toBeVisible();
  await expect(page).toHaveURL(/[?&]leer=1/);
  await expect(schalter).toBeChecked();

  await schalter.uncheck();
  await expect(page).not.toHaveURL(/[?&]leer=/);
  await expect(page.getByRole("table", { name: `BWA 1. Quartal ${YEAR}` }).locator("tbody tr")).not.toHaveCount(FORM43.length);
});

test("BWA: Anteil je Zeile und Kennzahlen über der Tabelle (#1635)", async ({ page }) => {
  await page.goto(`/auswertungen/bwa?jahr=${YEAR}&zeitraum=jahr&vergleich=vorjahr`);
  const tabelle = page.getByRole("table", { name: `BWA ${YEAR}` });
  // Die Spalte „Anteil“ steht direkt nach dem Betrag des Zeitraums
  await expect(tabelle.locator("thead th").nth(2)).toHaveText("Anteil");
  const anteil = (zeile: string) =>
    tabelle
      .locator("tbody tr")
      .filter({ has: page.getByRole("rowheader", { name: zeile, exact: true }) })
      .locator("td")
      .nth(1);
  await expect(anteil("Summe der Erlöse")).toHaveText("100,0\u00a0%");
  await expect(anteil("Summe der Betriebseinnahmen")).toHaveText("–");
  await expect(anteil("Gewinn laut EÜR")).toHaveText("–");

  const kennzahlen = page.getByRole("region", { name: "Kennzahlen" });
  for (const name of ["Rohertragsquote", "Personalkostenquote", "Kostenquote", "Umsatzrendite"])
    await expect(kennzahlen.getByText(name, { exact: true })).toBeVisible();
  await expect(kennzahlen.getByText("Aufschlag", { exact: true })).toHaveCount(0);
  await expect(kennzahlen.getByText("ohne Umsatzsteuer, in % der Erlöse")).toBeVisible();
  // Mit Vergleich steht der Wert des Vorjahres klein darunter, ohne Vergleich nicht
  await expect(kennzahlen.getByText(`${YEAR - 1}:`)).toHaveCount(4);
  await page.getByLabel("Vergleich").selectOption("keiner");
  await expect(kennzahlen.getByText(`${YEAR - 1}:`)).toHaveCount(0);
});
