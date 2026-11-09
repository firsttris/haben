import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
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

test("Festschreiben nennt Nummer, Kunde und Betrag über den Folgen", async ({ page }) => {
  const ausloeser = await neuerEntwurf(page);
  const kunde = (await page.getByLabel("Kunde").locator("option:checked").textContent())?.split(" · ")[0]?.trim() ?? "";
  await ausloeser.click();
  const dialog = rueckfrage(page);
  await expect(dialog.locator("dt")).toHaveText(["Nummer", "Kunde", "Betrag"]);
  await expect(dialog.locator("dd").nth(0)).toHaveText(/\d/);
  await expect(dialog.locator("dd").nth(1)).toContainText(kunde);
  await expect(dialog.locator("dd").nth(2)).toHaveText(/^\d[\d.]*,\d\d\s€$/);
  await expect(dialog.getByRole("heading", { name: "Rechnung festschreiben?" })).toBeVisible();
});

test("Eine Rechnung in Fremdwährung nennt den Betrag in dieser Währung, nicht in Euro", async ({ page }) => {
  const ausloeser = await neuerEntwurf(page);
  await page.getByLabel("Währung").fill("USD");
  await page.getByLabel(/^Kurs: 1 EUR/).fill("1,1");
  await ausloeser.click();
  await expect(rueckfrage(page).locator("dd").last()).toHaveText(/^119,00 USD$/);
});

test("Am Handy ist der Dialog ein Blatt von unten, die Aktion steht über Abbrechen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ausloeser = await neuerEntwurf(page);
  await ausloeser.click();
  const dialog = rueckfrage(page);
  await expect(dialog).toBeVisible();
  const blatt = await dialog.boundingBox();
  expect(blatt).toMatchObject({ x: 0, width: 390 });
  expect(Math.round((blatt?.y ?? 0) + (blatt?.height ?? 0))).toBe(844);
  const aktion = await dialog.getByRole("button", { name: "Festschreiben" }).boundingBox();
  const abbrechen = await dialog.getByRole("button", { name: "Abbrechen" }).boundingBox();
  expect(aktion?.y ?? 0).toBeLessThan(abbrechen?.y ?? 0);
  expect(aktion?.width).toBe(abbrechen?.width);
  expect(aktion?.width).toBeGreaterThan(340);
  expect(aktion?.height).toBeGreaterThanOrEqual(48);
  await expect(dialog.getByRole("button", { name: "Abbrechen" })).toBeFocused();
});

async function ziehen(page: Page, griff: Locator, strecke: number) {
  const box = await griff.boundingBox();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + strecke, { steps: 5 });
}

test("Am Handy schließt Wischen nach unten wie Abbrechen, ein kurzes Wischen federt zurück", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ausloeser = await neuerEntwurf(page);
  await ausloeser.focus();
  await page.keyboard.press("Enter");
  const dialog = rueckfrage(page);
  const unterkante = async () => {
    const box = await dialog.boundingBox();
    return Math.round((box?.y ?? 0) + (box?.height ?? 0));
  };

  await ziehen(page, dialog.locator(".confirm-dialog-grip"), 30);
  expect(await unterkante()).toBe(874);
  await page.mouse.up();
  expect(await unterkante()).toBe(844);

  await ziehen(page, dialog.getByRole("heading"), -40);
  expect(await unterkante()).toBe(844);
  await page.mouse.up();
  await expect(dialog).toBeVisible();

  await ziehen(page, dialog.locator(".confirm-dialog-grip"), 200);
  await page.mouse.up();
  await expect(dialog).toHaveCount(0);
  await expect(ausloeser).toBeFocused();
  await expect(page).toHaveURL(/rechnungen\/neu$/);
});

test("Am Desktop lässt sich der Dialog nicht wegziehen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ausloeser = await neuerEntwurf(page);
  await ausloeser.click();
  const dialog = rueckfrage(page);
  await expect(dialog.locator(".confirm-dialog-grip")).toBeHidden();
  const vorher = await dialog.boundingBox();
  await ziehen(page, dialog.getByRole("heading"), 200);
  expect(await dialog.boundingBox()).toEqual(vorher);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
});

test("Am Desktop bleibt der Dialog mittig", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ausloeser = await neuerEntwurf(page);
  await ausloeser.click();
  const box = await rueckfrage(page).boundingBox();
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0) / 2)).toBe(720);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan(900);
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

test("Scheitert die bestätigte Aktion, steht der Fokus wieder auf dem Auslöser", async ({ page }) => {
  const ausloeser = await neuerEntwurf(page);
  await ausloeser.focus();
  await page.keyboard.press("Enter");
  await expect(rueckfrage(page)).toBeVisible();
  await page.route("**/_serverFn/**", (route) => route.abort());
  await rueckfrage(page).getByRole("button", { name: "Festschreiben" }).click();
  await expect(rueckfrage(page)).toHaveCount(0);
  await expect(page.locator(".main").getByRole("alert").first()).toBeVisible();
  await expect(ausloeser).toBeEnabled();
  await expect(ausloeser).toBeFocused();
});

test("Scheitert Festschreiben weit unten im Formular, steht die Meldung im Fenster", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  const ausloeser = await neuerEntwurf(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await ausloeser.click();
  await expect(rueckfrage(page)).toBeVisible();
  await page.route("**/_serverFn/**", (route) => route.abort());
  await rueckfrage(page).getByRole("button", { name: "Festschreiben" }).click();
  await expect(ausloeser).toBeEnabled();
  await expect(page.locator(".main").getByRole("alert").first()).toBeInViewport();
});
