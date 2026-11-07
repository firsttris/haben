import { expect, type Locator, type Page, test } from "@playwright/test";
import { firstLink, SESSION, YEAR } from "./daten.ts";

/**
 * Fester Seitenkopf (#356): Titel, Status und Hauptaktionen bleiben beim Scrollen stehen, in den Einstellungen auch
 * die Bereiche. Was unter dem Kopf steht (Tabellenköpfe, Felder mit Fokus), verschwindet nicht dahinter.
 * Mit den Daten und der Sitzung aus app.spec.ts (Projekt „mit-daten“); geschrieben wird nichts.
 */

test.use({ storageState: SESSION });

/** Laptop mit 14 Zoll (#355) und Handy */
const LAPTOP = { width: 1470, height: 800 };
const HANDY = { width: 375, height: 812 };

async function zumEnde(p: Page): Promise<void> {
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // Sonst prüft der Test nichts: die Seite muss lang genug sein, dass der Kopf ohne Fixierung verschwände
  expect(await p.evaluate(() => window.scrollY)).toBeGreaterThan(200);
}

/** Unterkante des stehenden Seitenkopfs im Fenster */
function kopfUnterkante(p: Page): Promise<number> {
  return p.locator(".main > .page-head").evaluate((head) => head.getBoundingClientRect().bottom);
}

/** Ganz im Fenster und von nichts verdeckt: In der Mitte des Elements liegt das Element selbst */
async function sichtbar(element: Locator): Promise<void> {
  await expect(element).toBeInViewport({ ratio: 1 });
  const obenauf = await element.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && (hit === el || el.contains(hit));
  });
  expect(obenauf, "verdeckt").toBe(true);
}

for (const [geraet, viewport] of [
  ["Laptop", LAPTOP],
  ["Handy", HANDY],
] as const) {
  test(`Rechnungsentwurf am ${geraet}: Titel, Status und Aktionen bleiben beim Scrollen sichtbar`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/rechnungen/neu");
    const head = page.locator(".main > .page-head");
    await expect(head.getByRole("heading", { level: 1 })).toBeVisible();
    // Ungescrollt ohne Trennlinie, gescrollt mit
    await expect(page.locator(".shell")).not.toHaveAttribute("data-scrolled");
    await zumEnde(page);
    await expect(page.locator(".shell")).toHaveAttribute("data-scrolled");
    await sichtbar(head.getByRole("heading", { level: 1 }));
    await sichtbar(head.getByText("Entwurf", { exact: false }).first());
    await sichtbar(head.getByRole("button", { name: "Entwurf speichern" }));
    await sichtbar(head.getByRole("button", { name: "Festschreiben" }));
  });

  test(`Einstellungen am ${geraet}: Kopf und Bereiche bleiben stehen, nur der Inhalt scrollt`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/einstellungen?bereich=firma");
    await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
    await zumEnde(page);
    await sichtbar(page.getByRole("heading", { level: 1, name: "Einstellungen" }));
    const bereiche = page.getByRole("navigation", { name: "Bereiche der Einstellungen" });
    await sichtbar(bereiche.locator("[aria-current=page]"));
    // Die Bereiche stehen unter dem Kopf, nicht dahinter
    const oben = await bereiche.evaluate((nav) => nav.getBoundingClientRect().top);
    expect(oben).toBeGreaterThanOrEqual((await kopfUnterkante(page)) - 1);
  });
}

test("Rechnung und Angebot am Handy: Status bleibt neben dem Titel sichtbar", async ({ page }) => {
  const rechnung = await firstLink(page, "/rechnungen", /^\/rechnungen\/[0-9a-f-]{36}$/);
  const angebot = await firstLink(page, "/angebote", /^\/angebote\/[0-9a-f-]{36}$/);
  await page.setViewportSize(HANDY);
  for (const path of [rechnung, angebot]) {
    expect(path).not.toBeNull();
    await page.goto(path as string);
    const head = page.locator(".main > .page-head");
    await expect(head.getByRole("heading", { level: 1 })).toBeVisible();
    await zumEnde(page);
    await sichtbar(head.getByRole("heading", { level: 1 }));
    await sichtbar(head.locator(".pill").first());
  }
});

test("Tab durch den langen Rechnungsentwurf: kein Feld mit Fokus liegt unter dem Kopf", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await page.goto("/rechnungen/neu");
  await page.locator("#invoice-form").locator("select, input").first().focus();
  const viewportHeight = LAPTOP.height;
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      // Am Ende der Seite verlässt der Fokus den Inhalt (Adressleiste, dann Sprunglink): bis dahin ist alles geprüft
      if (!el?.closest(".main")) return "ende";
      if (el.closest(".page-head")) return null;
      const box = el.getBoundingClientRect();
      return { name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? el.tagName, top: box.top, bottom: box.bottom };
    });
    if (focus === "ende") break;
    if (!focus) continue;
    const kopf = await kopfUnterkante(page);
    expect(focus.top, `„${focus.name}“ liegt unter dem Kopf`).toBeGreaterThanOrEqual(kopf - 1);
    expect(focus.top, `„${focus.name}“ liegt unter dem Fensterrand`).toBeLessThan(viewportHeight);
  }
  // Der Test ist bis weit nach unten getabbt, sonst hätte der Kopf nie stehen müssen
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
});

test("Saldenliste: der Tabellenkopf steht unter dem Seitenkopf, nicht dahinter", async ({ page }) => {
  await page.setViewportSize({ width: LAPTOP.width, height: 500 });
  await page.goto(`/konten?jahr=${YEAR}`);
  const th = page.locator(".sticky-head thead th").first();
  await expect(th).toBeVisible();
  // In die Mitte der Tabelle: dort muss ihr Kopf stehen bleiben; am Seitenende wäre die Tabelle schon vorbei
  const mitte = await page.locator(".sticky-head").evaluate((table) => {
    const box = table.getBoundingClientRect();
    return window.scrollY + box.top + box.height / 2 - 200;
  });
  await page.evaluate((y) => window.scrollTo(0, y), mitte);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  const oben = await th.evaluate((cell) => cell.getBoundingClientRect().top);
  expect(oben).toBeGreaterThanOrEqual((await kopfUnterkante(page)) - 1);
  await sichtbar(th);
});
