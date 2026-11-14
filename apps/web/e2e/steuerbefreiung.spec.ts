import { formatEuro, parseEuro } from "@haben/core";
import { expect, type Locator, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { day, YEAR } from "./daten.ts";
import { databaseUrlFuer } from "./durchlaeufe.ts";
import { durchlaufSeite, einrichten, gehe, kundeWaehlen } from "./einrichtung.ts";
import { HANDY, sichtbar } from "./kopfzeile.ts";

/**
 * Eigener Durchlauf zu #433: frische KU-Firma ohne bestehende Buchungen einrichten, getrennt von der
 * übrigen Firmeneinrichtung. Eigene Entwürfe werden nicht festgeschrieben. SQL stellt nur historische Testdaten nach;
 * Audit-Akteur, GoBD-Sperren und Siegel bleiben aktiv. Der lokale Einserverlauf kann die Datenbank-URL gezielt vorgeben.
 */
test.describe.configure({ mode: "serial" });
const databaseUrl = process.env.STEUERBEFREIUNG_DATABASE_URL ?? databaseUrlFuer("steuerbefreiung");
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const editors = [
  { kind: "Rechnung", route: "/rechnungen/neu", table: "invoices" },
  { kind: "Angebot", route: "/angebote/neu", table: "quotes" },
  { kind: "Serie", route: "/rechnungen/wiederkehrend/neu", table: "recurring_invoices" },
] as const;
type Editor = (typeof editors)[number];
const token = crypto.randomUUID().slice(0, 8);
const customer = `Steuerbefreiung ${token}`;
let page: Page;
let pageErrors: string[] = [];

async function actor(work: (tx: postgres.TransactionSql) => Promise<void>) {
  await sql.begin(async (tx) => {
    await tx`select set_config('haben.actor', 'e2e-steuerbefreiung', true)`;
    await work(tx);
  });
}

test.beforeAll(async ({ browser }) => {
  expect(new URL(databaseUrl).pathname).toMatch(/e2e$/);
  ({ page, pageErrors } = await durchlaufSeite(browser));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await einrichten(page, true);
  await gehe(page, "/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill(customer);
  await page.getByLabel("Straße und Hausnummer").fill("Beispielweg 7");
  await page.getByLabel("PLZ", { exact: true }).fill("1010");
  await page.getByLabel("Ort", { exact: true }).fill("Wien");
  await page.getByLabel("Land (ISO-Code)").fill("AT");
  await page.getByRole("button", { name: "Kontakt anlegen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
});

test.afterAll(async () => {
  try {
    expect(pageErrors).toEqual([]);
  } finally {
    await sql.end();
    await page?.context().close();
  }
});

const saveButton = (editor: Editor, existing = false) =>
  page.getByRole("button", {
    name: editor.kind === "Serie" ? (existing ? "Speichern" : "Vorlage anlegen") : "Entwurf speichern",
    exact: true,
  });

async function newDraft(editor: Editor) {
  await gehe(page, editor.route);
  await kundeWaehlen(page, `${customer} · Wien`);
  if (editor.kind === "Serie") {
    await page.getByLabel("Bezeichnung", { exact: true }).fill(`Steuerprobe ${token}`);
    await page.getByLabel("Nächste Rechnung am").fill(day(10));
  }
  await page.getByLabel("Beschreibung Position 1", { exact: true }).fill(`Testleistung ${token}`);
  await page.getByLabel("Menge Position 1", { exact: true }).fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("123,45");
  await expect(page.getByLabel("Umsatzsteuer", { exact: true })).toHaveValue("kleinunternehmer");
  await expect(page.getByLabel("Umsatzsteuer", { exact: true })).toBeEnabled();
}

async function saveAndReopen(editor: Editor) {
  await expect(saveButton(editor)).toBeEnabled();
  await saveButton(editor).click();
  await page.waitForURL(/\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.reload({ waitUntil: "networkidle" });
  return id;
}

async function preview(editor: Editor, note: string) {
  const sheet = page.getByLabel(editor.kind === "Serie" ? "Vorschau" : editor.kind === "Angebot" ? "Vorschau des Angebots" : "Vorschau der Rechnung", {
    exact: true,
  });
  if (editor.kind !== "Serie" && !(await sheet.isVisible())) await page.getByRole("button", { name: "Vorschau", exact: true }).click();
  await expect(sheet).toContainText(note, { timeout: 30_000 });
  if (editor.kind !== "Serie") await expect(sheet.getByRole("img").first()).toBeVisible();
}

for (const editor of editors) {
  for (const [provision, note] of [
    ["14a", "§ 4 Nr. 14 Buchst. a UStG"],
    ["21", "§ 4 Nr. 21 UStG"],
  ] as const) {
    test(`${editor.kind}: KU-Befreiung ${provision} speichern, erneut öffnen und Vorschau`, async () => {
      await newDraft(editor);
      await page.getByLabel("Umsatzsteuer", { exact: true }).selectOption("steuerfrei");
      await expect(saveButton(editor)).toBeDisabled();
      await page.getByLabel("Befreiungsvorschrift", { exact: true }).selectOption(provision);
      await expect(page.getByLabel("Hinweis zur Steuerbefreiung", { exact: true })).toHaveValue(`Steuerfreie Leistung nach ${note}.`);
      await saveAndReopen(editor);
      await expect(page.getByLabel("Umsatzsteuer", { exact: true })).toHaveValue("steuerfrei");
      await expect(page.getByLabel("Befreiungsvorschrift", { exact: true })).toHaveValue(provision);
      await expect(page.getByLabel("Hinweis zur Steuerbefreiung", { exact: true })).toHaveAttribute("readonly", "");
      await preview(editor, note);
    });
  }
}

test("Alte Befreiungstexte bleiben in Rechnung, Angebot und Serie ausdrücklich ungeklärt", async () => {
  for (const editor of editors) {
    await test.step(editor.kind, async () => {
      await newDraft(editor);
      const id = await saveAndReopen(editor);
      await actor(async (tx) => {
        await tx`update ${tx(editor.table)} set tax_treatment = 'steuerfrei', tax_details = null,
          exemption_reason = 'Alter Freitext: § 4 Nr. 14a UStG' where id = ${id}`;
      });
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByLabel("Befreiungsvorschrift", { exact: true })).toHaveValue("");
      await expect(page.getByLabel("Hinweis zur Steuerbefreiung", { exact: true })).toHaveValue("Alter Freitext: § 4 Nr. 14a UStG");
      await expect(page.getByText("Gesamtumsatz: Vorschrift ungeklärt. Ein bisheriger Befreiungstext wird nicht automatisch zugeordnet.")).toBeVisible();
      await expect(saveButton(editor, true)).toBeDisabled();
      const [stored] = await sql`select tax_details from ${sql(editor.table)} where id = ${id}`;
      expect(stored!.tax_details).toBeNull();
    });
  }
});

test("EU-Ausland verlangt Leistungsort und ausdrückliche Bestätigung ohne ausländische Umsatzsteuer", async () => {
  for (const editor of editors) {
    await test.step(editor.kind, async () => {
      await newDraft(editor);
      // Die österreichische Anschrift hat die Steuerbehandlung nicht selbst auf Ausland gesetzt.
      await page.getByLabel("Umsatzsteuer", { exact: true }).selectOption("eu_sonstige");
      await expect(saveButton(editor)).toBeDisabled();
      await page.getByLabel("Land des tatsächlichen Leistungsorts").fill("AT");
      await expect(page.getByLabel("Ausländische Umsatzsteuer", { exact: true })).toHaveValue("");
      await expect(saveButton(editor)).toBeDisabled();
      await page.getByLabel("Ausländische Umsatzsteuer", { exact: true }).selectOption("bestaetigt");
      await saveAndReopen(editor);
      await expect(page.getByLabel("Umsatzsteuer", { exact: true })).toHaveValue("eu_sonstige");
      await expect(page.getByLabel("Land des tatsächlichen Leistungsorts")).toHaveValue("AT");
      await expect(page.getByLabel("Ausländische Umsatzsteuer", { exact: true })).toHaveValue("bestaetigt");
      await preview(editor, "Im Inland nicht steuerbare sonstige Leistung");
      await page.getByLabel("Land des tatsächlichen Leistungsorts").fill("FR");
      await expect(page.getByLabel("Ausländische Umsatzsteuer", { exact: true })).toHaveValue("");
      await expect(saveButton(editor, true)).toBeDisabled();
    });
  }
});

async function keyboardSelect(select: Locator, value: string) {
  const values = await select.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(values).toContain(value);
  await select.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("Home");
  for (let i = 0; i < values.indexOf(value); i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue(value);
}

test("Handy: neue Steuerfelder per Tastatur, Speichern und Vorschau ohne horizontalen Überlauf", async () => {
  await page.setViewportSize(HANDY);
  try {
    for (const editor of editors) {
      await test.step(editor.kind, async () => {
        await newDraft(editor);
        await keyboardSelect(page.getByLabel("Umsatzsteuer", { exact: true }), "steuerfrei");
        await page.keyboard.press("Tab");
        const provision = page.getByLabel("Befreiungsvorschrift", { exact: true });
        await expect(provision).toBeFocused();
        await keyboardSelect(provision, "21");
        await sichtbar(provision);
        await saveAndReopen(editor);
        await expect(page.getByLabel("Befreiungsvorschrift", { exact: true })).toHaveValue("21");
        await preview(editor, "§ 4 Nr. 21 UStG");
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        if (editor.kind !== "Serie") await page.keyboard.press("Escape");
      });
    }
  } finally {
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
});

test("Gesamtumsatz: bekannte Einnahme, eigene Befreiungen und unbekannter historischer Teil bleiben getrennt", async () => {
  await gehe(page, `/auswertungen?jahr=${YEAR}`);
  const card = page.getByRole("region", { name: "Gesamtumsatz nach § 19 UStG" });
  const before = parseEuro((await card.locator(".kpi-value").textContent())!.replace(/\s*€$/, ""))!;
  expect(before).not.toBeNull();
  await actor(async (tx) => {
    const [last] = await tx`select coalesce(max(number), 0) as number from cash_entries`;
    let number = Number(last!.number);
    for (const [amount, treatment, details, label] of [
      [12345, "kleinunternehmer", null, "Gezählte KU-Einnahme"],
      [7000, "steuerfrei", { exemption: { number: "14", letter: "a" } }, "Heilbehandlung"],
      [9000, "steuerfrei", { exemption: { number: "21" } }, "Unterricht"],
      [11000, "eu_sonstige", { foreignPlace: { country: "AT", noForeignVat: true } }, "EU-Leistung"],
    ] as const) {
      const fullDetails = details ? { exemption: null, ancillary: null, foreignPlace: null, assetDisposal: false, ...details } : null;
      await tx`insert into cash_entries (number, date, amount, text, kind, tax_treatment, tax_rate, tax_details)
        values (${++number}, ${day(0)}, ${amount}, ${`${label} ${token}`}, 'einnahme', ${treatment}, 0, ${fullDetails ? JSON.stringify(fullDetails) : null}::jsonb)`;
    }
    const [run] = await tx`insert into lexoffice_imports (status, progress) values ('fertig', '{}') returning id`;
    await tx`insert into lexoffice_vouchers
      (lexoffice_id, import_id, source, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${crypto.randomUUID()}, ${run!.id}, 'import', 'invoice', 'einnahme', ${`Ungeklärter Altbeleg ${token}`}, ${day(0)},
        'paid', 20000, 0, 20000, '[{"rate":0,"net":20000,"tax":0}]', '[]', null, '{"taxType":"vatfree"}')`;
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(card.getByText("Bekannter Teilbetrag", { exact: true })).toBeVisible();
  await expect(card.locator(".kpi-value")).toHaveText(formatEuro(before + 12345));
  await expect(card.locator(".banner-warn")).toContainText("ungeklärt");
  await card.getByText("Berechnungsgrundlage und ungeklärte Zuordnungen", { exact: true }).click();
  const unknown = card.getByRole("row").filter({ hasText: `Ungeklärter Altbeleg ${token}` });
  await expect(unknown.getByRole("cell").nth(1)).toHaveText("Ungeklärt");
  await expect(unknown.getByRole("cell").nth(2)).toHaveText("Ungeklärt");
  await card.getByLabel("Einordnung", { exact: true }).selectOption("all");
  await expect(card.getByRole("row").filter({ hasText: `Gezählte KU-Einnahme ${token}` })).toContainText("Einbezogen");
  for (const label of ["Heilbehandlung", "Unterricht", "EU-Leistung"]) {
    await expect(card.getByRole("row").filter({ hasText: `${label} ${token}` })).toContainText("Ausgenommen");
  }
  await page.setViewportSize(HANDY);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
