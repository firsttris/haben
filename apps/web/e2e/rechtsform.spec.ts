import { expect, test } from "@playwright/test";
import { SESSION, YEAR } from "./daten.ts";

/*
 * Anzeige nach Rechtsform im Einzelunternehmen aus app.spec.ts: nichts, was es nur in GmbH und UG gibt (docs/einrichtung.md,
 * Abschnitt Rechtsform). Das Gegenstück für die GmbH steht am Ende von gmbh.spec.ts.
 */

test.use({ storageState: SESSION });

test("Einzelunternehmen: Lohn ohne Gesellschafter-Geschäftsführer, Journal ohne Herkunft aus GmbH und UG", async ({ page }) => {
  // Einen Gesellschafter-Geschäftsführer gibt es nur in einer Kapitalgesellschaft; der Lohn des Inhabers ist eine Entnahme
  await page.goto("/lohn/mitarbeiter/neu");
  await page.waitForLoadState("networkidle");
  const art = page.getByLabel("Art der Beschäftigung");
  await expect(art.getByRole("option")).toHaveText(["Minijob (geringfügig entlohnt)", "Sozialversicherungspflichtig beschäftigt"]);
  await expect(art).toHaveValue("minijob");
  await expect(page.getByLabel("Statusfeststellung (§ 7a SGB IV)")).toHaveCount(0);

  // Manuelle Buchungen, Eröffnung und Ausschüttung entstehen nur in GmbH und UG
  await page.goto("/buchungen");
  await page.waitForLoadState("networkidle");
  const herkunft = page.getByRole("group", { name: "Herkunft" });
  await expect(herkunft.getByRole("button", { name: /^Pauschale/ })).toBeVisible();
  for (const name of [/^Manuell/, /^Eröffnung/, /^Ausschüttung/]) await expect(herkunft.getByRole("button", { name })).toHaveCount(0);
});

test("Einzelunternehmen: was nur ein Einzelunternehmen hat, bleibt sichtbar", async ({ page }) => {
  await page.goto("/finanzamt");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Vorauszahlungen herabsetzen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: `Einkommensteuer-Vorauszahlungen ${new Date().getFullYear()}` })).toBeVisible();

  await page.goto(`/jahreserklaerung/${YEAR}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: `Belege von ELSTER ${YEAR}` })).toBeVisible();

  await page.goto(`/auswertungen?jahr=${YEAR}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: "EÜR als CSV" })).toBeVisible();
  await expect(page.getByRole("heading", { name: `Einnahmen-Überschuss-Rechnung ${YEAR}` })).toBeVisible();

  await page.goto("/dauerbelege/neu");
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Bezahlung").getByRole("option", { name: "Privat bezahlt (Privateinlage)" })).toHaveCount(1);

  await page.goto("/einstellungen?bereich=persoenlich");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("group", { name: "Veranlagung" })).toBeVisible();
});
