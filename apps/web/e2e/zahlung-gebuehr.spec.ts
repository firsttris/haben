import { expect, type Page, test } from "@playwright/test";
import { day } from "./daten.ts";
import { axeVerstoesse, CUSTOMERS, durchlaufSeite, einrichten, gehe, INVOICES, kontaktAnlegen, rechnungFestschreiben } from "./einrichtung.ts";

/**
 * Eigener Durchlauf zu #1417: Zahlung und Gebühr eines Zahlungsdienstleisters stehen in der Bankliste in einer Zeile und
 * lassen sich in einem Schritt zuordnen. Geprüft wird, was der Nutzer sieht und klickt; die Buchungen (SKR03/SKR04,
 * Ist/Soll, Gebühr an Beleg, Rücknahme) prüft bank/zahlung-gebuehr.test.ts.
 */
test.describe.configure({ mode: "serial" });

let page: Page;
let pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
});

test.afterAll(async () => {
  await page.context().close();
});

// Rheinpixel GmbH, 1.725,50 € brutto; Stripe behält 30,00 € ein
const RECHNUNG = INVOICES[2]!;
const zeilen = () => page.locator(".tx-row");
const panel = () => page.getByRole("complementary", { name: "Zuordnung" });

test("Einrichtung mit einer festgeschriebenen Rechnung und einem Stripe-Konto mit zwei Zahlungen", async () => {
  await einrichten(page);
  await kontaktAnlegen(page, CUSTOMERS[2]!);
  await rechnungFestschreiben(page, RECHNUNG);

  await gehe(page, "/bank");
  await page.getByRole("button", { name: "Konto hinzufügen" }).click();
  const neuesKonto = page.locator("form", { has: page.getByRole("button", { name: "Konto anlegen" }) });
  await neuesKonto.getByLabel("Art", { exact: true }).selectOption("provider");
  await neuesKonto.getByLabel("Dienstleister", { exact: true }).selectOption("stripe");
  await neuesKonto.getByLabel("Name", { exact: true }).fill("Stripe");
  await neuesKonto.getByRole("button", { name: "Konto anlegen" }).click();
  await expect(page.getByText("Konto angelegt.")).toBeVisible();

  const csv = [
    "balance_transaction_id,created_utc,available_on_utc,currency,gross,fee,net,reporting_category,description,customer_name",
    `txn_e2e_a,${day(-5)} 09:00:00,${day(2)} 00:00:00,eur,1725.50,30.00,1695.50,charge,,Rheinpixel GmbH`,
    `txn_e2e_b,${day(-4)} 10:30:00,${day(3)} 00:00:00,eur,40.00,1.45,38.55,charge,Spende,`,
  ].join("\n");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "stripe.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/4 neue Umsätze für Stripe/)).toBeVisible({ timeout: 30_000 });
});

test("Zahlung und Gebühr stehen in einer Zeile, die Gebühr unter dem Betrag", async () => {
  await gehe(page, "/bank?filter=offen");
  // Vier Umsätze (zwei Zahlungen, zwei Gebühren), zwei Zeilen, und der Reiter zählt Zeilen
  await expect(zeilen()).toHaveCount(2);
  await expect(page.getByRole("group", { name: "Filter" }).getByRole("link", { name: "Offen · 2" })).toBeVisible();
  const rheinpixel = zeilen().filter({ hasText: "Rheinpixel GmbH" });
  await expect(rheinpixel).toContainText("+1.725,50 €");
  await expect(rheinpixel).toContainText("Gebühr −30,00 €");
  await expect(zeilen().filter({ hasText: "Spende" })).toContainText("Gebühr −1,45 €");
  await expect(zeilen().filter({ hasText: "Gebühr · txn_" })).toHaveCount(0);
});

test("Zahlung ohne passenden Posten bietet die Gebühr nicht zum Mitbuchen an", async () => {
  await zeilen().filter({ hasText: "Spende" }).click();
  await page.waitForLoadState("networkidle");
  await expect(panel()).toBeVisible();
  await expect(panel().getByRole("checkbox", { name: /Gebühr .* mitbuchen/ })).toHaveCount(0);
  await expect(panel().getByRole("button", { name: "Zuordnen und Gebühr buchen" })).toHaveCount(0);
});

test("Zuordnen und Gebühr buchen: beide Umsätze sind erledigt, danach stehen sie einzeln da und lassen sich einzeln aufheben", async () => {
  await zeilen().filter({ hasText: "Rheinpixel GmbH" }).click();
  await page.waitForLoadState("networkidle");
  const mitbuchen = panel().getByRole("checkbox", { name: "Gebühr 30,00 € mitbuchen" });
  // Standard: aus. Die Gebühr eines Dienstleisters aus dem Ausland fällt meist unter § 13b, ihr Beleg gibt es erst später
  await expect(mitbuchen).not.toBeChecked();
  await expect(panel().getByRole("button", { name: "Zuordnen", exact: true })).toBeVisible();
  await expect(panel().getByLabel("Steuer der Gebühr")).toHaveCount(0);
  await expect(panel()).toContainText("Ohne Häkchen bleibt die Gebühr offen");
  await mitbuchen.check();
  await expect(panel()).toContainText("wird Aufwand");
  // Ohne Beleg wird die Gebühr ohne Steuer gebucht; für Vorsteuer oder § 13b gibt es die Auswahl darunter
  await expect(panel().getByLabel("Steuer der Gebühr")).toHaveValue("");
  expect(await axeVerstoesse(page)).toEqual([]);

  await panel().getByRole("button", { name: "Zuordnen und Gebühr buchen" }).click();
  // Beide Umsätze sind erledigt: am Reiter bleibt die Zeile der Spende mit ihrer Gebühr offen
  await expect(page.getByRole("group", { name: "Filter" }).getByRole("link", { name: "Offen · 1" })).toBeVisible();

  await gehe(page, "/bank?filter=zugeordnet");
  // Beide Hälften sind zugeordnet und deshalb einzeln zu sehen, jede mit ihrer Zuordnung
  const zahlung = zeilen().filter({ hasText: "Rheinpixel GmbH" });
  const gebuehr = zeilen().filter({ hasText: "Gebühr · txn_e2e_a" });
  await expect(zahlung).toContainText("Zugeordnet");
  await expect(gebuehr).toContainText("Zugeordnet");
  await expect(gebuehr).toContainText("−30,00 €");

  await gebuehr.click();
  await page.waitForLoadState("networkidle");
  await panel().getByRole("button", { name: "Aufheben", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Zuordnung aufheben" }).click();
  await expect(page.getByRole("group", { name: "Filter" }).getByRole("link", { name: "Offen · 2" })).toBeVisible();

  // Die Gebühr ist wieder offen; die Zahlung bleibt zugeordnet
  await gehe(page, "/bank?filter=offen");
  await expect(zeilen().filter({ hasText: "Gebühr · txn_e2e_a" })).toContainText("Beleg fehlt");
  await expect(zeilen().filter({ hasText: "Rheinpixel GmbH" })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
