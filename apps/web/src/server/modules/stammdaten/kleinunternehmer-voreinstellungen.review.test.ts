import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Kleinunternehmer-Ersteinrichtung nach anderen Einstellungen (Review #699)", () => {
  let sql: postgres.Sql;
  let company: typeof import("./company.ts");
  let guard: typeof import("./settings-guard.ts");
  const actor = "test:ersteinrichtung";
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

  it.each(["Nummernformat", "ELSTER-Datenschutzhinweis"])("%s vor Firmendaten bestätigt keine Regelbesteuerung", async (setting) => {
    await company.loadCompany();
    if (setting === "Nummernformat") {
      const { saveNumberFormats } = await import("./number-formats.ts");
      await saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{NNNN}", quote: "AN-{JJJJ}-{NNNN}" });
    } else {
      const { confirmElsterDatenschutz } = await import("../elster/elster.ts");
      await confirmElsterDatenschutz(actor);
    }
    // Beide Aktionen sind in eigenen Bereichen der Einstellungen möglich, ohne den Steuerstatus zu wählen.
    const initial = await company.loadCompany();
    await guard.saveCompany(actor, company.companySchema.parse({ ...initial, name: "Musterfirma", kleinunternehmer: true }), today);

    expect((await company.kleinunternehmerHistory())(previous)).toBe(true);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("ausdrücklich gespeicherte Regelbesteuerung bleibt auch bei noch leerem Firmennamen erhalten", async () => {
    const initial = company.companySchema.parse(await company.loadCompany());
    await guard.saveCompany(actor, initial, today);
    await guard.saveCompany(actor, { ...initial, name: "Musterfirma", kleinunternehmer: true }, today);
    expect((await company.kleinunternehmerHistory())(previous)).toBe(false);
  });

  it("nach einer fachfremden Einstellung tatsächlich verwendete Vorgaben bleiben erhalten", async () => {
    const initial = await company.loadCompany();
    const { saveNumberFormats } = await import("./number-formats.ts");
    await saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{NNNN}", quote: "AN-{JJJJ}-{NNNN}" });
    const previousYear = Number(today.slice(0, 4)) - 1;
    await sql.begin(async (tx) => {
      const [entry] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values (${`${previousYear}-12-10`}, 'Bereits verwendete Vorgaben', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit) values
        (${entry!.id}, '1000', 100, 0), (${entry!.id}, '1890', 0, 100)`;
      await tx`update journal_entries set locked_at = now() where id = ${entry!.id}`;
    });
    await guard.saveCompany(actor, company.companySchema.parse({ ...initial, name: "Musterfirma", kleinunternehmer: true }), today);
    expect(await company.kleinunternehmerForYear(previousYear)).toBe(false);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });
});
