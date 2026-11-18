import { expect, test } from "@playwright/test";
import { SESSION, YEAR } from "./daten.ts";

/*
 * BWA (#1380) mit den Daten aus app.spec.ts: von den Auswertungen aus öffnen, Zeitraum und Vergleich umschalten, eine Zeile
 * bis zur Rechnung aufklappen.
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
