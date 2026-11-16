import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import postgres from "postgres";
import { databaseUrlFuer } from "./durchlaeufe.ts";
import { einrichten, gehe } from "./einrichtung.ts";

/*
 * Update auf das Journal als einzige Quelle (#1116): ein Jahr, dessen Abweichung beim Update übernommen wurde
 * (HABEN_ABWEICHUNG_UEBERNEHMEN). Für März 2026 sind 1.000 € in Kz 81 gesendet, das Journal kennt sie nicht. Die
 * Berichtigung beginnt mit den gesendeten Werten und zeigt je Kennzahl gesendet, Journal und Differenz (#1200).
 */
test.describe.configure({ mode: "serial" });
let page: Page;
let sql: ReturnType<typeof postgres>;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin" })).newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await einrichten(page);
  const url = databaseUrlFuer("umstellung");
  if (!new URL(url).pathname.endsWith("_e2e")) throw new Error("Eigene E2E-Datenbank fehlt.");
  sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql`insert into vat_frequencies (year, from_month, frequency) values (2026, 1, 'monatlich')`;
  await sql`insert into vat_returns (year, month, kz81, kz83, status, source, computed, sent_at, locked_at, transfer_ticket)
    values (2026, 3, 100000, 19000, 'sent', 'berechnet', '{"kz81": 100000, "kz83": 19000}'::jsonb, '2026-04-10T10:00:00Z', '2026-04-10T10:00:00Z', 'ABC123456789')`;
  const befunde = [{ jahr: 2026, text: "2026-03 Voranmeldung (gesendet), Kz 81: im Journal 0,00 €, gesendet 1.000,00 €" }];
  await sql`insert into journal_umstellung (stichjahr_vorher, ergebnis, befunde) values (2027, 'uebernommen', ${JSON.stringify(befunde)}::jsonb)`;
});

test.afterAll(async () => {
  await sql?.end();
  await page?.context().close();
  expect(errors).toEqual([]);
});

test("Berichtigung in einem übernommenen Jahr beginnt mit den gesendeten Werten und zeigt die Differenz zum Journal", async () => {
  await gehe(page, "/umsatzsteuer/2026-03");
  await page.getByRole("button", { name: "Berichtigte Anmeldung anlegen", exact: true }).click();
  await expect(page.getByText("Berichtigte Anmeldung angelegt.")).toBeVisible();
  const formular = page.getByRole("form", { name: "Kennzahlen" });

  await expect(formular.getByRole("button", { name: "Manuell überschreiben" })).toHaveAttribute("aria-pressed", "true");
  await expect(formular.getByLabel("Begründung der Abweichung (Pflicht)")).toHaveValue(/2026 beim Update auf das Journal übernommen/);
  const vergleich = formular.getByRole("table", { name: "Gesendet und Journal je Kennzahl" });
  await expect(vergleich.getByRole("row", { name: /^81/ })).toHaveText(/1\.000,00\s€.*0,00\s€.*[−-]1\.000,00\s€/);
  await expect(vergleich.getByRole("row", { name: /^83/ })).toHaveText(/190,00\s€.*0,00\s€.*[−-]190,00\s€/);

  if (process.env.UMSTELLUNG_SCREENSHOTS) {
    await mkdir("test-results/umstellung-bilder", { recursive: true });
    for (const theme of ["light", "dark"])
      for (const [device, viewport] of [
        ["desktop", { width: 1280, height: 900 }],
        ["handy", { width: 375, height: 812 }],
      ] as const) {
        await page.setViewportSize(viewport);
        await page.evaluate((t) => {
          document.documentElement.dataset.mode = t;
        }, theme);
        // Vorher das ganze Formular (kurz), nachher der neue Vergleich: Beim langen Formular schöbe sich der feste Kopf ins Bild
        const ziel = process.env.UMSTELLUNG_SCREENSHOTS === "vorher" ? formular : formular.getByRole("note");
        await ziel.screenshot({
          path: `test-results/umstellung-bilder/berichtigung-${theme === "light" ? "hell" : "dunkel"}-${device}-${process.env.UMSTELLUNG_SCREENSHOTS}.png`,
        });
      }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});
