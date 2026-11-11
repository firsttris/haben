import { expect, type FileChooser, type Locator, type Page } from "@playwright/test";

/**
 * Prüfungen für die zwei Muster der Dateiauswahl (DESIGN.md, „Datei-Felder“): `FilePicker` in einem `Field` und
 * `UploadButton` für Upload-Aktionen ohne Formularfeld. Beide öffnen den Dialog per Klick und per Tastatur, und zwar
 * genau einen: Öffnete ein umschließendes `<label>` ihn noch einmal, stünden zwei Dialoge übereinander.
 */

/** Führt die Aktion aus und erwartet genau einen Dateidialog; gibt ihn zurück, damit der Test Dateien wählen kann */
export async function genauEinDialog(page: Page, aktion: () => Promise<unknown>, wo: string): Promise<FileChooser> {
  let dialoge = 0;
  const zaehlen = () => {
    dialoge += 1;
  };
  page.on("filechooser", zaehlen);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5_000 }), aktion()]);
  // Ein zweiter Dialog aus demselben Klick käme sofort hinterher
  await page.waitForTimeout(500);
  page.off("filechooser", zaehlen);
  expect(dialoge, `${wo}: genau ein Dateidialog`).toBe(1);
  return chooser;
}

/**
 * `FilePicker` in einem `Field`: deutscher Knopf statt „Choose File“, der Feldname benennt das Eingabefeld, ein Hinweis
 * im Feld beschreibt es, Klick und Tastatur öffnen je genau einen Dialog. Gibt den Dialog aus dem Klick zurück.
 */
export async function filePickerPruefen(page: Page, feld: Locator, wo: string): Promise<FileChooser> {
  const picker = feld.locator(".file-picker");
  await expect(picker, `${wo}: FilePicker`).toBeVisible();
  await expect(picker.locator(".btn"), `${wo}: deutsche Beschriftung`).toHaveText(/^Datei(en)? wählen$/);
  const input = picker.locator("input[type=file]");
  const name = ((await feld.locator(".field-label").textContent()) ?? "").trim();
  await expect(feld.getByLabel(name, { exact: true }), `${wo}: Feldname benennt das Eingabefeld`).toHaveCount(1);
  const hinweis = feld.locator(".field-hint");
  if ((await hinweis.count()) > 0)
    await expect(input, `${wo}: Hinweis als aria-describedby`).toHaveAccessibleDescription(((await hinweis.textContent()) ?? "").trim());

  await input.focus();
  await genauEinDialog(page, () => page.keyboard.press("Enter"), `${wo}, Tastatur`);
  return genauEinDialog(page, () => picker.locator(".btn").click(), `${wo}, Klick`);
}

/**
 * `UploadButton`: ein echter Knopf (per Tab erreichbar), das Eingabefeld dahinter ist nicht fokussierbar; Klick und
 * Enter am Knopf öffnen je genau einen Dialog. Gibt den Dialog aus dem Klick zurück.
 */
export async function uploadButtonPruefen(page: Page, knopf: Locator, wo: string): Promise<FileChooser> {
  await expect(knopf, `${wo}: Knopf`).toBeVisible();
  await knopf.focus();
  await expect(knopf, `${wo}: Knopf fokussierbar`).toBeFocused();
  await genauEinDialog(page, () => page.keyboard.press("Enter"), `${wo}, Tastatur`);
  return genauEinDialog(page, () => knopf.click(), `${wo}, Klick`);
}
