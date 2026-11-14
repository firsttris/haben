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

async function legacy(sql: postgres.Sql, abzug: boolean) {
  return sql.begin(async (tx) => {
    await tx`select set_config('haben.actor','upgrade:vorsteuer',true)`;
    const [doc] = await tx`insert into documents(filename,mime_type,size,sha256,document_date,category,net,tax,gross,vorsteuer_abzug)
      values('altes-original.jpg','image/jpeg',12,${`synthetisch-${abzug}`},'2026-09-15','software',10000,1900,11900,${abzug}) returning id`;
    await tx`insert into document_amounts(document_id,tax_rate,net,tax) values(${doc!.id},1900,10000,1900)`;
    const [entry] = await tx`insert into journal_entries(date,description,source_type,source_id,kontenrahmen)
      values('2026-09-15','Alter Beleg','document',${doc!.id},'SKR03') returning id`;
    await tx`insert into journal_lines(entry_id,account,debit,credit,tax_code) values
      (${entry!.id},'4964',${abzug ? 10000 : 11900},0,${abzug ? "VSt19" : "keineVSt"}),(${entry!.id},'1600',0,11900,null)`;
    if (abzug) await tx`insert into journal_lines(entry_id,account,debit,credit,tax_code) values(${entry!.id},'1576',1900,0,'VSt19')`;
    await tx`update journal_entries set locked_at=now() where id=${entry!.id}`;
    await tx`update documents set status='gebucht',locked_at=now() where id=${doc!.id}`;
    return doc!.id as string;
  });
}

async function snapshot(sql: postgres.Sql) {
  return {
    docs: await sql`select to_jsonb(d)::text as bytes from documents d order by id`,
    amounts: await sql`select (to_jsonb(a)-'vorsteuer_anteil')::text as bytes from document_amounts a order by id`,
    entries: await sql`select to_jsonb(e)::text as bytes from journal_entries e order by id`,
    lines: await sql`select to_jsonb(l)::text as bytes from journal_lines l order by id`,
    seals: await sql`select to_jsonb(s)::text as bytes from seals s order by id`,
    audit: await sql`select to_jsonb(a)::text as bytes from audit_log a order by seq`,
    chain: await sql`select to_jsonb(c)::text as bytes from audit_chain c`,
  };
}

describe.skipIf(!testDatabaseUrl)("Migration 0230: Satzanteile ohne Änderung des Altbestands (Postgres)", () => {
  it("erhält beide alten Booleanfälle, Journal, Originalhash, Audit und Siegel; neue Satzanteile sind gesperrt", async () => {
    const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      await admin`drop database if exists ${admin(name)} with (force)`;
      await admin`create database ${admin(name)}`;
    } finally {
      await admin.end();
    }
    const previous = mkdtempSync(join(tmpdir(), "haben-0230-upgrade-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    const added = journal.entries.find((e) => e.tag === "0230_vorsteuer_teilabzug");
    if (!added) throw new Error("Migration 0230 fehlt.");
    writeFileSync(join(previous, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx < added.idx) }));
    const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    try {
      const database = drizzle(sql);
      await migrate(database, { migrationsFolder: previous });
      const ids = [await legacy(sql, true), await legacy(sql, false)];
      const before = await snapshot(sql);
      expect(before.seals).toHaveLength(4);
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
      await migrate(database, { migrationsFolder: MIGRATIONS });
      expect(await snapshot(sql)).toEqual(before);
      expect(await sql`select vorsteuer_anteil from document_amounts order by document_id`).toEqual([{ vorsteuer_anteil: null }, { vorsteuer_anteil: null }]);
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
      await expect(sql`update document_amounts set vorsteuer_anteil=5000 where document_id=${ids[0]!}`).rejects.toThrow(/gebucht/);
      await expect(sql`delete from document_amounts where document_id=${ids[1]!}`).rejects.toThrow(/gebucht/);
      await sql.begin(async (tx) => {
        await tx`select set_config('haben.actor','upgrade:neuer-beleg',true)`;
        const [doc] =
          await tx`insert into documents(filename,mime_type,size,sha256,vorsteuer_anteil) values('neu.jpg','image/jpeg',12,'synthetisch-neu',5000) returning id`;
        await tx`insert into document_amounts(document_id,tax_rate,net,tax,vorsteuer_anteil) values(${doc!.id},1900,10000,1900,2500)`;
        await tx`update documents set status='gebucht',locked_at=now() where id=${doc!.id}`;
        const [seal] = await tx`select columns from seals where table_name='documents' and row_id=${doc!.id}`;
        expect((seal!.columns as Record<string, string[]>).document_amounts).toContain("vorsteuer_anteil");
      });
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
    } finally {
      await sql.end();
      rmSync(previous, { recursive: true, force: true });
    }
  }, 30_000);
});
