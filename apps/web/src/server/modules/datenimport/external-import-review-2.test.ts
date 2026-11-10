import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Belegimport: zweite unabhängige Reviewrunde (Postgres)", () => {
  let sql: postgres.Sql;
  let imports: typeof import("./external-import.ts");
  let cash: typeof import("../bank/index.ts");
  let ledger: typeof import("../buchhaltung/index.ts");
  let database: typeof import("../../db/index.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    imports = await import("./external-import.ts");
    cash = await import("../bank/index.ts");
    ledger = await import("../buchhaltung/index.ts");
    database = await import("../../db/index.ts");
  }, 30_000);
  afterAll(async () => {
    await database?.closeDatabase();
    await sql?.end();
  });
  beforeEach(async () => {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`truncate seals, company, cash_entries, journal_entries, external_imports cascade`;
    });
    await sql`insert into company (id,name,kleinunternehmer,rechtsform,kontenrahmen,bundesland)
      values (1,'Erfundener Reviewbetrieb',true,'einzelunternehmen','SKR03','NI')`;
  });

  for (const chart of ["SKR03", "SKR04"] as const)
    for (const tax of ["ist", "soll"] as const)
      it(`hält nach übernommener Bareinnahme Kassenbuch und Kassenkonto gleich für ${chart}/${tax}`, async () => {
        await sql`update company set kontenrahmen=${chart},versteuerung=${tax}`;
        const account = chart === "SKR03" ? "1000" : "1600";
        await imports.runExternalImport(
          "review-user",
          {
            version: 1,
            source: "erfundener-kassenexport",
            kontenrahmen: chart,
            entries: [
              {
                kind: "journal",
                externalId: "bareinnahme-42",
                date: "2026-01-05",
                description: "Erfundene Barzahlung aus Originalkassenbuch",
                lines: [
                  { account, debit: 40000, credit: 0 },
                  { account: chart === "SKR03" ? "1400" : "1200", debit: 0, credit: 40000 },
                ],
                cashFlows: [{ date: "2026-01-05", amount: 40000, category: "einnahme", evidence: "Erfundenes Originalkassenbuch, Zeile 42" }],
              },
            ],
          },
          async () => new Uint8Array(),
        );
        const journal = await ledger.kontenblatt(account, { from: "2026-01-01", to: "2027-01-01" });
        expect(journal.saldo).toBe(40000);
        expect((await cash.cashBook(2026)).closing, "Übernommenes Bargeld muss auch im Kassenbuch verfügbar sein").toBe(journal.saldo);
        await expect(cash.createCashEntry("review-user", { kind: "entnahme", date: "2026-01-06", amount: 10000 }, "2026-01-06")).resolves.toBeDefined();
      });
});
