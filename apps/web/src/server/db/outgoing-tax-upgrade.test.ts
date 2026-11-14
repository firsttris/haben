import { createHash } from "node:crypto";
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
const TABLES = ["allocations", "cash_entries", "invoices", "quotes", "recurring_invoices"];
const LEGACY_REASON = "Steuerfreie Heilbehandlung nach § 4 Nr. 14 Buchst. a UStG.";
const TAX_DETAILS = { exemption: { number: "14", letter: "a" }, ancillary: null, foreignPlace: null, assetDisposal: false };
const PDF = Buffer.from("%PDF-1.7\nFestgeschriebenes Original vor 0231\n%%EOF");
const XML = '<?xml version="1.0" encoding="UTF-8"?><Rechnung nummer="2026-001">100.00</Rechnung>';
const PDF_HASH = createHash("sha256").update(PDF).digest("hex");
const XML_HASH = createHash("sha256").update(XML).digest("hex");

interface LegacyIds {
  invoice: string;
  quote: string;
  recurring: string;
  allocation: string;
  cash: string;
  entries: string[];
}

async function lockedEntry(tx: postgres.TransactionSql, source: string, sourceId: string, kontenrahmen: string, debit: string, credit: string, amount: number) {
  const [entry] = await tx`insert into journal_entries(date,description,source_type,source_id,kontenrahmen)
    values('2026-10-01','Altbestand vor 0231',${source},${sourceId},${kontenrahmen}) returning id`;
  const id = entry!.id as string;
  await tx`insert into journal_lines(entry_id,account,debit,credit) values
    (${id},${debit},${amount},0),(${id},${credit},0,${amount})`;
  await tx`update journal_entries set locked_at=now() where id=${id}`;
  return id;
}

/** SQL gegen das echte alte Schema: Kein Import des neuen App-Schemas und keine abgeschalteten Trigger. */
async function legacyRows(sql: postgres.Sql, kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll"): Promise<LegacyIds> {
  return sql.begin(async (tx) => {
    await tx`select set_config('haben.actor','upgrade:altbestand',true)`;
    await tx`insert into company(id,name,kontenrahmen,versteuerung,journal_ab)
      values(1,'Musterpraxis vor 0231',${kontenrahmen},${versteuerung},2026)`;
    const [contact] = await tx`insert into contacts(name) values('Musterkunde') returning id`;
    const [invoice] = await tx`insert into invoices(contact_id,issue_date,due_date,tax_treatment,exemption_reason,net,tax,gross,pdf,pdf_sha256,xml,xml_sha256)
      values(${contact!.id},'2026-10-01','2026-10-15','steuerfrei',${LEGACY_REASON},10000,0,10000,${PDF},${PDF_HASH},${XML},${XML_HASH}) returning id`;
    const invoiceId = invoice!.id as string;
    await tx`insert into invoice_lines(invoice_id,position,description,quantity,unit,unit_price,tax_rate,net)
      values(${invoiceId},1,'Heilbehandlung',1000,'Psch.',10000,0,10000)`;
    await tx`insert into invoice_taxes(invoice_id,rate,base,tax) values(${invoiceId},0,10000,0)`;
    const receivable = kontenrahmen === "SKR03" ? "1400" : "1200";
    const revenue = kontenrahmen === "SKR03" ? "8100" : "4100";
    const bankAccount = kontenrahmen === "SKR03" ? "1200" : "1800";
    const cashAccount = kontenrahmen === "SKR03" ? "1000" : "1600";
    const invoiceEntry = await lockedEntry(tx, "invoice", invoiceId, kontenrahmen, receivable, revenue, 10000);
    await tx`update invoices set status='final',number='2026-001',locked_at=now() where id=${invoiceId}`;
    const [account] = await tx`insert into bank_accounts(name,iban) values('Giro','DE89370400440532013000') returning id`;
    const [imported] = await tx`insert into bank_imports(bank_account_id,filename,sha256,format,added,skipped)
      values(${account!.id},'alt.csv','upgrade-0231','csv',1,0) returning id`;
    const [transaction] = await tx`insert into bank_transactions(bank_account_id,import_id,booking_date,amount,purpose,dedup_hash)
      values(${account!.id},${imported!.id},'2026-10-01',6000,${LEGACY_REASON},'upgrade-0231') returning id`;
    const [allocation] = await tx`insert into allocations(transaction_id,kind,invoice_id,amount,tax_shares,tax_shares_invoice_id)
      values(${transaction!.id},'invoice',${invoiceId},6000,'[{"rate":0,"net":6000,"tax":0}]',${invoiceId}) returning id`;
    const bankEntry = await lockedEntry(tx, "bank", transaction!.id, kontenrahmen, bankAccount, receivable, 6000);
    const [cash] = await tx`insert into cash_entries(number,date,amount,kind,text,invoice_id,tax_shares,tax_shares_invoice_id)
      values(1,'2026-10-01',4000,'rechnung',${LEGACY_REASON},${invoiceId},'[{"rate":0,"net":4000,"tax":0}]',${invoiceId}) returning id`;
    const cashEntry = await lockedEntry(tx, "cash", cash!.id, kontenrahmen, cashAccount, receivable, 4000);
    const [quote] = await tx`insert into quotes(contact_id,issue_date,valid_until,tax_treatment,exemption_reason,net,tax,gross,pdf,pdf_sha256)
      values(${contact!.id},'2026-10-01','2026-10-31','steuerfrei',${LEGACY_REASON},10000,0,10000,${PDF},${PDF_HASH}) returning id`;
    await tx`insert into quote_lines(quote_id,position,description,quantity,unit,unit_price,tax_rate,net)
      values(${quote!.id},1,'Heilbehandlung',1000,'Psch.',10000,0,10000)`;
    await tx`update quotes set status='final',number='A-2026-001',locked_at=now() where id=${quote!.id}`;
    const [recurring] = await tx`insert into recurring_invoices(name,contact_id,tax_treatment,exemption_reason,lines,interval_months,anchor_day,next_date)
      values('Alte Serie',${contact!.id},'steuerfrei',${LEGACY_REASON},
      '[{"description":"Heilbehandlung","quantity":1000,"unit":"Psch.","unitPrice":10000,"taxRate":0}]',1,1,'2026-11-01') returning id`;
    return {
      invoice: invoiceId,
      quote: quote!.id as string,
      recurring: recurring!.id as string,
      allocation: allocation!.id as string,
      cash: cash!.id as string,
      entries: [invoiceEntry, bankEntry, cashEntry],
    };
  });
}

/** PostgreSQL-Text bewahrt auch Zeitstempel, Binärdaten, Hashes und die gespeicherten Siegelspalten. */
async function snapshot(sql: postgres.Sql, ids: LegacyIds, auditSeq: string) {
  const sealedIds = [ids.invoice, ids.allocation, ids.cash, ...ids.entries];
  return {
    company: await sql`select to_jsonb(c)::text as bytes from company c order by id`,
    contacts: await sql`select to_jsonb(c)::text as bytes from contacts c order by id`,
    invoice: await sql`select (to_jsonb(i)-'tax_details')::text as bytes from invoices i where id=${ids.invoice}`,
    invoiceLines: await sql`select to_jsonb(l)::text as bytes from invoice_lines l where invoice_id=${ids.invoice} order by id`,
    invoiceTaxes: await sql`select to_jsonb(t)::text as bytes from invoice_taxes t where invoice_id=${ids.invoice} order by rate`,
    quote: await sql`select (to_jsonb(q)-'tax_details')::text as bytes from quotes q where id=${ids.quote}`,
    quoteLines: await sql`select to_jsonb(l)::text as bytes from quote_lines l where quote_id=${ids.quote} order by id`,
    recurring: await sql`select (to_jsonb(r)-'tax_details')::text as bytes from recurring_invoices r where id=${ids.recurring}`,
    allocations: await sql`select (to_jsonb(a)-'tax_details')::text as bytes from allocations a where id=${ids.allocation}`,
    cash: await sql`select (to_jsonb(c)-'tax_details')::text as bytes from cash_entries c where id=${ids.cash}`,
    bankAccounts: await sql`select to_jsonb(b)::text as bytes from bank_accounts b order by id`,
    bankImports: await sql`select to_jsonb(b)::text as bytes from bank_imports b order by id`,
    bankTransactions: await sql`select to_jsonb(b)::text as bytes from bank_transactions b order by id`,
    entries: await sql`select to_jsonb(e)::text as bytes from journal_entries e where id in ${sql(ids.entries)} order by id`,
    lines: await sql`select to_jsonb(l)::text as bytes from journal_lines l where entry_id in ${sql(ids.entries)} order by id`,
    seals: await sql`select to_jsonb(s)::text as bytes from seals s where row_id in ${sql(sealedIds)} order by id`,
    audit: await sql`select to_jsonb(a)::text as bytes from audit_log a where seq<=${auditSeq} order by seq`,
  };
}

async function expectLocked(sql: postgres.Sql, ids: LegacyIds) {
  await expect(sql`update invoices set tax_details=${JSON.stringify(TAX_DETAILS)}::jsonb where id=${ids.invoice}`).rejects.toThrow(/festgeschrieben/);
  await expect(sql`update invoices set pdf=${Buffer.from("geändert")} where id=${ids.invoice}`).rejects.toThrow(/festgeschrieben/);
  await expect(sql`delete from invoices where id=${ids.invoice}`).rejects.toThrow(/festgeschrieben/);
  await expect(sql`update invoice_lines set net=1 where invoice_id=${ids.invoice}`).rejects.toThrow(/festgeschrieben/);
  await expect(sql`update invoice_taxes set base=1 where invoice_id=${ids.invoice}`).rejects.toThrow(/festgeschrieben/);
  await expect(sql`update journal_entries set description='geändert' where id=${ids.entries[0]!}`).rejects.toThrow(/festgeschrieben/);
  await expect(sql`update journal_lines set credit=1 where entry_id=${ids.entries[0]!} and credit>0`).rejects.toThrow(/festgeschrieben/);
  await expect(sql`update allocations set tax_details=${JSON.stringify(TAX_DETAILS)}::jsonb where id=${ids.allocation}`).rejects.toThrow(/nur ergänzt/);
  await expect(sql`delete from allocations where id=${ids.allocation}`).rejects.toThrow(/nur ergänzt/);
  await expect(sql`update cash_entries set tax_details=${JSON.stringify(TAX_DETAILS)}::jsonb where id=${ids.cash}`).rejects.toThrow(/nur ergänzt/);
  await expect(sql`delete from cash_entries where id=${ids.cash}`).rejects.toThrow(/nur ergänzt/);
  await expect(sql`update quotes set tax_details=${JSON.stringify(TAX_DETAILS)}::jsonb where id=${ids.quote}`).rejects.toThrow(/festgeschrieben/);
}

describe.skipIf(!testDatabaseUrl)("Migration der Ausgangszuordnung und unveränderlicher Altbestand (Postgres)", () => {
  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)(
    "erhält Originale, Zahlungen, Siegel und Audit und versiegelt neue Steuerdetails (%s/%s)",
    async (kontenrahmen, versteuerung) => {
      const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
      const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
      try {
        await admin`drop database if exists ${admin(name)} with (force)`;
        await admin`create database ${admin(name)}`;
      } finally {
        await admin.end();
      }
      const previous = mkdtempSync(join(tmpdir(), "haben-migration-outgoing-tax-"));
      cpSync(MIGRATIONS, previous, { recursive: true });
      const full = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8")) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const addition = full.entries.find((entry) => entry.tag === "0231_outgoing_tax_details");
      if (!addition) throw new Error("Migration der Ausgangszuordnung fehlt.");
      const older = full.entries.filter((entry) => entry.idx < addition.idx);
      writeFileSync(join(previous, "meta/_journal.json"), JSON.stringify({ ...full, entries: older }));
      const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
      try {
        const database = drizzle(sql);
        await migrate(database, { migrationsFolder: previous });
        expect(await sql`select count(*)::int as n,max(created_at)::text as last from drizzle.__drizzle_migrations`).toEqual([
          { n: older.length, last: String(older.at(-1)!.when) },
        ]);
        expect(
          await sql`select table_name from information_schema.columns where table_schema='public'
        and table_name in ${sql(TABLES)} and column_name='tax_details'`,
        ).toEqual([]);
        const ids = await legacyRows(sql, kontenrahmen, versteuerung);
        const [head] = await sql`select seq::text from audit_chain`;
        const auditSeq = head!.seq as string;
        const old = await snapshot(sql, ids, auditSeq);
        const oldHead = await sql`select to_jsonb(c)::text as bytes from audit_chain c`;
        expect(old.invoice).toHaveLength(1);
        expect(old.entries).toHaveLength(3);
        expect(old.lines).toHaveLength(6);
        expect(old.seals).toHaveLength(6);
        expect(old.audit.length).toBeGreaterThan(20);
        expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);

        await migrate(database, { migrationsFolder: MIGRATIONS });
        expect(await sql`select count(*)::int as n from drizzle.__drizzle_migrations`).toEqual([{ n: full.entries.length }]);
        expect(await sql`select hash,created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 1`).toEqual([
          {
            hash: createHash("sha256")
              .update(readFileSync(join(MIGRATIONS, `${addition.tag}.sql`)))
              .digest("hex"),
            created_at: String(addition.when),
          },
        ]);
        expect(await snapshot(sql, ids, auditSeq)).toEqual(old);
        expect(await sql`select to_jsonb(c)::text as bytes from audit_chain c`).toEqual(oldHead);
        expect(
          await sql`select table_name,is_nullable,column_default,data_type from information_schema.columns where table_schema='public'
        and table_name in ${sql(TABLES)} and column_name='tax_details' order by table_name`,
        ).toEqual(TABLES.map((table_name) => ({ table_name, is_nullable: "YES", column_default: null, data_type: "jsonb" })));
        for (const table of TABLES) {
          expect(await sql`select tax_details from ${sql(table)}`).toEqual([{ tax_details: null }]);
        }
        expect(await sql`select exemption_reason from invoices where id=${ids.invoice}`).toEqual([{ exemption_reason: LEGACY_REASON }]);
        expect(await sql`select encode(pdf,'hex') as pdf,xml,pdf_sha256,xml_sha256 from invoices where id=${ids.invoice}`).toEqual([
          { pdf: PDF.toString("hex"), xml: XML, pdf_sha256: PDF_HASH, xml_sha256: XML_HASH },
        ]);
        expect(
          await sql`select table_name,columns -> table_name ? 'tax_details' as has_details,
        digest=haben_seal_digest(table_name,row_id,columns) as valid from seals
        where table_name in ('allocations','cash_entries','invoices') order by table_name`,
        ).toEqual([
          { table_name: "allocations", has_details: false, valid: true },
          { table_name: "cash_entries", has_details: false, valid: true },
          { table_name: "invoices", has_details: false, valid: true },
        ]);
        await expectLocked(sql, ids);
        expect(await snapshot(sql, ids, auditSeq)).toEqual(old);
        expect(await sql`select to_jsonb(c)::text as bytes from audit_chain c`).toEqual(oldHead);
        expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);

        const invoiceId = await sql.begin(async (tx) => {
          await tx`select set_config('haben.actor','upgrade:neuer-beleg',true)`;
          const [invoice] = await tx`insert into invoices(issue_date,due_date,tax_treatment,exemption_reason,tax_details,net,tax,gross,pdf,pdf_sha256)
          values('2026-10-02','2026-10-16','steuerfrei',${LEGACY_REASON},${JSON.stringify(TAX_DETAILS)}::jsonb,10000,0,10000,${PDF},${PDF_HASH}) returning id`;
          await tx`insert into invoice_lines(invoice_id,position,description,quantity,unit,unit_price,tax_rate,net)
          values(${invoice!.id},1,'Neue Heilbehandlung',1000,'Psch.',10000,0,10000)`;
          await tx`insert into invoice_taxes(invoice_id,rate,base,tax) values(${invoice!.id},0,10000,0)`;
          await tx`update invoices set status='final',number='2026-002',locked_at=now() where id=${invoice!.id}`;
          return invoice!.id as string;
        });
        expect(await sql`select tax_details from invoices where id=${invoiceId}`).toEqual([{ tax_details: TAX_DETAILS }]);
        expect(
          await sql`select genesis,columns -> 'invoices' ? 'tax_details' as has_details,
        digest=haben_seal_digest(table_name,row_id,columns) as valid,
        digest<>haben_seal_digest(table_name,row_id,jsonb_set(columns,'{invoices}',(columns->'invoices')-'tax_details')) as details_hashed
        from seals where table_name='invoices' and row_id=${invoiceId}`,
        ).toEqual([{ genesis: false, has_details: true, valid: true, details_hashed: true }]);
        expect(
          await sql`select actor,new_value -> 'tax_details' as details from audit_log
        where table_name='invoices' and row_id=${invoiceId} and action='UPDATE'`,
        ).toEqual([{ actor: "upgrade:neuer-beleg", details: TAX_DETAILS }]);
        const newOriginal = await sql`select to_jsonb(i)::text as bytes from invoices i where id=${invoiceId}`;
        await expect(sql`update invoices set tax_details=null where id=${invoiceId}`).rejects.toThrow(/festgeschrieben/);
        await expect(sql`delete from invoices where id=${invoiceId}`).rejects.toThrow(/festgeschrieben/);
        expect(await sql`select to_jsonb(i)::text as bytes from invoices i where id=${invoiceId}`).toEqual(newOriginal);
        expect(await snapshot(sql, ids, auditSeq)).toEqual(old);
        expect(await sql`select seq>${auditSeq} as advanced from audit_chain`).toEqual([{ advanced: true }]);
        expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
      } finally {
        await sql.end();
        rmSync(previous, { recursive: true });
      }
    },
    120_000,
  );
});
