import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import postgres from "postgres";
import { databaseUrlFuer, portFuer } from "./durchlaeufe.ts";
import { einrichten } from "./einrichtung.ts";

/** #652: Hinweis nach dem Speichern; echte Bankzuordnung und übermittelte Jahreserklärung in eigener Datenbank. */
test.describe.configure({ mode: "serial" });
let page: Page;
let sql: ReturnType<typeof postgres>;
let dauerfrist: typeof import("../src/server/modules/umsatzsteuer/index.ts");
let closeDatabase: () => Promise<void>;
let originalFiling: unknown;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin" })).newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await einrichten(page);
  const url = databaseUrlFuer("dauerfrist-euer");
  if (!new URL(url).pathname.endsWith("_e2e")) throw new Error("Eigene E2E-Datenbank fehlt.");
  Object.assign(process.env, {
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
    BETTER_AUTH_URL: `http://localhost:${portFuer("dauerfrist-euer")}`,
    HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    DOCUMENTS_DIR: `${process.env.E2E_DOCUMENTS_DIR ?? "test-results/e2e-belege"}-dauerfrist-euer`,
  });
  sql = postgres(url, { max: 1, onnotice: () => {} });
  dauerfrist = await import("../src/server/modules/umsatzsteuer/index.ts");
  const bank = await import("../src/server/modules/bank/index.ts");
  await sql`insert into vat_frequencies (year, from_month, frequency) values (2026, 1, 'monatlich')`;
  const [vat] = await sql`insert into vat_returns (year, month, kz83, status, source, sent_at, locked_at)
    values (2026, 12, 19000, 'sent', 'manuell', now(), now()) returning id`;
  const csv =
    `"Girokonto";"DE89370400440532013000"\n\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    `"08.01.27";"08.01.27";"Gebucht";"Testfirma";"Finanzamt";"Vorauszahlung Dezember";"Überweisung";"DE02100100100006820101";"-190,00";"";"";""\n`;
  await bank.importStatement("e2e-dauerfrist", { bytes: new TextEncoder().encode(csv), filename: "konto.csv" }, null);
  const [transaction] = await sql`select id from bank_transactions where purpose = 'Vorauszahlung Dezember'`;
  await bank.allocate("e2e-dauerfrist", { kind: "ustva", transactionId: transaction!.id, vatReturnId: vat!.id, amount: -19_000 });
  await sql`insert into annual_submissions (form, year, kind, ok, code, message, figures, request_xml, response_xml, server_response_xml)
    values ('euer', 2026, 'send', true, 0, 'Testübermittlung', '{"unveraendert": true}'::jsonb, '<x/>', '<x/>', '<x/>')`;
  originalFiling = await sql`select * from annual_submissions`;
  closeDatabase = (await import("../src/server/db/index.ts")).closeDatabase;
});

test.afterAll(async () => {
  await sql?.end();
  await closeDatabase?.();
  await page?.context().close();
  expect(errors).toEqual([]);
});

test("nach Eintragen die betroffene übermittelte EÜR nennen, ohne Speichern zu sperren", async () => {
  const messages: string[] = [];
  for (const theme of ["light", "dark"])
    for (const [device, viewport] of [
      ["desktop", { width: 1440, height: 900 }],
      ["handy", { width: 390, height: 844 }],
    ] as const) {
      await dauerfrist.saveDauerfrist("e2e-dauerfrist", { year: 2026, active: false, sondervorauszahlung: null });
      await page.setViewportSize(viewport);
      await page.goto("/umsatzsteuer/2026-12");
      await page.evaluate((t) => {
        document.documentElement.dataset.mode = t;
      }, theme);
      const card = page.getByRole("region", { name: "Dauerfristverlängerung 2026", exact: true });
      await card.getByLabel("Dauerfristverlängerung besteht für 2026").check();
      await card.getByRole("button", { name: "Stand speichern", exact: true }).click();
      await expect(card.getByRole("status")).toContainText("für 2026 eingetragen");
      await card.getByRole("status").scrollIntoViewIfNeeded();
      messages.push((await card.getByRole("status").textContent()) ?? "");
      if (process.env.DAUERFRIST_SCREENSHOTS) {
        await mkdir("test-results/dauerfrist-bilder", { recursive: true });
        await card.getByRole("form", { name: "Außerhalb von Haben" }).screenshot({
          path: `test-results/dauerfrist-bilder/dauerfrist-${theme}-${device}-${process.env.DAUERFRIST_SCREENSHOTS}.png`,
        });
      }
      expect(await sql`select * from annual_submissions`).toEqual(originalFiling);
      expect(await dauerfrist.dauerfristFor(2026)).toBe(true);
    }
  expect(messages.every((message) => message.includes("EÜR 2026") && message.includes("Steuerberatung"))).toBe(true);
});

test("unveränderter Stand speichert ohne Berichtigungshinweis", async () => {
  await page.goto("/umsatzsteuer/2026-12");
  const card = page.getByRole("region", { name: "Dauerfristverlängerung 2026", exact: true });
  await card.getByRole("button", { name: "Stand speichern", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("für 2026 eingetragen");
  await expect(card.getByRole("status")).not.toContainText("EÜR");
  expect(await sql`select * from annual_submissions`).toEqual(originalFiling);
});
