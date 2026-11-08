import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { SESSION } from "./daten.ts";

/**
 * Der einheitliche Bestätigungsdialog (ConfirmDialog, #404), am Festschreiben im Rechnungsentwurf: Geschrieben wird
 * nichts, jeder Test bricht ab. Die Durchläufe je Bereich bestätigen in ihren eigenen Specs.
 */

test.use({ storageState: SESSION });

async function neuerEntwurf(page: Page) {
  await page.goto("/rechnungen/neu");
  await page.getByLabel("Kunde").selectOption({ index: 1 });
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100");
  return page.locator(".main > .page-head").getByRole("button", { name: "Festschreiben" });
}

const rueckfrage = (page: Page) => page.getByRole("dialog", { name: /festschreiben\?$/ });

test("Der Dialog ist modal, nennt die Folgen und hat den Fokus auf Abbrechen, die Aktion steht rechts", async ({ page }) => {
  const ausloeser = await neuerEntwurf(page);
  await ausloeser.click();
  const dialog = rueckfrage(page);
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
  await expect(dialog).toContainText("nicht mehr änderbar");
  await expect(dialog.getByRole("button", { name: "Abbrechen" })).toBeFocused();
  await expect(dialog.getByRole("button")).toHaveText(["Abbrechen", "Festschreiben"]);
  await expect(page.getByRole("button", { name: "Jetzt festschreiben" })).toHaveCount(0);
});

test("Esc schließt ohne Aktion, der Fokus geht zurück auf den Auslöser", async ({ page }) => {
  const ausloeser = await neuerEntwurf(page);
  await ausloeser.focus();
  await page.keyboard.press("Enter");
  await expect(rueckfrage(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rueckfrage(page)).toHaveCount(0);
  await expect(ausloeser).toBeFocused();
  await expect(page).toHaveURL(/rechnungen\/neu$/);
});

test("Abbrechen schließt ohne Aktion, der Fokus geht zurück auf den Auslöser", async ({ page }) => {
  const ausloeser = await neuerEntwurf(page);
  await ausloeser.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // der Startfokus liegt auf Abbrechen
  await expect(rueckfrage(page)).toHaveCount(0);
  await expect(ausloeser).toBeFocused();
  await expect(page).toHaveURL(/rechnungen\/neu$/);
});

test("Ein Doppelklick auf den Auslöser führt nichts aus, der Dialog bleibt offen", async ({ page }) => {
  const ausloeser = await neuerEntwurf(page);
  await ausloeser.dblclick();
  await expect(rueckfrage(page)).toBeVisible();
  await expect(page).toHaveURL(/rechnungen\/neu$/);
});

for (const [name, viewport] of [
  ["Desktop", { width: 1440, height: 900 }],
  ["Handy", { width: 320, height: 720 }],
] as const) {
  for (const theme of ["wald", "nacht"]) {
    test(`Barrierefreiheit des Dialogs: ${name}, Theme ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("haben-theme", t), theme);
      await page.setViewportSize(viewport);
      const ausloeser = await neuerEntwurf(page);
      await ausloeser.click();
      await expect(rueckfrage(page)).toBeVisible();
      const { violations } = await new AxeBuilder({ page })
        .include("dialog")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}
