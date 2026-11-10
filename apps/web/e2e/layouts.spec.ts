import { type Browser, expect, type Page, test } from "@playwright/test";
import { SESSION } from "./daten.ts";

/*
 * Eigene Belegvorlagen (#113): hochladen mit Prüfung, Rückfrage bei Paketen, zuordnen, in der Vorschau sehen, löschen.
 * Nutzt das Angebot, damit Tests der Rechnungsvorschau in anderen Dateien nicht das eigene Layout sehen.
 */

test.describe.configure({ mode: "serial" });

async function einstellungen(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, storageState: SESSION })).newPage();
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  return page;
}

const karte = (p: Page) => p.getByRole("region", { name: "Layouts", exact: true });
const hochladen = (p: Page) => karte(p).getByRole("form", { name: "Layout hochladen" });

async function datei(page: Page, name: string, inhalt: string) {
  await hochladen(page).getByLabel("Name").fill(name);
  await hochladen(page)
    .getByLabel("Typst-Datei")
    .setInputFiles({ name: `${name}.typ`, mimeType: "text/plain", buffer: Buffer.from(inhalt) });
  await hochladen(page).getByRole("button", { name: "Prüfen und speichern" }).click();
}

const startvorlage = async (page: Page) => (await page.request.get("/api/belegvorlagen?datei=start&art=beleg")).text();
const ROT = `#place(top + left, dx: 5mm, dy: 5mm, text(14pt, fill: rgb("#d40000"))[EIGENES LAYOUT])`;

test("Ein Layout ohne Pflichtangaben wird abgelehnt und nicht gespeichert", async ({ browser }) => {
  const page = await einstellungen(browser);
  await datei(page, "Nur Titel", "#let d = json(bytes(sys.inputs.data))\n= #d.title");
  await expect(hochladen(page).locator(".banner")).toContainText("Es fehlt");
  await expect(karte(page).getByText("Nur Titel", { exact: true })).toHaveCount(0);
  await page.context().close();
});

test("Bei Paketen fragt Haben erst nach; Abbrechen speichert nichts", async ({ browser }) => {
  const page = await einstellungen(browser);
  await datei(page, "Mit Paket", `#import "@preview/cetz:0.3.4"\n${await startvorlage(page)}`);
  const frage = page.getByRole("dialog", { name: "Pakete aus dem Netz laden?" });
  await expect(frage).toContainText("@preview/cetz:0.3.4");
  await frage.getByRole("button", { name: "Abbrechen" }).click();
  await expect(karte(page).getByText("Mit Paket", { exact: true })).toHaveCount(0);
  await page.context().close();
});

test("Hochladen, dem Angebot zuordnen, in der Vorschau sehen und löschen", async ({ browser }) => {
  const page = await einstellungen(browser);
  await datei(page, "Rotes Angebot", `${await startvorlage(page)}\n${ROT}\n`);
  await expect(hochladen(page).locator(".banner")).toContainText("Geprüft und gespeichert");
  const auswahl = karte(page).getByLabel("Layout für Angebot");
  try {
    await auswahl.selectOption({ label: "Rotes Angebot" });
    await expect(karte(page).getByRole("status").first()).toContainText("Gespeichert");

    await page.goto("/angebote/neu");
    await page.waitForLoadState("networkidle");
    await page.locator(".main > .page-head").getByRole("button", { name: "Vorschau", exact: true }).click();
    const bild = page.getByRole("dialog", { name: "Vorschau" }).locator(".sheet-page img").first();
    await expect(bild).toBeVisible();
    await expect.poll(() => bild.evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text())).toContain('fill="#d40000"');
  } finally {
    await page.goto("/einstellungen?bereich=gestaltung");
    await page.waitForLoadState("networkidle");
    const zeile = karte(page).getByRole("listitem").filter({ hasText: "Rotes Angebot" });
    await zeile.getByRole("button", { name: "Löschen" }).click();
    await page
      .getByRole("dialog", { name: /Layout „Rotes Angebot“ löschen\?/ })
      .getByRole("button", { name: "Layout löschen" })
      .click();
    await expect(karte(page).getByText("Rotes Angebot", { exact: true })).toHaveCount(0);
  }
  await expect(karte(page).getByLabel("Layout für Angebot")).toHaveValue("eingebaut:klassisch");
  await page.context().close();
});

test("Die Downloads liefern die eingebauten Layouts, Beispieldaten, Feldvertrag und Anleitung", async ({ browser }) => {
  const page = await einstellungen(browser);
  expect(await startvorlage(page)).toContain("json(bytes(sys.inputs.data))");
  const beispiele = (await (await page.request.get("/api/belegvorlagen?datei=beispiele&art=mahnung")).json()) as { name: string }[];
  expect(beispiele.map((b) => b.name)).toContain("Mahnung");
  const vertrag = (await (await page.request.get("/api/belegvorlagen?datei=feldvertrag")).json()) as { version: number };
  expect(vertrag.version).toBe(1);
  expect(await (await page.request.get("/api/belegvorlagen?datei=anleitung")).text()).toContain('name: "belegvorlage"');
  await page.context().close();
});
