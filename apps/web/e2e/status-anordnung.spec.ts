import { expect, type Locator, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { firstLink, SESSION } from "./daten.ts";
import { databaseUrlFuer } from "./durchlaeufe.ts";

/**
 * Reihenfolge von Statuswort und Auskunft (DESIGN.md › Status › Anordnung): Am Handy steht das Wort an der Kante einer
 * Zeile am Ende (Karten wie Bankverbindung und SEPA-Mandat), allein in eigener Zeile wie im Seitenkopf zuerst. Am Desktop
 * kommt das Wort überall zuerst. Mit den Daten und der Sitzung aus app.spec.ts (Projekt „mit-daten“); legt eine
 * Bankverbindung über SQL an, weil der Abruf eine echte Bank bräuchte.
 */

test.use({ storageState: SESSION });
// Ein Worker für beide Tests, damit beforeAll die Bankverbindung nur einmal anlegt
test.describe.configure({ mode: "serial" });

const HANDY = { width: 375, height: 812 };
const DESKTOP = { width: 1440, height: 900 };
const BANK = "Statusbank Musterstadt";

test.beforeAll(async () => {
  const sql = postgres(databaseUrlFuer(), { max: 1 });
  await sql.begin(async (tx) => {
    await tx`select set_config('haben.actor', 'e2e', true)`;
    await tx`delete from bank_connections where aspsp_name = ${BANK}`;
    // Läuft in 5 Tagen ab: dringend, mit langer Auskunft
    await tx`insert into bank_connections (aspsp_name, aspsp_country, psu_type, status, valid_until, accounts, last_sync_at)
      values (${BANK}, 'DE', 'business', 'aktiv', now() + interval '5 days', '[]', now())`;
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

test("Handy: in Karten steht das Statuswort an der Kante am Ende, im Seitenkopf zuerst", async ({ page }) => {
  await page.setViewportSize(HANDY);
  for (const finden of [bankZeile, mandatZeile]) {
    const { zeile, status } = await finden(page);
    const r = await reihenfolge(status, zeile);
    expect(r.wortZuerst).toBe(false);
    // Das Wort endet an der rechten Kante der Zeile
    expect(Math.abs(r.wortRechts)).toBeLessThanOrEqual(8);
  }

  const rechnung = await firstLink(page, "/rechnungen", /^\/rechnungen\/[0-9a-f-]{36}$/);
  await page.goto(rechnung ?? "");
  const status = page.locator(".main > .page-head .title-with-status .status");
  await page.waitForLoadState("networkidle");
  // Im Entwicklungsserver kommen die Styles nach; bis dahin erneut messen
  await expect.poll(async () => (await reihenfolge(status, status)).wortZuerst).toBe(true);
});

test("Desktop: Statuswort in Karten zuerst", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  for (const finden of [bankZeile, mandatZeile]) {
    const { zeile, status } = await finden(page);
    expect((await reihenfolge(status, zeile)).wortZuerst).toBe(true);
  }
});
