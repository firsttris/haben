import { expect, type Locator, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { firstLink, SESSION } from "./daten.ts";
import { databaseUrlFuer } from "./durchlaeufe.ts";

/**
 * Reihenfolge von Statuswort und Auskunft (DESIGN.md › Status › Anordnung): Steht der Status am Desktop rechts in einer
 * Zeile (SEPA-Mandat), steht am Handy das Wort am Ende; steht er neben dem Titel (Bankverbindung neben dem Banknamen,
 * Seitenkopf), kommt das Wort zuerst. Dazu, dass die Knöpfe dieser Karten am Handy die Zeile füllen (DESIGN.md › Knöpfe ›
 * Ausrichtung). Mit den Daten und der Sitzung aus app.spec.ts (Projekt „mit-daten“); legt eine Bankverbindung über SQL
 * an, weil der Abruf eine echte Bank bräuchte.
 */

test.use({ storageState: SESSION });
// Ein Worker für alle Tests, damit beforeAll die Bankverbindung nur einmal anlegt
test.describe.configure({ mode: "serial" });

const HANDY = { width: 375, height: 812 };
const DESKTOP = { width: 1440, height: 900 };
const BANK = "Statusbank Musterstadt";
const ARTIKEL = "Statusartikel Listenknopf";

test.beforeAll(async () => {
  const sql = postgres(databaseUrlFuer(), { max: 1 });
  await sql.begin(async (tx) => {
    await tx`select set_config('haben.actor', 'e2e', true)`;
    await tx`delete from bank_connections where aspsp_name = ${BANK}`;
    // Läuft in 5 Tagen ab: dringend, mit langer Auskunft
    await tx`insert into bank_connections (aspsp_name, aspsp_country, psu_type, status, valid_until, accounts, last_sync_at)
      values (${BANK}, 'DE', 'business', 'aktiv', now() + interval '5 days', '[]', now())`;
    // Ein Artikel, damit die Liste unter /artikel eine Zeile mit kleinen Knöpfen hat
    await tx`delete from articles where description = ${ARTIKEL}`;
    await tx`insert into articles (description, unit, unit_price, tax_rate) values (${ARTIKEL}, 'Stück', 1000, 1900)`;
  });
  await sql.end();
});

/** Wort zuerst oder am Ende; dazu, wie weit das Wort vom rechten Rand der Zeile entfernt endet */
async function reihenfolge(status: Locator, zeile: Locator) {
  await expect(status.locator(".status-detail")).toBeVisible();
  const rand = await zeile.evaluate((e) => e.getBoundingClientRect().right);
  return status.evaluate((e, rechts) => {
    const wort = e.querySelector(".status-label")?.getBoundingClientRect();
    const auskunft = e.querySelector(".status-detail")?.getBoundingClientRect();
    if (!wort || !auskunft) throw new Error("Status ohne Wort oder Auskunft");
    return { wortZuerst: wort.left < auskunft.left, wortRechts: rechts - wort.right };
  }, rand);
}

async function bankZeile(page: Page) {
  await page.goto("/bank");
  await page.waitForLoadState("networkidle");
  const zeile = page.getByRole("region", { name: "Automatischer Abruf" }).locator(".history-row", { hasText: BANK });
  return { zeile, status: zeile.locator(".status") };
}

async function mandatZeile(page: Page) {
  await page.goto("/kontakte");
  await page
    .getByRole("region", { name: "Kontaktliste" })
    .getByRole("link", { name: /Rheinpixel GmbH/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  const zeile = page
    .locator("section.card", { has: page.locator("#mandate-heading") })
    .locator(".history-row")
    .first();
  return { zeile, status: zeile.locator(".status") };
}

test("Handy: Statuswort rechts in der Zeile am Ende, neben dem Titel zuerst", async ({ page }) => {
  await page.setViewportSize(HANDY);
  const mandat = await mandatZeile(page);
  const r = await reihenfolge(mandat.status, mandat.zeile);
  expect(r.wortZuerst).toBe(false);
  // Das Wort endet an der rechten Kante der Zeile
  expect(Math.abs(r.wortRechts)).toBeLessThanOrEqual(8);

  const bank = await bankZeile(page);
  expect((await reihenfolge(bank.status, bank.zeile)).wortZuerst).toBe(true);

  const rechnung = await firstLink(page, "/rechnungen", /^\/rechnungen\/[0-9a-f-]{36}$/);
  await page.goto(rechnung ?? "");
  const status = page.locator(".main > .page-head .title-with-status .status");
  await page.waitForLoadState("networkidle");
  // Im Entwicklungsserver kommen die Styles nach; bis dahin erneut messen
  await expect.poll(async () => (await reihenfolge(status, status)).wortZuerst).toBe(true);
});

/** Linke Kante des ersten und rechte Kante des letzten Knopfs einer Knopfzeile, gemessen an der Zeile darum */
async function knopfRaender(zeile: Locator) {
  const knoepfe = zeile.locator(".actions > .btn");
  await expect(knoepfe.first()).toBeVisible();
  const rahmen = await zeile.evaluate((e) => e.getBoundingClientRect());
  const erster = await knoepfe.first().evaluate((e) => e.getBoundingClientRect());
  const letzter = await knoepfe.last().evaluate((e) => e.getBoundingClientRect());
  return { rechts: rahmen.right - letzter.right, links: erster.left - rahmen.left };
}

test("Handy: Knöpfe in den Karten füllen die Zeile", async ({ page }) => {
  await page.setViewportSize(HANDY);
  // Automatischer Abruf: „Trennen“ vorn an der linken, „Jetzt abrufen“ an der rechten Kante
  const bank = await knopfRaender((await bankZeile(page)).zeile);
  expect(Math.abs(bank.links)).toBeLessThanOrEqual(1);
  expect(Math.abs(bank.rechts)).toBeLessThanOrEqual(1);
  // SEPA-Mandat: neben dem Link „Mandat als PDF“ reicht der kleine Knopf bis an die rechte Kante
  const mandat = await knopfRaender((await mandatZeile(page)).zeile);
  expect(Math.abs(mandat.rechts)).toBeLessThanOrEqual(1);
});

test("Handy: kleine Knöpfe in Listen wie Tabellen (div.table) bleiben so breit wie ihr Text", async ({ page }) => {
  // DESIGN.md › Knöpfe › Ausrichtung: btn-sm in Tabellen bleibt schmal; die Listen von Artikeln, Leistungen und
  // Textbausteinen sind Tabellen aus div.table
  await page.setViewportSize(HANDY);
  await page.goto("/artikel");
  const zeile = page.locator(".table-row", { hasText: ARTIKEL });
  const knopf = zeile.locator(".actions > .btn-sm").first();
  await expect(knopf).toBeVisible();
  const { breite, noetig } = await knopf.evaluate((el) => {
    const s = getComputedStyle(el);
    const r = document.createRange();
    r.selectNodeContents(el);
    const rand = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"] as const;
    return {
      breite: el.getBoundingClientRect().width,
      noetig: r.getBoundingClientRect().width + rand.reduce((sum, k) => sum + Number.parseFloat(s[k]), 0),
    };
  });
  // Nur Text, Innenabstand und Rand, kein Wachsen in die Zeile
  expect(breite).toBeLessThanOrEqual(noetig + 2);
});

test("Desktop: Statuswort in Karten zuerst", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  for (const finden of [bankZeile, mandatZeile]) {
    const { zeile, status } = await finden(page);
    expect((await reihenfolge(status, zeile)).wortZuerst).toBe(true);
  }
});
