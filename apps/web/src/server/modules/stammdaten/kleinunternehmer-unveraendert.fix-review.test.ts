import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Kleinunternehmer-Ersteinrichtung nach unveränderter Verwaltungseinstellung (unabhängiges Review #699)", () => {
  let sql: postgres.Sql;
  let company: typeof import("./company.ts");
  let guard: typeof import("./settings-guard.ts");
  const actor = "test:unabhaengiges-review";
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const previous = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);

  beforeAll(async () => {
    sql = await setupTestDb();
    company = await import("./company.ts");
    guard = await import("./settings-guard.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate company, seals, audit_log, audit_chain cascade`;
    await sql`insert into audit_chain (id, seq, hash) values (1, 0, haben_audit_genesis())`;
  });

  it("Speichern der unveränderten Nummernformate bestätigt keine Regelbesteuerung", async () => {
    const initial = await company.loadCompany();
    const { saveNumberFormats } = await import("./number-formats.ts");
    await saveNumberFormats(actor, { invoice: initial.invoiceNumberFormat, quote: initial.quoteNumberFormat });
    await guard.saveCompany(actor, company.companySchema.parse({ ...initial, name: "Synthetische Musterfirma", kleinunternehmer: true }), today);

    expect((await company.kleinunternehmerHistory())(previous)).toBe(true);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });
});
