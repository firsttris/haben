import { expect, test, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import { currentDay } from "./daten.ts";
import { databaseUrlFuer } from "./durchlaeufe.ts";
import { bestaetigen } from "./einrichtung.ts";

/** Im serialisierten Durchlauf belege-steuern registriert; die globale Firmenvorgabe bleibt dadurch isoliert. */
export function vorsteuerPruefen(getPage: () => Page) {
  test("Vorsteueranteile je Beleg und Satz speichern, vorrechnen und beim Buchen festhalten (#433)", async ({ browser }) => {
    const page = getPage();
    const sql = postgres(databaseUrlFuer("belege-steuern"), { max: 1 });
    const [company] = await sql`select ohne_vorsteuerabzug from company`;
    try {
      const route = await belegAnlegen(page, browser);
      const share = page.getByLabel("Abziehbare Vorsteuer in %", { exact: true });
      const preview = page.getByRole("status", { name: "Vorsteuervorschau" });
      await expect(share).toHaveValue("");
      await expect(preview).toContainText("Abziehbare Vorsteuer 19,00");
      await share.fill("50");
      await expect(preview).toContainText("Abziehbare Vorsteuer 9,50");
      await expect(preview).toContainText("Aufwand 109,50");
      await expect(page.getByLabel("Vorsteuer", { exact: true })).toHaveValue("19,00");
      await page.getByRole("button", { name: "+ Steuersatz", exact: true }).click();
      await page.getByLabel("Netto", { exact: true }).nth(1).fill("100,00");
      await page.getByText("Abweichend je Steuersatz", { exact: true }).click();
      const rateShare = page.getByLabel("Vorsteueranteil bei 7 % in %", { exact: true });
      await rateShare.fill("12,34");
      await expect(preview).toContainText("Abziehbare Vorsteuer 10,36");
      await expect(preview).toContainText("Aufwand 215,64");
      await share.fill("100,001");
      await expect(share).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByRole("button", { name: "Bestätigen und buchen" })).toBeDisabled();
      await share.fill("50");
      await page.getByRole("button", { name: "Speichern", exact: true }).click();
      const id = route.split("/").at(-1)!;
      await expect.poll(async () => (await sql`select vorsteuer_anteil from documents where id=${id}`)[0]?.vorsteuer_anteil).toBe(5000);
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(share).toHaveValue("50");
      await expect(rateShare).toHaveValue("12,34");
      expect(await sql`select vorsteuer_anteil from documents where id=${id}`).toEqual([{ vorsteuer_anteil: 5000 }]);
      expect(await sql`select tax_rate, tax, vorsteuer_anteil from document_amounts where document_id=${id} order by tax_rate`).toEqual([
        { tax_rate: 700, tax: 700, vorsteuer_anteil: 1234 },
        { tax_rate: 1900, tax: 1900, vorsteuer_anteil: null },
      ]);
      // Eine leere Eingabe übernimmt die geänderte Firmenvorgabe; der eigene Satzanteil bleibt erhalten.
      await firmenvorgabe(sql, true);
      await page.reload();
      await page.waitForLoadState("networkidle");
      await share.fill("");
      await expect(preview).toContainText("Abziehbare Vorsteuer 0,86");
      await expect(preview).toContainText("Aufwand 225,14");
      await share.fill("50");
      await page.getByLabel("Nach dem Buchen zum nächsten offenen Beleg").uncheck();
      await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
      await bestaetigen(page, "Buchen");
      await expect(page.getByText(/Gebucht .*festgeschrieben/)).toBeVisible();
      await expect(share).toBeDisabled();
      await expect(rateShare).toBeDisabled();
      await expect(preview).toContainText("Abziehbare Vorsteuer 10,36");
      await firmenvorgabe(sql, false);
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(preview).toContainText("Abziehbare Vorsteuer 10,36");
      await expect(page.getByLabel("Vorsteuer", { exact: true }).first()).toHaveValue("19,00");
    } finally {
      await firmenvorgabe(sql, company!.ohne_vorsteuerabzug);
      await sql.end();
    }
  });
  einfuhrumsatzsteuerPruefen(getPage);
}

function einfuhrumsatzsteuerPruefen(getPage: () => Page) {
  test("Einfuhrumsatzsteuer: Zollbetrag ist Vorsteuer ohne Aufwand, kein Teilabzug (#433)", async ({ browser }) => {
    const page = getPage();
    await belegAnlegen(page, browser);
    try {
      await page.getByLabel("Kategorie").selectOption("einfuhrumsatzsteuer");
      await page.getByLabel("Satz", { exact: true }).selectOption("0");
      await page.getByLabel("Netto", { exact: true }).fill("380,00");
      const share = page.getByLabel("Abziehbare Vorsteuer in %", { exact: true });
      const preview = page.getByRole("status", { name: "Vorsteuervorschau" });
      await share.fill("100");
      await expect(preview).toContainText("Abziehbare Vorsteuer 380,00");
      await expect(preview).toContainText("Aufwand 0,00");
      await share.fill("50");
      await expect(preview).toContainText("vollständigem Vorsteuerabzug");
      await expect(preview.locator(".amount")).toHaveCount(0);
      await share.fill("100");
      await page.getByLabel("Netto", { exact: true }).fill("-380,00");
      await expect(preview).toContainText("Abziehbare Vorsteuer -380,00");
      await expect(preview).toContainText("Aufwand 0,00");
    } finally {
      await page.locator(".doc-actions").getByRole("button", { name: "Löschen", exact: true }).click();
      await bestaetigen(page, "Beleg löschen");
      await page.waitForURL(/\/belege$/);
    }
  });
}

async function firmenvorgabe(sql: ReturnType<typeof postgres>, value: boolean) {
  await sql.begin(async (tx) => {
    await tx`select set_config('haben.actor', 'e2e-vorsteuer', true)`;
    await tx`update company set ohne_vorsteuerabzug=${value}`;
  });
}

async function belegAnlegen(page: Page, browser: Browser): Promise<string> {
  const image = await browser.newPage({ viewport: { width: 620, height: 400 } });
  await image.setContent(`<body style="font:16px sans-serif;padding:32px"><h2>Musterbedarf GmbH</h2><p>Rechnung TEST-433-${Date.now()} · ${currentDay()}</p>
    <p>Software 100,00 € netto · Umsatzsteuer 19 %: 19,00 €</p><p>Fachbuch 100,00 € netto · Umsatzsteuer 7 %: 7,00 €</p><strong>Gesamt 226,00 €</strong></body>`);
  const bytes = await image.screenshot({ type: "jpeg" });
  await image.close();
  await page.goto("/belege");
  await page.waitForLoadState("networkidle");
  await page.locator("input[type=file][multiple]").setInputFiles([{ name: "vorsteuer-test-433.jpg", mimeType: "image/jpeg", buffer: bytes }]);
  await expect(page.getByText("vorsteuer-test-433.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /vorsteuer-test-433\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Lieferant", { exact: true }).fill("Musterbedarf GmbH");
  await page.getByLabel("Rechnungsnummer").fill("TEST-433");
  await page.getByLabel("Belegdatum").fill(currentDay());
  await page.getByLabel("Kategorie").selectOption("software");
  await page.getByLabel("Netto", { exact: true }).fill("100,00");
  return new URL(page.url()).pathname;
}
