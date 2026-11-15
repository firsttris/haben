import { expect, test } from "@playwright/test";
import { fixture, innerZip, unmaskedStack10, zip } from "../../../packages/import/src/sevdesk/export/testzip.ts";
import { bestaetigen, durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";

/**
 * Umzug aus sevDesk ohne API (#1105): Export-ZIP hochladen, Vorschau, übernehmen, Abgleich je Jahr (#1106), Beleg mit
 * Belegbild im Archiv. Eigene, leere Datenbank (Projekt „sevdesk-export“, e2e/durchlaeufe.ts); die ZIP entsteht aus den Testdaten in
 * packages/import/test-fixtures/sevdesk, Version 1.0, Jahr 2024.
 */
function exportZip(): Buffer {
  const zeitraum = "20240101_20241231";
  return Buffer.from(
    zip({
      [`EXTF_Buchungsstapel_${zeitraum}.csv`]: unmaskedStack10(),
      [`EXTF_GP_Stamm_${zeitraum}.csv`]: fixture("buchhaltung-1.0/extf-gp-stamm.csv"),
      [`DATEV_Rechnungsausgang_${zeitraum}.zip`]: innerZip(fixture("buchhaltung-1.0/document-rechnungsausgang.xml")),
      [`DATEV_Rechnungseingang_${zeitraum}.zip`]: innerZip(fixture("buchhaltung-1.0/document-rechnungseingang.xml")),
    }),
  );
}

test("sevDesk ohne API: Export prüfen, übernehmen und Beleg mit Belegbild im Archiv", async ({ browser }) => {
  const { page, pageErrors } = await durchlaufSeite(browser);
  await einrichten(page);
  await gehe(page, "/archiv");
  await page.getByRole("button", { name: "Umzug aus sevDesk", exact: true }).click();
  const card = page.getByRole("region", { name: "Ohne API: Export hochladen" });

  // Eine fremde ZIP wird mit Grund abgelehnt
  await card
    .getByLabel("Export-ZIP")
    .setInputFiles({ name: "fremd.zip", mimeType: "application/zip", buffer: Buffer.from(zip({ "a.txt": new Uint8Array([1]) })) });
  await card.getByRole("button", { name: "Hochladen und prüfen" }).click();
  await expect(card.getByText(/Buchungsstapel.*fehlt/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Übernehmen", exact: true })).toHaveCount(0);

  await card.getByLabel("Export-ZIP").setInputFiles({
    name: "BITTE-ENTPACKEN_Buchungsstapel_und_Belegbilder_1_1_20240101_bis_20241231.zip",
    mimeType: "application/zip",
    buffer: exportZip(),
  });
  await card.getByRole("button", { name: "Hochladen und prüfen" }).click();
  await expect(card.locator(".progress-facts")).toContainText("2024");
  await expect(card.getByText("ZIP-Datei: wird abgelegt")).toBeVisible();
  await card.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await bestaetigen(page, "Übernehmen");
  await expect(card.getByText(/Übernommen am .*: 4 neu, 0 übersprungen, 4 Belegbilder/)).toBeVisible({ timeout: 60_000 });

  // Abgleich je Jahr mit den Belegen aus dem Export (#1106)
  await gehe(page, "/archiv");
  await page.getByRole("button", { name: "Umzug aus sevDesk", exact: true }).click();
  const jahr = page.getByRole("region", { name: "Geschäftsjahr 2024" });
  await expect(jahr.getByRole("listitem").filter({ hasText: "Belege aus dem sevDesk-Export übernommen" })).toContainText("4 Belege, 4 mit Datei");
  await expect(jahr.getByRole("listitem").filter({ hasText: "Jeder Beleg hat eine Datei" })).toContainText("alle mit Datei");
  await expect(jahr.getByText("Belege und Rechnungen per API abgerufen")).toHaveCount(0);

  await page.getByRole("navigation", { name: "Bereich wählen" }).getByRole("link", { name: "Belege", exact: true }).click();
  await page.getByRole("link", { name: /XX-1111-11-1111/ }).click();
  await expect(page.getByRole("heading", { name: "XX-1111-11-1111" })).toBeVisible();
  await expect(page.getByTitle(/Datei 2024-01-15_Rechnung_XX-1111-11-1111/)).toBeVisible();
  expect(pageErrors).toEqual([]);
});
