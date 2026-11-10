import { expect, test } from "@playwright/test";
import { SESSION } from "./daten.ts";

/**
 * Die Felder für Zertifikat und privaten Schlüssel liegen in `Field`, und `Field` umschließt seine Felder
 * bewusst nicht mit einem `<label>` (apps/web/src/components/Field.tsx). Der Klick auf „Datei wählen“
 * muss deshalb aus `FilePicker` selbst kommen — vorher blieb der Knopf dort ohne Wirkung, weil ihn erst
 * ein umschließendes `<label>` zum Auslöser machte. Mit den Daten und der Sitzung aus app.spec.ts
 * (Projekt „mit-daten“).
 */

test.use({ storageState: SESSION });

test("Datei wählen öffnet den Dateidialog auch ohne umschließendes label", async ({ page }) => {
  await page.goto("/einstellungen?bereich=email");
  await page.getByLabel("Versandweg").selectOption("graph");

  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Datei wählen", { exact: true }).first().click()]);
  await chooser.setFiles({ name: "zertifikat.pem", mimeType: "application/x-pem-file", buffer: Buffer.from("-----BEGIN CERTIFICATE-----\n") });

  await expect(page.getByText("zertifikat.pem")).toBeVisible();
});

test("Datei wählen in einem umschließenden label öffnet genau einen Dialog", async ({ page }) => {
  await page.goto("/csv-import?art=kontakte");
  let dialoge = 0;
  page.on("filechooser", () => {
    dialoge += 1;
  });

  await page.getByText("Datei wählen", { exact: true }).first().click();
  await page.waitForTimeout(1500);

  expect(dialoge).toBe(1);
});

test("Die Tastatur öffnet den Dateidialog am Eingabefeld", async ({ page }) => {
  await page.goto("/csv-import?art=kontakte");
  await page.locator(".file-picker input[type=file]").first().focus();

  await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), page.keyboard.press("Enter")]);
});
