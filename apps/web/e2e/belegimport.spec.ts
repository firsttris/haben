import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { databaseUrlFuer } from "./durchlaeufe.ts";
import { einrichten } from "./einrichtung.ts";

test.describe.configure({ mode: "serial" });
let page: Page;
let closeDatabase: () => Promise<void>;
let ids: { invoice: string; quote: string };

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await einrichten(page);
  const url = databaseUrlFuer("belegimport");
  if (!new URL(url).pathname.endsWith("_e2e")) throw new Error("Eigene E2E-Datenbank fehlt.");
  process.env.DATABASE_URL = url;
  process.env.BETTER_AUTH_SECRET = "e2e-geheimnis-mindestens-zweiunddreissig-zeichen";
  process.env.BETTER_AUTH_URL = "http://localhost:3105";
  process.env.HABEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const { loadCompany, saveCompany } = await import("../src/server/modules/stammdaten/index.ts");
  await saveCompany("e2e-import", { ...(await loadCompany()), kleinunternehmer: true }, "2026-01-01");
  const bytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj <</Type/Catalog>> endobj\n%%EOF");
  const pdfSha256 = createHash("sha256").update(bytes).digest("hex");
  const { runExternalImport } = await import("../src/server/modules/datenimport/index.ts");
  const common = {
    date: "2026-01-03",
    contactId: null,
    buyer: { name: "Frida Import", strasse: "Beispielweg 1", plz: "10115", ort: "Berlin", land: "DE" },
    gross: 100000,
    lines: [{ description: "Importierte Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100000 }],
    pdfSha256,
  };
  const result = await runExternalImport(
    "e2e-import",
    {
      version: 1,
      source: "beispiel-app",
      kontenrahmen: "SKR03",
      entries: [
        { ...common, kind: "quote", externalId: "a-1", number: "ALT-A-1", validUntil: "2026-02-03" },
        {
          ...common,
          kind: "invoice",
          externalId: "r-1",
          number: "ALT-R-1",
          dueDate: "2026-01-17",
          quoteExternalId: "a-1",
          settledAmount: 100000,
          paymentUncertain: true,
        },
        {
          kind: "journal",
          externalId: "j-1",
          date: "2026-01-05",
          description: "Originalbuchung aus Beispiel-App",
          lines: [
            { account: "1200", debit: 40000, credit: 0 },
            { account: "1400", debit: 0, credit: 40000 },
          ],
          cashFlows: [{ date: "2026-01-05", amount: 40000, category: "einnahme", evidence: "Beispielauszug, Zeile 1" }],
        },
      ],
    },
    async () => bytes,
  );
  ids = { invoice: result.items.find((r) => r.kind === "invoice")!.id, quote: result.items.find((r) => r.kind === "quote")!.id };
  closeDatabase = (await import("../src/server/db/index.ts")).closeDatabase;
});
test.afterAll(async () => {
  await closeDatabase?.();
  await page?.context().close();
});

test("Originalbelege stehen in normalen Listen; bezahlt ist kein offener Posten", async () => {
  await page.goto("/angebote");
  await expect(page.getByText("ALT-A-1", { exact: true })).toBeVisible();
  await expect(page.getByText("Frida Import")).toBeVisible();
  await page.goto("/rechnungen");
  await expect(page.getByText("ALT-R-1", { exact: true })).toBeVisible();
  await expect(page.getByText("Bezahlt", { exact: true })).toBeVisible();
  await page.goto(`/rechnungen/${ids.invoice}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ALT-R-1");
  await expect(page.getByText(/Übernommener Zahlungsstand/)).toBeVisible();
  await page.goto("/auswertungen?jahr=2026");
  await expect(page.getByRole("heading", { name: "Auswertungen 2026", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Offene Forderungen/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Zahlungsdaten noch ungeklärt" })).toBeVisible();
  const csv = await page.request.get("/api/auswertungen/2026");
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain("400,00");
});

test("Import bleibt im Journal und in der EÜR sichtbar, auch auf dem Handy", async () => {
  for (const [name, path] of [
    ["euer", "/auswertungen?jahr=2026"],
    ["journal", "/buchungen?jahr=2026&monat=1"],
  ] as const) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const theme of ["wald", "nacht"])
      for (const [device, viewport] of [
        ["desktop", { width: 1440, height: 900 }],
        ["handy", { width: 390, height: 844 }],
      ] as const) {
        await page.setViewportSize(viewport);
        await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
        if (process.env.IMPORT_SCREENSHOTS) {
          const dir = "/tmp/haben-pr-external-import";
          await mkdir(dir, { recursive: true });
          await page.screenshot({ path: `${dir}/${name}-${theme}-${device}-${process.env.IMPORT_SCREENSHOTS}.png`, animations: "disabled", caret: "hide" });
        }
      }
  }
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
});
