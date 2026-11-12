import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

describe.skipIf(!testDatabaseUrl)("Firmendaten-Bestätigung bei einer bestehenden Installation (Postgres)", () => {
  it("ergänzt die Kennzeichnung ohne alte Firmenwerte, Audit-Einträge und Buchungen umzuschreiben", async () => {
    const initial = await setupTestDb();
    await initial.end();
    const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      await admin`drop database if exists ${admin(name)} with (force)`;
      await admin`create database ${admin(name)}`;
    } finally {
      await admin.end();
    }
    // Wirklichen Vorversionsstand migrieren, nicht alte Audit-JSONs in einer neuen Datenbank erfinden.
    const previous = mkdtempSync(join(tmpdir(), "haben-firmendaten-migration-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
    const next = full.entries.findIndex((entry: { tag: string }) => entry.tag.endsWith("_firmendaten_gespeichert"));
    expect(next).toBeGreaterThan(0);
    writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...full, entries: full.entries.slice(0, next) }));
    const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const database = drizzle(sql);
    try {
      await migrate(database, { migrationsFolder: previous });
      const [date] = await sql`select to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD') as today`;
      const today = date!.today as string;
      const previousYear = Number(today.slice(0, 4)) - 1;
      await sql.begin(async (tx) => {
        await tx`select set_config('haben.actor', 'altbestand:inhaber', true)`;
        await tx`insert into company (id, name, kleinunternehmer) values (1, 'Bestätigter Altbetrieb', false)`;
        const [entry] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
          values (${`${previousYear}-12-10`}, 'Regelbesteuerter Altumsatz', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
        await tx`insert into journal_lines (entry_id, account, debit, credit, tax_code) values
          (${entry!.id}, '1400', 11900, 0, null), (${entry!.id}, '8400', 0, 10000, 'USt19'), (${entry!.id}, '1776', 0, 1900, 'USt19')`;
        await tx`update journal_entries set locked_at = now() where id = ${entry!.id}`;
        await tx`update company set kleinunternehmer = true where id = 1`;
      });
      const before = {
        company: await sql`select to_jsonb(company) as value from company`,
        audit: await sql`select * from audit_log order by seq`,
        entries: await sql`select * from journal_entries order by id`,
        lines: await sql`select * from journal_lines order by id`,
      };
      await migrate(database, { migrationsFolder: MIGRATIONS });
      expect(await sql`select firmendaten_gespeichert_at from company`).toEqual([{ firmendaten_gespeichert_at: null }]);
      expect(await sql`select to_jsonb(company) - 'firmendaten_gespeichert_at' as value from company`).toEqual(before.company);
      expect(await sql`select * from audit_log order by seq`).toEqual(before.audit);
      expect(await sql`select * from journal_entries order by id`).toEqual(before.entries);
      expect(await sql`select * from journal_lines order by id`).toEqual(before.lines);

      const company = await import("../modules/stammdaten/company.ts");
      const guard = await import("../modules/stammdaten/settings-guard.ts");
      expect(await company.kleinunternehmerForYear(previousYear)).toBe(false);
      expect((await company.kleinunternehmerHistory())(today)).toBe(true);
      const input = company.companySchema.parse(await company.loadCompany());
      await guard.saveCompany("neuer:inhaber", input, today);
      expect(await company.kleinunternehmerForYear(previousYear)).toBe(false);
      expect((await company.kleinunternehmerHistory())(today)).toBe(true);
      expect(await sql`select * from audit_log where seq <= ${before.audit.at(-1)!.seq} order by seq`).toEqual(before.audit);
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
    } finally {
      const { closeDatabase } = await import("./index.ts");
      await closeDatabase();
      await sql.end();
    }
  }, 120_000);
});
