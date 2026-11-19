import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { SESSION } from "./daten.ts";
import { CUSTOMERS } from "./einrichtung.ts";

/*
 * Einstellungen exportieren (#488) unter Einstellungen › Export, mit den Daten und der Sitzung aus app.spec.ts (Projekt
 * „mit-daten“). Was mitgeht und was nicht, prüfen die Tests neben dem Modul (modules/instanzwechsel).
 */

test.use({ storageState: SESSION });

test("lädt Firmendaten und Kontakte als ZIP herunter", async ({ page }) => {
  await page.goto("/einstellungen?bereich=export");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Einstellungen exportieren" });
  await expect(karte).toContainText("Zugangsdaten");

  const [download] = await Promise.all([page.waitForEvent("download"), karte.getByRole("link", { name: "Datei herunterladen" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Haben-Einstellungen-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  const datei = JSON.parse(strFromU8(zip["einstellungen.json"]!));
  expect(datei).toMatchObject({ format: "haben-einstellungen", version: 1, company: { name: "Mustermann IT · Max Mustermann", ort: "Regensburg" } });
  expect(datei.company).not.toHaveProperty("mcpEnabled");
  expect(datei.contacts.map((kontakt: { name: string }) => kontakt.name)).toEqual(expect.arrayContaining(CUSTOMERS.map((kunde) => kunde.name)));
});
