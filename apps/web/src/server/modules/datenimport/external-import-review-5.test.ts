import { createHash } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Belegimport: fünfte unabhängige Reviewrunde (Postgres)", () => {
  let sql: postgres.Sql;
  let imports: typeof import("./external-import.ts");
  let archive: typeof import("../archiv/index.ts");
  let cash: typeof import("../bank/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let database: typeof import("../../db/index.ts");
  const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF");
  const pdfSha256 = createHash("sha256").update(pdf).digest("hex");

  beforeAll(async () => {
    sql = await setupTestDb();
    imports = await import("./external-import.ts");
    archive = await import("../archiv/index.ts");
    cash = await import("../bank/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    database = await import("../../db/index.ts");
  }, 30_000);
  afterAll(async () => {
    await database?.closeDatabase();
    await sql?.end();
  });
  beforeEach(async () => {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`truncate seals, company, contacts, invoices, cash_entries, journal_entries, external_imports, lexoffice_imports cascade`;
    });
    await sql`insert into company (id,name,kleinunternehmer,rechtsform,kontenrahmen,bundesland)
      values (1,'Erfundener Exportbetrieb',false,'einzelunternehmen','SKR03','NI')`;
  });

  const invoice = (overrides: Record<string, unknown>) => ({
    kind: "invoice" as const,
    type: "invoice" as const,
    direction: "einnahme" as const,
    externalId: "re-77",
    number: "ALT-77",
    date: "2025-12-15",
    dueDate: "2026-01-15",
    contactId: null,
    contactName: "Erfundener Auslandskunde",
    currency: "EUR" as const,
    net: 100000,
    tax: 0,
    gross: 100000,
    taxes: [{ rate: 0, net: 100000, tax: 0 }],
    taxType: "net",
    status: "open" as const,
    payment: null,
    pdfSha256,
    ...overrides,
  });

  // Steuerarten aus legacy-vat.ts (TAX_TYPES) und die native Behandlung in Haben (packages/core/src/treatment.ts)
  const cases = [
    { taxType: "thirdPartyCountryService", treatment: "drittland", kz: "kz45" },
    { taxType: "intraCommunitySupply", treatment: "ig_lieferung", kz: null },
  ] as const;
  for (const { taxType, treatment, kz } of cases)
    for (const chart of ["SKR03", "SKR04"] as const)
      for (const tax of ["ist", "soll"] as const)
        it(`erhält die Steuerart ${taxType} eines übernommenen OPOS und seiner Zahlung für ${chart}/${tax}`, async () => {
          await sql`update company set kontenrahmen=${chart},versteuerung=${tax}`;
          const imported = await imports.runExternalImport(
            "review-user",
            { version: 2, source: "erfundener-originalexport", kontenrahmen: chart, entries: [invoice({ taxType })] },
            async () => pdf,
          );
          const taken = await archive.takeOverLegacyItem("review-user", imported.items[0]!.id, "2025-12-31");
          const [row] = await sql`select tax_treatment from invoices where id=${taken.id}`;
          expect.soft(row!.tax_treatment, `Die ausdrückliche Steuerart ${taxType} darf bei der OPOS-Übernahme nicht verloren gehen`).toBe(treatment);

          await cash.createCashInvoiceEntry("review-user", { invoiceId: taken.id, date: "2026-01-05", amount: 100000 }, "2026-01-05");
          if (tax === "ist" && kz) {
            const figures = await vat.computeVatFigures({ year: 2026, month: 1 });
            expect.soft(figures[kz], `Die bezahlte Leistung ins Drittland muss in ${kz} stehen`).toBe(100000);
          }
        });

  it("bietet eine stornierte (voided) Originalrechnung nicht als offenen Posten zur Übernahme an", async () => {
    const imported = await imports.runExternalImport(
      "review-user",
      {
        version: 2,
        source: "erfundener-originalexport",
        kontenrahmen: "SKR03",
        entries: [
          invoice({
            externalId: "storniert-1",
            number: "ALT-78",
            tax: 19000,
            gross: 119000,
            taxes: [{ rate: 1900, net: 100000, tax: 19000 }],
            status: "voided",
            payment: { openAmount: 119000, paidDate: null, items: [] },
          }),
        ],
      },
      async () => pdf,
    );
    const items = await archive.openLegacyItems("2025-12-31");
    const item = items.find((i) => i.id === imported.items[0]!.id);
    expect
      .soft(item && !item.blocker ? "übernehmbar" : "nicht übernehmbar", "Ein stornierter Originalbeleg ist keine offene Forderung")
      .toBe("nicht übernehmbar");
    await archive.takeOverLegacyItem("review-user", imported.items[0]!.id, "2025-12-31").catch(() => null);
    expect(await sql`select number from invoices`, "Aus einem stornierten Original darf keine native Forderung entstehen").toHaveLength(0);
  });
});
