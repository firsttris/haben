import { createHash } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Belegimport: vierte unabhängige Reviewrunde (Postgres)", () => {
  let sql: postgres.Sql;
  let imports: typeof import("./external-import.ts");
  let archive: typeof import("../archiv/index.ts");
  let cash: typeof import("../bank/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let database: typeof import("../../db/index.ts");
  const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF");

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
      values (1,'Erfundener Ausfuhrbetrieb',false,'einzelunternehmen','SKR03','NI')`;
  });

  for (const chart of ["SKR03", "SKR04"] as const)
    for (const tax of ["ist", "soll"] as const)
      for (const form of ["einzelunternehmen", "gmbh"] as const)
        it(`erhält die Steuerart eines übernommenen Ausfuhr-OPOS und seiner Zahlung für ${chart}/${tax}/${form}`, async () => {
          await sql`update company set kontenrahmen=${chart},versteuerung=${tax},rechtsform=${form}`;
          const imported = await imports.runExternalImport(
            "review-user",
            {
              version: 2,
              source: "erfundener-originalexport",
              kontenrahmen: chart,
              entries: [
                {
                  kind: "invoice",
                  type: "invoice",
                  direction: "einnahme",
                  externalId: "ausfuhr-42",
                  number: "ALT-42",
                  date: "2025-12-15",
                  dueDate: "2026-01-15",
                  contactId: null,
                  contactName: "Erfundener Ausfuhrkunde",
                  currency: "EUR",
                  net: 100000,
                  tax: 0,
                  gross: 100000,
                  taxes: [{ rate: 0, net: 100000, tax: 0 }],
                  taxType: "thirdPartyCountryDelivery",
                  status: "open",
                  payment: null,
                  pdfSha256: createHash("sha256").update(pdf).digest("hex"),
                },
              ],
            },
            async () => pdf,
          );
          const taken = await archive.takeOverLegacyItem("review-user", imported.items[0]!.id, "2025-12-31");
          const [invoice] = await sql`select tax_treatment from invoices where id=${taken.id}`;
          expect.soft(invoice!.tax_treatment, "Die ausdrückliche Ausfuhr-Steuerart darf bei der OPOS-Übernahme nicht verloren gehen").toBe("ausfuhr");

          await cash.createCashInvoiceEntry("review-user", { invoiceId: taken.id, date: "2026-01-05", amount: 100000 }, "2026-01-05");
          const figures = await vat.computeVatFigures({ year: 2026, month: 1 });
          if (tax === "ist") {
            // Dieselbe Zuordnung wie legacy-vat.ts und der native Ausfuhr-Zahlungsweg: Kz 43 statt regulärem 0-%-Umsatz.
            expect.soft(figures.kz43, "Die bezahlte Ausfuhr muss in Kz 43 stehen").toBe(100000);
            expect.soft(figures.steuerfrei, "Die Ausfuhr darf kein ungemeldeter regulärer Umsatz zum Nullsteuersatz werden").toBe(0);
            const paymentLines = await sql`select tax_code,basis from journal_lines l
              join journal_entries e on e.id=l.entry_id where e.source_type='kasse' and l.basis is not null`;
            expect.soft(paymentLines).toContainEqual({ tax_code: "Ausfuhr", basis: 100000 });
          }
        });
  it("weist einen Widerspruch zwischen Ausfuhr-Steuerart und ausgewiesener Umsatzsteuer vor der nativen Übernahme ab", async () => {
    const imported = await imports.runExternalImport(
      "review-user",
      {
        version: 2,
        source: "erfundener-originalexport",
        kontenrahmen: "SKR03",
        entries: [
          {
            kind: "invoice",
            type: "invoice",
            direction: "einnahme",
            externalId: "widerspruch-42",
            number: "ALT-42",
            date: "2025-12-15",
            dueDate: "2026-01-15",
            contactId: null,
            contactName: "Erfundener Ausfuhrkunde",
            currency: "EUR",
            net: 100000,
            tax: 19000,
            gross: 119000,
            taxes: [{ rate: 1900, net: 100000, tax: 19000 }],
            taxType: "thirdPartyCountryDelivery",
            status: "open",
            payment: null,
            pdfSha256: createHash("sha256").update(pdf).digest("hex"),
          },
        ],
      },
      async () => pdf,
    );
    await expect(archive.takeOverLegacyItem("review-user", imported.items[0]!.id, "2025-12-31")).rejects.toThrow("widersprechen sich");
    expect(await sql`select * from invoices`).toHaveLength(0);
    expect(await sql`select * from journal_entries`).toHaveLength(0);
    expect(await sql`select * from lexoffice_vouchers`).toHaveLength(1);
  });
});
