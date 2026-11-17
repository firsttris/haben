import { expect, type Page } from "@playwright/test";
import { gehe } from "./einrichtung.ts";

/** Ein erfundenes Original aus einem anderen Programm, gerendert als PDF ohne eingebettete E-Rechnung */
export async function fremdesPdf(page: Page, nummer: string): Promise<Buffer> {
  const seite = await page.context().newPage();
  await seite.setContent(
    `<html><body style="font-family: sans-serif"><h1>Rechnung ${nummer}</h1><p>Webdesign Meier, Nürnberg</p><p>Netto 4.000,00 €, USt 19 % 760,00 €</p></body></html>`,
  );
  const pdf = await seite.pdf({ format: "A4" });
  await seite.close();
  return pdf;
}

export async function formularOeffnen(page: Page): Promise<void> {
  await gehe(page, "/rechnungen");
  await page.getByRole("button", { name: "Ausgangsrechnung hochladen" }).click();
  await expect(page.getByRole("heading", { name: "Ausgangsrechnung hochladen" })).toBeVisible();
}

export async function datei(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.locator("input[type=file]").setInputFiles({ name, mimeType: "application/pdf", buffer });
  await expect(page.getByRole("form", { name: "Angaben zur Rechnung" })).toBeVisible();
}
