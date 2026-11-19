import { waehleKategorie } from "./kategorie.ts";
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
      const id = route.split("/").at(-1)!;
      await share.fill("100,001");
      await expect(share).toHaveAttribute("aria-invalid", "true");
      // Die Aktionen bleiben erreichbar; ein ungültiger Anteil darf weder speichern noch die Buchungsrückfrage öffnen.
      const before = await sql`select to_jsonb(d) as record from documents d where id=${id}`;
      const amountsBefore = await sql`select to_jsonb(a) as record from document_amounts a where document_id=${id} order by tax_rate`;
      for (const name of ["Speichern", "Bestätigen und buchen"]) {
        const action = page.getByRole("button", { name, exact: true });
        await expect(action).toBeEnabled();
        await action.click();
        await expect(share).toBeFocused();
        await expect(share).toHaveAttribute("aria-invalid", "true");
        await expect(share).toHaveAccessibleDescription(/0 bis 100 %/);
        await expect(page.getByRole("dialog", { name: "Beleg buchen?" })).toHaveCount(0);
        expect(new URL(page.url()).pathname).toBe(route);
        expect(await sql`select to_jsonb(d) as record from documents d where id=${id}`).toEqual(before);
        expect(await sql`select to_jsonb(a) as record from document_amounts a where document_id=${id} order by tax_rate`).toEqual(amountsBefore);
      }
      await share.fill("50");
      await page.getByRole("button", { name: "Speichern", exact: true }).click();
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
  steuerspaltePruefen(getPage);
  einfuhrumsatzsteuerPruefen(getPage);
  privatanteilVorschauPruefen(getPage);
}

function privatanteilVorschauPruefen(getPage: () => Page) {
  test("Privatanteil: ein ungültiger Anteil zeigt keine scheinbar gültige Vorsteuervorschau (#1221)", async ({ browser }) => {
    const page = getPage();
    const route = await belegAnlegen(page, browser);
    try {
      const preview = page.getByRole("status", { name: "Vorsteuervorschau" });
      const privat = page.getByLabel("Privatanteil in %", { exact: true });
      await expect(preview).toContainText("Abziehbare Vorsteuer 19,00");
      await privat.fill("20");
      await expect(preview).toContainText("Abziehbare Vorsteuer 15,20");
      await expect(preview).toContainText("(nach Privatanteil)");
      // Mehr als 100 % ist kein Privatanteil: Die Vorschau rechnet nicht still mit 0 %, sondern wartet auf eine gültige Eingabe
      await privat.fill("150");
      await expect(preview).toHaveText("Vorschau nach gültiger Eingabe der Beträge und Anteile.");
    } finally {
      await page.locator(".doc-actions").getByRole("button", { name: "Löschen", exact: true }).click();
      await bestaetigen(page, "Beleg löschen");
      await page.waitForURL((url) => url.pathname !== route && /^\/belege(?:\/[0-9a-f-]{36})?$/.test(url.pathname));
    }
  });
}

function einfuhrumsatzsteuerPruefen(getPage: () => Page) {
  test("Einfuhrumsatzsteuer: Zollbetrag ist Vorsteuer ohne Aufwand, kein Teilabzug (#433)", async ({ browser }) => {
    const page = getPage();
    const route = await belegAnlegen(page, browser);
    try {
      await waehleKategorie(page.getByLabel("Kategorie"), "einfuhrumsatzsteuer");
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
      // Weitere offene Belege führen zum nächsten Beleg, sonst zur Liste; die eigene Fixture muss in beiden Fällen weg sein.
      await page.waitForURL((url) => url.pathname !== route && /^\/belege(?:\/[0-9a-f-]{36})?$/.test(url.pathname));
      const sql = postgres(databaseUrlFuer("belege-steuern"), { max: 1 });
      try {
        const id = route.split("/").at(-1)!;
        await expect.poll(async () => (await sql`select id from documents where id=${id}`).length).toBe(0);
      } finally {
        await sql.end();
      }
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
  await waehleKategorie(page.getByLabel("Kategorie"), "software");
  await page.getByLabel("Netto", { exact: true }).fill("100,00");
  return new URL(page.url()).pathname;
}

function steuerspaltePruefen(getPage: () => Page) {
  test("Ohne Vorsteuerabzug heißt die Steuerspalte „Umsatzsteuer“, auch in der Aufteilung (#978)", async ({ browser }) => {
    const page = getPage();
    const route = await belegAnlegen(page, browser);
    try {
      const share = page.getByLabel("Abziehbare Vorsteuer in %", { exact: true });
      const split = page.locator("#aufteilung");
      await expect(page.getByLabel("Vorsteuer", { exact: true })).toHaveValue("19,00");
      // 0 % abziehbar: Die Steuer auf dem Beleg wird Aufwand, die Spalte darf keinen Vorsteuerabzug nahelegen
      await share.fill("0");
      await expect(page.getByLabel("Umsatzsteuer", { exact: true })).toHaveValue("19,00");
      await expect(page.getByLabel("Vorsteuer", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Auf mehrere Kategorien aufteilen" }).click();
      await expect(split).toContainText("Die Umsatzsteuer verteilt Haben anteilig");
      // Ein Teilabzug bleibt Vorsteuer
      await share.fill("50");
      await expect(page.getByLabel("Vorsteuer", { exact: true })).toHaveValue("19,00");
      await expect(split).toContainText("Die Vorsteuer verteilt Haben anteilig");
    } finally {
      await page.locator(".doc-actions").getByRole("button", { name: "Löschen", exact: true }).click();
      await bestaetigen(page, "Beleg löschen");
      await page.waitForURL((url) => url.pathname !== route && /^\/belege(?:\/[0-9a-f-]{36})?$/.test(url.pathname));
    }
  });
}
