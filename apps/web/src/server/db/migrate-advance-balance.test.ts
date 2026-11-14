import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

describe.skipIf(!testDatabaseUrl)("Migration des Anzahlungs-Bilanzverfahrens: Altbestand nach #745 (Postgres)", () => {
  it("erhält Altbeleg, Erlösbuchung, Audit und Siegel auch bei einer Zahlung nach dem Upgrade", async () => {
    // App-Umgebung wie bei den Integrationstests; anschließend den echten Vorversionsstand leer aufbauen.
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
    const previous = mkdtempSync(join(tmpdir(), "haben-migration-advance-balance-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8"));
    const addition = (full.entries as { idx: number; tag: string }[]).find((entry) => entry.tag === "0223_anzahlung_bilanz");
    if (!addition) throw new Error("Migration des Anzahlungs-Bilanzverfahrens fehlt.");
    writeFileSync(
      join(previous, "meta/_journal.json"),
      JSON.stringify({ ...full, entries: full.entries.filter((entry: { idx: number }) => entry.idx < addition.idx) }),
    );
    const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    let closeAppDatabase: (() => Promise<void>) | undefined;
    try {
      const database = drizzle(sql);
      await migrate(database, { migrationsFolder: previous });
      expect(
        await sql`select column_name from information_schema.columns where table_name='invoices'
        and column_name in ('advance_accounting','replaces_invoice_id')`,
      ).toEqual([]);
      const pdf = Buffer.from("%PDF-1.7\nAlte Anzahlungsrechnung nach #745\n%%EOF");
      const xml = '<?xml version="1.0" encoding="UTF-8"?><Anzahlung nummer="2026-001">357.00</Anzahlung>';
      const pdfHash = createHash("sha256").update(pdf).digest("hex");
      const xmlHash = createHash("sha256").update(xml).digest("hex");
      const { invoiceId, entryId } = await sql.begin(async (tx) => {
        await tx`select set_config('haben.actor','upgrade:altbestand',true)`;
        await tx`insert into company(id,name,rechtsform,kontenrahmen,versteuerung,journal_ab)
          values(1,'Alte Anzahlungs-GmbH','gmbh','SKR03','soll',2026)`;
        const [invoice] = await tx`insert into invoices(issue_date,due_date,variant,advance_type,net,tax,gross,pdf,pdf_sha256,xml,xml_sha256)
          values('2026-12-01','2026-12-15','abschlag','anzahlung',30000,5700,35700,${pdf},${pdfHash},${xml},${xmlHash}) returning id`;
        const invoiceId = invoice!.id as string;
        await tx`insert into invoice_lines(invoice_id,position,description,quantity,unit,unit_price,tax_rate,net)
          values(${invoiceId},1,'Anzahlung vor Leistung, altes Bilanzverfahren',1000,'Psch.',30000,1900,30000)`;
        await tx`insert into invoice_taxes(invoice_id,rate,base,tax) values(${invoiceId},1900,30000,5700)`;
        const [entry] = await tx`insert into journal_entries(date,description,source_type,source_id,kontenrahmen)
          values('2026-12-01','Erlös des Altbelegs nach #745','invoice',${invoiceId},'SKR03') returning id`;
        const entryId = entry!.id as string;
        await tx`insert into journal_lines(entry_id,account,debit,credit,tax_code) values
          (${entryId},'1400',35700,0,null),(${entryId},'8400',0,30000,'USt19'),(${entryId},'1766',0,5700,'USt19')`;
        await tx`update journal_entries set locked_at=now() where id=${entryId}`;
        await tx`update invoices set status='final',number='2026-001',locked_at=now() where id=${invoiceId}`;
        return { invoiceId, entryId };
      });
      // PostgreSQL-Text umfasst auch Zeitstempel, Binärdaten, Hash-Kette und die gespeicherten Siegelspalten.
      const snapshot = async () => ({
        company: await sql`select (to_jsonb(c)-'ohne_vorsteuerabzug')::text as bytes from company c order by id`,
        invoice: await sql`select (to_jsonb(i)-'advance_accounting'-'replaces_invoice_id'-'service_date')::text as bytes from invoices i order by id`,
        invoiceLines: await sql`select to_jsonb(l)::text as bytes from invoice_lines l order by id`,
        invoiceTaxes: await sql`select to_jsonb(t)::text as bytes from invoice_taxes t order by invoice_id,rate`,
        entries: await sql`select to_jsonb(e)::text as bytes from journal_entries e order by id`,
        lines: await sql`select to_jsonb(l)::text as bytes from journal_lines l order by id`,
        seals: await sql`select to_jsonb(s)::text as bytes from seals s order by id`,
        audit: await sql`select to_jsonb(a)::text as bytes from audit_log a order by seq`,
      });
      const old = await snapshot();
      expect(old.entries).toHaveLength(1);
      expect(old.lines).toHaveLength(3);
      expect(old.seals).toHaveLength(2);
      expect(old.audit.length).toBeGreaterThan(0);
      const [auditHead] = await sql`select max(seq) as seq from audit_log`;
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);

      await migrate(database, { migrationsFolder: MIGRATIONS });
      expect(await snapshot()).toEqual(old);
      expect(await sql`select status,advance_type,advance_accounting,replaces_invoice_id from invoices where id=${invoiceId}`).toEqual([
        { status: "final", advance_type: "anzahlung", advance_accounting: null, replaces_invoice_id: null },
      ]);
      expect(await sql`select encode(pdf,'hex') as pdf,xml,pdf_sha256,xml_sha256 from invoices where id=${invoiceId}`).toEqual([
        { pdf: pdf.toString("hex"), xml, pdf_sha256: pdfHash, xml_sha256: xmlHash },
      ]);
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);

      await expect(sql`update invoices set advance_accounting='deferred' where id=${invoiceId}`).rejects.toThrow(/festgeschrieben/);
      await expect(sql`update invoices set pdf=${Buffer.from("geändert")} where id=${invoiceId}`).rejects.toThrow(/festgeschrieben/);
      await expect(sql`update invoice_lines set net=1 where invoice_id=${invoiceId}`).rejects.toThrow(/festgeschrieben/);
      await expect(sql`update invoice_taxes set tax=1 where invoice_id=${invoiceId}`).rejects.toThrow(/festgeschrieben/);
      await expect(sql`update journal_entries set description='geändert' where id=${entryId}`).rejects.toThrow(/festgeschrieben/);
      await expect(sql`update journal_lines set credit=1 where entry_id=${entryId} and account='8400'`).rejects.toThrow(/festgeschrieben/);
      expect(await snapshot()).toEqual(old);

      ({ closeDatabase: closeAppDatabase } = await import("./index.ts"));
      const bank = await import("../modules/bank/index.ts");
      await bank.createCashInvoiceEntry("upgrade:zahlung", { invoiceId, date: "2026-12-12", amount: 11_900 }, "2026-12-12");
      expect(await sql`select account from journal_lines where account in ('1710','3250')`).toEqual([]);
      const balances = await sql`select account,sum(debit-credit)::int as saldo from journal_lines
        group by account having sum(debit-credit)<>0 order by account`;
      expect(balances).toEqual([
        { account: "1000", saldo: 11_900 },
        { account: "1400", saldo: 23_800 },
        { account: "1766", saldo: -3_800 },
        { account: "1776", saldo: -1_900 },
        { account: "8400", saldo: -30_000 },
      ]);
      expect(await sql`select advance_accounting,replaces_invoice_id from invoices where id=${invoiceId}`).toEqual([
        { advance_accounting: null, replaces_invoice_id: null },
      ]);
      expect(await sql`select (to_jsonb(i)-'advance_accounting'-'replaces_invoice_id'-'service_date')::text as bytes from invoices i order by id`).toEqual(old.invoice);
      expect(await sql`select to_jsonb(l)::text as bytes from invoice_lines l order by id`).toEqual(old.invoiceLines);
      expect(await sql`select to_jsonb(t)::text as bytes from invoice_taxes t order by invoice_id,rate`).toEqual(old.invoiceTaxes);
      expect(await sql`select to_jsonb(e)::text as bytes from journal_entries e where id=${entryId} order by id`).toEqual(old.entries);
      expect(await sql`select to_jsonb(l)::text as bytes from journal_lines l where entry_id=${entryId} order by id`).toEqual(old.lines);
      expect(await sql`select to_jsonb(s)::text as bytes from seals s where row_id in (${invoiceId},${entryId}) order by id`).toEqual(old.seals);
      expect(await sql`select to_jsonb(a)::text as bytes from audit_log a where seq<=${auditHead!.seq} order by seq`).toEqual(old.audit);
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
    } finally {
      await closeAppDatabase?.();
      await sql.end();
      rmSync(previous, { recursive: true });
    }
  }, 120_000);
});
