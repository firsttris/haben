import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { databaseUrlFuer, portFuer } from "./durchlaeufe.ts";
import { einrichten } from "./einrichtung.ts";

test.describe.configure({ mode: "serial" });
let page: Page;
let closeDatabase: () => Promise<void>;
let ids: { invoice: string; quote: string };
const importedInvoices: { id: string; label: string }[] = [];
const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj <</Type/Catalog>> endobj\n%%EOF");
const pdfSha256 = createHash("sha256").update(pdf).digest("hex");

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await einrichten(page);
  const url = databaseUrlFuer("belegimport");
  if (!new URL(url).pathname.endsWith("_e2e")) throw new Error("Eigene E2E-Datenbank fehlt.");
  Object.assign(process.env, {
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
    BETTER_AUTH_URL: `http://localhost:${portFuer("belegimport")}`,
    HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    DOCUMENTS_DIR: `${process.env.E2E_DOCUMENTS_DIR ?? "test-results/e2e-belege"}-belegimport`,
  });
  const { loadCompany, saveCompany } = await import("../src/server/modules/stammdaten/index.ts");
  await saveCompany("e2e-import", { ...(await loadCompany()), kleinunternehmer: true }, "2026-01-01");
  const common = { date: "2026-01-03", contactId: null, contactName: "Frida Import", currency: "EUR" as const, net: 100000, tax: 0, gross: 100000, pdfSha256 };
  const { runExternalImport } = await import("../src/server/modules/datenimport/index.ts");
  const invoice = {
    ...common,
    kind: "invoice" as const,
    externalId: "r-1",
    number: "ALT-R-1",
    type: "invoice" as const,
    direction: "einnahme" as const,
    dueDate: "2026-01-17",
    status: "paid" as const,
    taxes: [{ rate: 0, net: 100000, tax: 0 }],
    taxType: "vatfree",
    payment: { openAmount: 0, paidDate: null, items: [] },
  };
  const result = await runExternalImport(
    "e2e-import",
    {
      version: 2,
      source: "Beispiel-App",
      kontenrahmen: "SKR03",
      entries: [
        {
          ...common,
          kind: "quote",
          externalId: "a-1",
          number: "ALT-A-1",
          status: "open",
          positions: [{ name: "Beratung", text: "Beschreibung aus der Quelle" }],
        },
        invoice,
        { ...invoice, externalId: "r-2", number: "ALT-R-2", status: "open", payment: { openAmount: 100000, paidDate: null, items: [] } },
      ],
    },
    async () => pdf,
  );
  ids = { invoice: result.items.find((r) => r.externalId === "r-1")!.id, quote: result.items.find((r) => r.externalId === "a-1")!.id };
  await runExternalImport(
    "e2e-import",
    {
      version: 2,
      source: "Beispiel-Kassenjournal",
      kontenrahmen: "SKR03",
      entries: [
        {
          kind: "journal",
          externalId: "k-1",
          date: "2026-01-05",
          description: "Übernommene Kassenbewegung",
          lines: [
            { account: "1000", debit: 40000, credit: 0 },
            { account: "1400", debit: 0, credit: 40000 },
          ],
        },
      ],
    },
    async () => pdf,
  );
  closeDatabase = (await import("../src/server/db/index.ts")).closeDatabase;
  const { db, schema } = await import("../src/server/db/index.ts");
  const { withActor } = await import("../src/server/db/actor.ts");
  const { storeLegacyVoucher, takeOverLegacyItem } = await import("../src/server/modules/archiv/index.ts");
  const [oldImport] = await db.select({ id: schema.lexofficeImports.id }).from(schema.lexofficeImports).limit(1);
  for (const [source, label] of [
    ["lexoffice", "Lexoffice"],
    ["sevdesk", "sevDesk"],
    ["import", "Beispiel-Programm"],
  ] as const) {
    const voucher = await withActor("e2e-import", async (tx) => {
      const result = await storeLegacyVoucher(
        tx,
        {
          source,
          importId: oldImport!.id,
          lexofficeId: `herkunft-${source}`,
          type: "invoice",
          direction: "einnahme",
          number: `HERKUNFT-${source}`,
          date: "2026-01-03",
          dueDate: "2026-01-17",
          status: "open",
          contactName: "Frida Import",
          net: 10000,
          tax: 0,
          gross: 10000,
          taxes: [{ rate: 0, net: 10000, tax: 0 }],
          categories: [],
          payment: { openAmount: 10000, paidDate: null, items: [] },
          raw: { sourceName: "Beispiel-Programm", taxType: "vatfree" },
        },
        [{ role: "pdf", sourceFileId: null, filename: `herkunft-${source}.pdf`, mimeType: "application/pdf", bytes: pdf }],
      );
      if (source === "import")
        await tx.insert(schema.externalImports).values({
          source: "Beispiel-Programm",
          externalId: "herkunft-import",
          kind: "invoice",
          payloadHash: "0".repeat(64),
          voucherId: result!.id,
          payload: {},
        });
      return result!;
    });
    const native = await takeOverLegacyItem("e2e-import", voucher.id, "2026-01-31");
    importedInvoices.push({ id: native.id, label });
  }
});
test.afterAll(async () => {
  await closeDatabase?.();
  await page?.context().close();
});

test("Übernommene Rechnungen zeigen das tatsächliche Quellprogramm", async () => {
  for (const invoice of importedInvoices) {
    await page.goto(`/rechnungen/${invoice.id}`);
    await page.waitForLoadState("networkidle");
    if (invoice.label === "sevDesk" && process.env.IMPORT_SCREENSHOTS) {
      const dir = "/tmp/haben-pr-import-source";
      await mkdir(dir, { recursive: true });
      for (const theme of ["wald", "nacht"])
        for (const [device, width, height] of [
          ["desktop", 1440, 900],
          ["handy", 390, 844],
        ] as const) {
          await page.setViewportSize({ width, height });
          await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
          await page.screenshot({ path: `${dir}/herkunft-${theme}-${device}-${process.env.IMPORT_SCREENSHOTS}.png`, animations: "disabled", caret: "hide" });
        }
    }
    await expect(
      page
        .locator("dt")
        .filter({ hasText: /^Format$/ })
        .locator("+ dd"),
    ).toHaveText(`Original aus ${invoice.label}`);
  }
});

test("Originale nutzen das gemeinsame Archiv mit tatsächlicher Quelle und unverändertem PDF", async () => {
  await page.goto("/archiv?ansicht=auftraege&jahr=2026");
  await expect(page.getByRole("link", { name: "ALT-A-1", exact: true })).toBeVisible();
  await page.goto(`/archiv/auftrag/${ids.quote}`);
  await expect(page.getByText(/Angebot aus Beispiel-App/)).toBeVisible();
  await expect(page.getByText("Beschreibung aus der Quelle")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Positionen aus Beispiel-App" })).toBeVisible();
  const href = await page.getByRole("link", { name: "PDF herunterladen", exact: true }).getAttribute("href");
  const downloaded = await page.request.get(href!);
  expect(
    createHash("sha256")
      .update(await downloaded.body())
      .digest("hex"),
  ).toBe(pdfSha256);
  await page.goto(`/archiv/beleg/${ids.invoice}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ALT-R-1");
  await expect(page.getByRole("status").filter({ hasText: "ungeklärt" })).toBeVisible();
  await expect(page.getByText(/Rechnung aus Beispiel-App/)).toBeVisible();
});

test("Ein geprüfter offener Posten wird über den bestehenden Umzug übernommen", async () => {
  await page.goto("/archiv?stichtag=2026-01-31");
  const section = page.getByRole("region", { name: "Offene Posten übernehmen" });
  const row = section.getByRole("row").filter({ hasText: "ALT-R-2" });
  await expect(row.getByRole("button", { name: "Übernehmen", exact: true })).toBeEnabled();
  await row.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(row.getByRole("link", { name: "übernommen", exact: true })).toBeVisible();
  await row.getByRole("link", { name: "übernommen", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ALT-R-2");
  await page.goto("/auswertungen?jahr=2026");
  await expect(page.getByText("ALT-R-2", { exact: true })).toBeVisible();
  const csv = await page.request.get("/api/auswertungen/2026");
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).not.toContain("400,00");
});

test("Journal und Kasse bleiben sichtbar, ohne zweite Buchung oder frei erfundene EÜR", async () => {
  await page.goto("/kasse?jahr=2026");
  await expect(page.getByText("Übernommene Kassenbewegung").first()).toBeVisible();
  await expect(page.getByText("400,00 €", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Nr\. \d+ stornieren/ })).toHaveCount(0);
  await page.goto("/buchungen?jahr=2026&monat=1");
  await expect(page.getByText("Übernommene Kassenbewegung")).toBeVisible();
  const source = page.getByText("Import", { exact: true });
  await expect(source).toBeVisible();
  await expect(source).not.toHaveAttribute("href", "/bank");
});

test("Gemeinsame Ansichten sind auf Desktop und Handy in beiden Themes bedienbar", async () => {
  for (const [name, path] of [
    ["angebot", `/archiv/auftrag/${ids.quote}`],
    ["beleg", `/archiv/beleg/${ids.invoice}`],
    ["kasse", "/kasse?jahr=2026"],
  ] as const) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    for (const theme of ["wald", "nacht"])
      for (const [device, viewport] of [
        ["desktop", { width: 1440, height: 900 }],
        ["handy", { width: 390, height: 844 }],
      ] as const) {
        await page.setViewportSize(viewport);
        await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
        if (process.env.IMPORT_SCREENSHOTS) {
          const dir = "/tmp/haben-pr-common-import";
          await mkdir(dir, { recursive: true });
          await page.screenshot({ path: `${dir}/${name}-${theme}-${device}-${process.env.IMPORT_SCREENSHOTS}.png`, animations: "disabled", caret: "hide" });
        }
      }
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  }
});
