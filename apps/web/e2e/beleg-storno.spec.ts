import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import postgres from "postgres";
import { currentDay } from "./daten.ts";
import { databaseUrlFuer, portFuer } from "./durchlaeufe.ts";
import { einrichten } from "./einrichtung.ts";

/** Beleg und zugeordnete Bankzahlung in eigener Datenbank; der Storno läuft durch die echte Oberfläche (#653). */
test.describe.configure({ mode: "serial" });
let page: Page;
let sql: ReturnType<typeof postgres>;
let closeDatabase: () => Promise<void>;
let documentId: string;
let transactionId: string;
let originalDocument: unknown;
let originalTransaction: unknown;
let unpaidDocumentId: string;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await einrichten(page);
  const url = databaseUrlFuer("beleg-storno");
  if (!new URL(url).pathname.endsWith("_e2e")) throw new Error("Eigene E2E-Datenbank fehlt.");
  Object.assign(process.env, {
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
    BETTER_AUTH_URL: `http://localhost:${portFuer("beleg-storno")}`,
    HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    DOCUMENTS_DIR: `${process.env.E2E_DOCUMENTS_DIR ?? "test-results/e2e-belege"}-beleg-storno`,
  });
  sql = postgres(url, { max: 1, onnotice: () => {} });
  const bank = await import("../src/server/modules/bank/index.ts");
  documentId = await receipt(browser, "Codewerk Lizenzen GmbH", "L-4711");
  unpaidDocumentId = await receipt(browser, "Nordlicht Software GmbH", "B-4712");
  transactionId = await transaction("-119,00", "L-4711");
  await bank.allocate("e2e-storno", { kind: "document", transactionId, documentId, amount: -11_900 });
  [originalDocument] = await sql`select * from documents where id = ${documentId}`;
  [originalTransaction] = await sql`select * from bank_transactions where id = ${transactionId}`;
  closeDatabase = (await import("../src/server/db/index.ts")).closeDatabase;
});

async function receipt(browser: Browser, supplier: string, number: string) {
  const documents = await import("../src/server/modules/belege/index.ts");
  const image = await browser.newPage({ viewport: { width: 620, height: 400 } });
  await image.setContent(`<body style="font: 16px sans-serif; padding: 32px"><h2>${supplier}</h2>
    <p>Rechnung ${number} · ${currentDay()}</p><p>Softwarelizenz 100,00 €</p><p>Umsatzsteuer 19 %: 19,00 €</p>
    <p><strong>Gesamt 119,00 €</strong></p></body>`);
  const bytes = await image.screenshot({ type: "jpeg", quality: 80 });
  await image.close();
  const { id } = await documents.uploadDocument("e2e-storno", { bytes, filename: `${number}.jpg` });
  await documents.updateDocument("e2e-storno", id, {
    supplierName: supplier,
    supplierUstId: "",
    invoiceNumber: number,
    documentDate: currentDay(),
    dueDate: null,
    category: "software",
    payment: "bank",
    note: "",
    amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
  });
  await documents.bookDocument("e2e-storno", id);
  return id;
}

async function transaction(amount: string, purpose: string): Promise<string> {
  const bank = await import("../src/server/modules/bank/index.ts");
  const date = currentDay();
  const day = `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;
  const csv =
    `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    `"${day}";"${day}";"Gebucht";"Mustermann IT";"Codewerk Lizenzen GmbH";"${purpose}";"Ausgang";"DE02100100100006820101";"${amount}";"";"";""\n`;
  await bank.importStatement("e2e-storno", { bytes: new TextEncoder().encode(csv), filename: `${purpose}.csv` }, null);
  return (await sql`select id from bank_transactions where purpose = ${purpose}`)[0]!.id;
}

test.afterAll(async () => {
  await sql?.end();
  await closeDatabase?.();
  await page?.context().close();
  expect(errors).toEqual([]);
});

test("Bankzuordnung im Stornodialog bestätigen und zusammen mit dem Beleg zurücknehmen", async () => {
  await page.goto(`/belege/${documentId}`);
  await expect(page.locator(".page-head").getByText("Gebucht", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Beleg stornieren", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Beleg stornieren?" });
  await expect(dialog).toBeVisible();
  const explanation = await dialog.textContent();
  await expect(dialog).toContainText("zum ursprünglichen Buchungsdatum");
  await expect(dialog).toContainText("neu berechneten Werte früherer Zeiträume");
  await expect(dialog).toContainText("berichtigte Anmeldung");
  // Vorher/Nachher mit denselben echten Testdaten und demselben Ablauf, nur auf ausdrücklichen Screenshot-Aufruf.
  const phase = process.env.STORNO_SCREENSHOTS;
  if (phase) {
    await mkdir("test-results/storno-bilder", { recursive: true });
    for (const theme of ["wald", "nacht"])
      for (const [device, viewport] of [
        ["desktop", { width: 1440, height: 900 }],
        ["handy", { width: 390, height: 844 }],
      ] as const) {
        await page.setViewportSize(viewport);
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t;
        }, theme);
        await dialog.screenshot({ path: `test-results/storno-bilder/storno-${theme}-${device}-${phase}.png` });
      }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "wald";
    });
  }
  await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  expect((await sql`select id from document_cancellations where document_id = ${documentId}`).length).toBe(0);
  expect(Number((await sql`select sum(amount) as amount from allocations where document_id = ${documentId}`)[0]!.amount)).toBe(-11_900);

  await page.getByRole("button", { name: "Beleg stornieren", exact: true }).click();
  await dialog.getByRole("button", { name: /Stornieren/ }).click();
  await expect(page.locator(".page-head").getByText("Storniert", { exact: true })).toBeVisible();
  expect(explanation).toContain("Bankzuordnung");
  expect(Number((await sql`select sum(amount) as amount from allocations where document_id = ${documentId}`)[0]!.amount)).toBe(0);
  expect((await sql`select id from document_cancellations where document_id = ${documentId}`).length).toBe(1);
  expect((await sql`select * from documents where id = ${documentId}`)[0]).toEqual(originalDocument);
  expect((await sql`select * from bank_transactions where id = ${transactionId}`)[0]).toEqual(originalTransaction);
  await page.reload();
  await expect(page.locator(".page-head").getByText("Storniert", { exact: true })).toBeVisible();
  expect((await sql`select id from document_cancellations where document_id = ${documentId}`).length).toBe(1);
  await page.getByRole("link", { name: "Gegenbuchung", exact: true }).click();
  await expect(page.getByText(/Storno: Beleg L-4711/)).toBeVisible();
});

test("ganze Aufteilung einschließlich weiterem Beleg vor dem Storno ausdrücklich anzeigen", async ({ browser }) => {
  const chosen = await receipt(browser, "Codewerk Lizenzen GmbH", "S-4801");
  const other = await receipt(browser, "Nordlicht Software GmbH", "S-4802");
  const tx = await transaction("-239,00", "Aufteilung S-4801 S-4802");
  const bank = await import("../src/server/modules/bank/index.ts");
  await bank.allocateSplit("e2e-storno", {
    transactionId: tx,
    parts: [
      { kind: "document", documentId: chosen, amount: -11_900 },
      { kind: "document", documentId: other, amount: -11_900 },
      { kind: "gebuehren", amount: -100 },
    ],
  });
  await page.goto(`/belege/${chosen}`);
  await page.getByRole("button", { name: "Beleg stornieren", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("S-4801");
  await expect(dialog).toContainText("S-4802");
  await expect(dialog).toContainText("auch die zu weiteren Vorgängen");
  await expect(dialog.getByText("Bankzuordnung", { exact: true })).toHaveCount(3);
  await dialog.getByRole("button", { name: "Stornieren", exact: true }).click();
  await expect(page.locator(".page-head").getByText("Storniert", { exact: true })).toBeVisible();
  expect((await bank.transactionDetail(tx))!.transaction.open).toBe(-23_900);
  expect((await sql`select id from document_cancellations where document_id = ${other}`).length).toBe(0);
  await page.goto(`/belege/${other}`);
  await expect(page.locator(".page-head").getByText("Gebucht", { exact: true })).toBeVisible();
});

test("Fehlermeldung bei abgeschlossenem Jahr bleibt vor der Aktionsleiste vollständig lesbar", async () => {
  const [original] = await sql`select * from documents where id = ${unpaidDocumentId}`;
  const [counts] = await sql`select (select count(*) from journal_entries) as journal, (select count(*) from document_cancellations) as cancellations`;
  await sql`insert into year_closings (year) values (${Number(currentDay().slice(0, 4))})`;
  const hidden: string[] = [];
  for (const theme of ["wald", "nacht"])
    for (const [device, viewport] of [
      ["desktop", { width: 1440, height: 900 }],
      ["handy", { width: 390, height: 844 }],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto(`/belege/${unpaidDocumentId}`);
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);
      await page.getByRole("button", { name: "Beleg stornieren", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Stornieren", exact: true }).click();
      const error = page.getByRole("alert");
      await expect(error).toContainText(/ist abgeschlossen/);
      // Sichtbarkeit im DOM reicht nicht: Die stehende Aktionsleiste darf die Meldung nicht überdecken.
      const readable = await error.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return [0.1, 0.5, 0.9].every((fraction) => element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height * fraction)));
      });
      if (!readable) hidden.push(`${theme}/${device}`);
      if (process.env.STORNO_SCREENSHOTS) {
        await mkdir("test-results/storno-bilder", { recursive: true });
        await page.screenshot({ path: `test-results/storno-bilder/storno-fehler-${theme}-${device}-${process.env.STORNO_SCREENSHOTS}.png` });
      }
    }
  expect((await sql`select * from documents where id = ${unpaidDocumentId}`)[0]).toEqual(original);
  expect((await sql`select (select count(*) from journal_entries) as journal, (select count(*) from document_cancellations) as cancellations`)[0]).toEqual(
    counts,
  );
  expect(hidden).toEqual([]);
});
