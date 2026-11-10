import { devices, expect, type Page, test } from "@playwright/test";
import { filePickerPruefen, uploadButtonPruefen } from "./dateiauswahl.ts";
import { SESSION } from "./daten.ts";

/**
 * Die Felder für Zertifikat und privaten Schlüssel liegen in `Field`, und `Field` umschließt seine Felder
 * bewusst nicht mit einem `<label>` (apps/web/src/components/Field.tsx). Der Klick auf „Datei wählen“
 * muss deshalb aus `FilePicker` selbst kommen — vorher blieb der Knopf dort ohne Wirkung, weil ihn erst
 * ein umschließendes `<label>` zum Auslöser machte. Mit den Daten und der Sitzung aus app.spec.ts
 * (Projekt „mit-daten“).
 */

test.use({ storageState: SESSION });

/** Erst nach dem Hydrieren hängt der Klick-Handler am Knopf; ein früher Klick ginge ins Leere */
async function oeffnen(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test("Datei wählen öffnet den Dateidialog auch ohne umschließendes label", async ({ page }) => {
  await oeffnen(page, "/einstellungen?bereich=email");
  await page.getByLabel("Versandweg").selectOption("graph");

  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Datei wählen", { exact: true }).first().click()]);
  await chooser.setFiles({ name: "zertifikat.pem", mimeType: "application/x-pem-file", buffer: Buffer.from("-----BEGIN CERTIFICATE-----\n") });

  await expect(page.getByText("zertifikat.pem")).toBeVisible();
});

test("Datei wählen in einem umschließenden label öffnet genau einen Dialog", async ({ page }) => {
  await oeffnen(page, "/csv-import?art=kontakte");
  let dialoge = 0;
  page.on("filechooser", () => {
    dialoge += 1;
  });

  await page.getByText("Datei wählen", { exact: true }).first().click();
  await page.waitForTimeout(1500);

  expect(dialoge).toBe(1);
});

test("Die Tastatur öffnet den Dateidialog am Eingabefeld", async ({ page }) => {
  await oeffnen(page, "/csv-import?art=kontakte");
  await page.locator(".file-picker input[type=file]").first().focus();

  await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), page.keyboard.press("Enter")]);
});

test("Nach dem Klick auf Datei wählen liegt der Fokus auf dem Eingabefeld, Tab führt zum nächsten Feld", async ({ page }) => {
  await oeffnen(page, "/csv-import?art=kontakte");

  await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), page.getByText("Datei wählen", { exact: true }).first().click()]);
  await expect(page.locator(".file-picker input[type=file]").first()).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Trennzeichen")).toBeFocused();
});

// Die übrigen Dateiauswahlen: sichtbare Felder über FilePicker in Field, Upload-Aktionen über UploadButton
// (DESIGN.md, „Datei-Felder“). Vermerke zu SV-Meldungen und Voranmeldung prüfen gmbh.spec.ts und belege-steuern.spec.ts
// in ihrem Ablauf, dort gibt es die Daten dafür.

test("CSV-Datei des BMF: FilePicker im Feld, Klick und Tastatur öffnen je genau einen Dialog", async ({ page }) => {
  await oeffnen(page, "/einstellungen?bereich=waehrung");
  await filePickerPruefen(page, page.locator(".field", { has: page.getByText("Datei", { exact: true }) }), "Umrechnungskurse");
});

test("Graph-Versand: Der Hinweis im Feld beschreibt das Eingabefeld des FilePicker", async ({ page }) => {
  await oeffnen(page, "/einstellungen?bereich=email");
  await page.getByLabel("Versandweg").selectOption("graph");
  const feld = page.locator(".field", { has: page.getByText("Privater Schlüssel (PEM)", { exact: true }) });
  await expect(feld.locator("input[type=file]")).toHaveAccessibleDescription("Ohne Passwort. Bleibt verschlüsselt auf dem Server.");
  await filePickerPruefen(page, feld, "Privater Schlüssel");
});

test("Upload-Knöpfe: Klick und Tastatur öffnen an jeder Stelle genau einen Dialog", async ({ page }) => {
  await oeffnen(page, "/belege");
  await uploadButtonPruefen(page, page.getByRole("button", { name: "Dateien auswählen" }), "Belege");

  await oeffnen(page, "/bank");
  await uploadButtonPruefen(page, page.getByRole("button", { name: "CSV / CAMT importieren" }), "Bank");

  await oeffnen(page, "/einstellungen?bereich=rechnungen");
  await uploadButtonPruefen(page, page.getByRole("button", { name: "PDF anhängen" }).first(), "Standardanhänge");

  await oeffnen(page, "/einstellungen?bereich=gestaltung");
  await uploadButtonPruefen(page, page.getByRole("button", { name: /^(Logo hochladen|Anderes Logo wählen)$/ }), "Logo");
  await uploadButtonPruefen(page, page.getByRole("button", { name: /^(Briefpapier hochladen|Anderes Briefpapier wählen)$/ }), "Briefpapier");

  // Das Mandat mit PDF legt app.spec.ts an
  await oeffnen(page, "/kontakte");
  await page
    .getByRole("region", { name: "Kontaktliste" })
    .getByRole("link", { name: /Rheinpixel GmbH/ })
    .first()
    .click();
  const mandate = page.getByRole("region", { name: "SEPA-Lastschriftmandate" });
  await uploadButtonPruefen(page, mandate.getByRole("button", { name: /PDF hinterlegen$/ }).first(), "Mandat");
});

test("Foto aufnehmen am Handy: der Knopf öffnet genau einen Dialog", async ({ browser }) => {
  const handy = await browser.newContext({ ...devices["Pixel 7"], storageState: SESSION });
  const page = await handy.newPage();
  await oeffnen(page, "/belege");
  await uploadButtonPruefen(page, page.getByRole("button", { name: "Foto aufnehmen" }), "Kamera");
  await handy.close();
});
