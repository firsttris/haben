import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { SESSION, USER } from "./daten.ts";

/*
 * Verfahrensdokumentation aus der Instanz (#860) unter Einstellungen › Export, mit den Daten und der Sitzung aus
 * app.spec.ts (Projekt „mit-daten“): Angaben zum Betrieb ergänzen, Markdown herunterladen, Druckansicht, dunkler Modus
 * und Handy. Was im Dokument steht, prüft der Postgres-Test neben dem Modul (modules/verfahrensdoku).
 */

test.use({ storageState: SESSION });
test.describe.configure({ mode: "serial" });

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const ANGABEN: [string, string][] = [
  ["Verantwortlich", "Max Mustermann, vertreten durch Erika Mustermann"],
  ["Ort der Aufbewahrung", "Server im Büro in Regensburg"],
  ["Papierbelege und Scannen", "Es wird nicht gescannt."],
  ["Betrieb des Servers", "Selbst betrieben, Updates monatlich."],
  ["Datensicherung", "Täglich mit dem Backup-Container auf ein NAS."],
  ["Ablage von Schlüsseln und Passwörtern", "Im Passwortmanager."],
];

async function oeffnen(page: Page) {
  await page.goto("/einstellungen?bereich=export");
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Verfahrensdokumentation öffnen" }).click();
  await expect(page).toHaveURL(/\/einstellungen\/verfahrensdokumentation$/);
  await expect(page.getByRole("heading", { level: 1, name: "Verfahrensdokumentation" })).toBeVisible();
}

test("Angaben zum Betrieb ergänzen macht das Dokument vollständig", async ({ page }) => {
  await oeffnen(page);
  const dokument = page.getByRole("article");
  await expect(dokument.getByRole("listitem").filter({ hasText: `${USER.name} (${USER.email}): Inhaber` })).toBeVisible();
  await expect(dokument).toContainText("Die Anwendung meldet sich bei der Datenbank als „");

  const form = page.getByRole("form", { name: "Angaben zum Betrieb" });
  for (const [label, text] of ANGABEN) await form.getByLabel(label).fill(text);
  await form.getByRole("button", { name: "Angaben speichern" }).click();
  await expect(page.getByText("Angaben gespeichert.")).toBeVisible();
  await expect(page.locator(".page-head")).toContainText("Vollständig");
  await expect(dokument).toContainText("Betrieb des Servers: Selbst betrieben, Updates monatlich.");
  await expect(dokument.getByText("Fehlt:")).toHaveCount(0);

  // Nach dem Neuladen stehen die Angaben wieder im Formular
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(form.getByLabel("Datensicherung")).toHaveValue("Täglich mit dem Backup-Container auf ein NAS.");
});

test("Markdown herunterladen gibt dieselbe Fassung als Datei", async ({ page }) => {
  await oeffnen(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Als Markdown" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Verfahrensdokumentation-\d{4}-\d{2}-\d{2}\.md$/);
  const text = await readFile((await download.path())!, "utf8");
  expect(text).toMatch(/^# Verfahrensdokumentation/);
  expect(text).toMatch(/Stand: \d{4}-\d{2}-\d{2} · Haben \d+\.\d+\.\d+/);
  expect(text).toContain("## 5\\. Betriebsdokumentation: Zugänge und Rechte");
});

test("Druckansicht zeigt nur das Blatt, hell auch im dunklen Modus", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("haben-modus", "dunkel"));
  await oeffnen(page);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("article")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeHidden();
  await expect(page.getByRole("form", { name: "Angaben zum Betrieb" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Drucken" })).toBeHidden();
  const [hintergrund, schrift] = await page.getByRole("article").evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
  expect(hintergrund).toBe("rgb(255, 255, 255)");
  expect(schrift).toBe("rgb(0, 0, 0)");
});

for (const [name, viewport, modus] of [
  ["Handy, dunkel", { width: 390, height: 844 }, "dunkel"],
  ["Desktop, hell", { width: 1440, height: 900 }, "hell"],
] as const) {
  test(`Ohne Verstöße gegen WCAG und ohne waagrechtes Scrollen (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript((m) => localStorage.setItem("haben-modus", m), modus);
    await oeffnen(page);
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    // Knöpfe und Formular per Tastatur erreichbar
    await page.getByRole("button", { name: "Angaben speichern" }).focus();
    await expect(page.getByRole("button", { name: "Angaben speichern" })).toBeFocused();
  });
}
