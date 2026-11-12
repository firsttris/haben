import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

describe.skipIf(!testDatabaseUrl)("Migration 0205: vorhandene Abschläge (Postgres)", () => {
  it("ändert weder Buchungen noch Belegstände, Audit-Kette oder bestehende Siegel", async () => {
    const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await admin`drop database if exists ${admin(name)} with (force)`;
    await admin`create database ${admin(name)}`;
    await admin.end();
    const previous = mkdtempSync(join(tmpdir(), "haben-migration-0205-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8"));
    writeFileSync(join(previous, "meta/_journal.json"), JSON.stringify({ ...full, entries: full.entries.filter((e: { idx: number }) => e.idx < 205) }));
    const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(sql), { migrationsFolder: previous });
      await sql`insert into company(id,name,versteuerung) values(1,'Testfirma','soll')`;
      const [invoice] = await sql`insert into invoices(issue_date,due_date,variant,net,tax,gross,pdf)
        values('2026-12-01','2026-12-15','abschlag',30000,5700,35700,${Buffer.from("%PDF Testbestand")}) returning id`;
      const id = invoice!.id;
      await sql`insert into invoice_lines(invoice_id,position,description,quantity,unit,unit_price,tax_rate,net)
        values(${id},1,'Anforderung',1000,'Psch.',30000,1900,30000)`;
      await sql`insert into invoice_taxes(invoice_id,rate,base,tax) values(${id},1900,30000,5700)`;
      await sql.begin(async (tx) => {
        const [entry] = await tx`insert into journal_entries(date,description,source_type,source_id,kontenrahmen)
          values('2026-12-01','Vorhandener Soll-Abschlag','invoice',${id},'SKR03') returning id`;
        await tx`insert into journal_lines(entry_id,account,debit,credit,tax_code) values
          (${entry!.id},'1400',35700,0,null),(${entry!.id},'8400',0,30000,'USt19'),(${entry!.id},'1776',0,5700,'USt19')`;
        await tx`update journal_entries set locked_at = now() where id = ${entry!.id}`;
      });
      await sql`update invoices set status='final',number='2026-001',locked_at=now() where id=${id}`;
      const oldInvoice = await sql`select to_jsonb(i) as value from invoices i where id=${id}`;
      const oldEntries = await sql`select * from journal_entries order by id`;
      const oldLines = await sql`select * from journal_lines order by id`;
      const oldSeals = await sql`select * from seals order by id`;
      const oldAudit = await sql`select * from audit_log order by seq`;
      await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
      expect(await sql`select to_jsonb(i)-'advance_type' as value from invoices i where id=${id}`).toEqual(oldInvoice);
      expect((await sql`select advance_type from invoices where id=${id}`)[0]!.advance_type).toBeNull();
      expect(await sql`select * from journal_entries order by id`).toEqual(oldEntries);
      expect(await sql`select * from journal_lines order by id`).toEqual(oldLines);
      expect(await sql`select * from seals order by id`).toEqual(oldSeals);
      expect(await sql`select * from audit_log order by seq`).toEqual(oldAudit);
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
    } finally {
      await sql.end();
      rmSync(previous, { recursive: true });
    }
  }, 120_000);
});
