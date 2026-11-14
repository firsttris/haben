import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { datevAccountTotals, parseDatevBuchungsstapel } from "@haben/import";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../../drizzle", import.meta.url));

/**
 * Echter Prä-0223-Bestand wie in db/migrate-advance-balance.test.ts, anschließend normale gemischte Schlusskette.
 * Das neue Papierstorno erhält die Schlussleistung auch dann, wenn einer ihrer Abzüge das alte Bilanzverfahren hat.
 * Entscheidung: https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
 */
describe.skipIf(!testDatabaseUrl)("Übergang einer gemischten Anzahlungs-Schlusskette (Postgres)", () => {
  it("erhält den alten Erlös und die Siegel und nimmt beim neuen Papierstorno auch den alten unbezahlten Leistungsanteil nicht zurück", async () => {
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
    const previous = mkdtempSync(join(tmpdir(), "haben-mixed-advance-transition-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8"));
    const addition = (full.entries as { idx: number; tag: string }[]).find((entry) => entry.tag === "0223_anzahlung_bilanz");
    if (!addition) throw new Error("Migration des neuen Anzahlungs-Bilanzverfahrens fehlt.");
    writeFileSync(
      join(previous, "meta/_journal.json"),
      JSON.stringify({ ...full, entries: full.entries.filter((entry: { idx: number }) => entry.idx < addition.idx) }),
    );
    const sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    let closeAppDatabase: (() => Promise<void>) | undefined;
    try {
      const database = drizzle(sql);
      await migrate(database, { migrationsFolder: previous });
      expect(await sql`select column_name from information_schema.columns where table_name='invoices' and column_name='advance_accounting'`).toEqual([]);
      const pdf = Buffer.from("%PDF-1.7\nErfundener alter Anzahlungsbeleg nach #745\n%%EOF");
      const xml = '<?xml version="1.0"?><Anzahlung nummer="2026-001">357.00</Anzahlung>';
      const { oldId, entryId, contactId } = await sql.begin(async (tx) => {
        await tx`select set_config('haben.actor','transition:altbestand',true)`;
        await tx`insert into company(id,name,strasse,plz,ort,email,telefon,steuernummer,bundesland,iban,rechtsform,kontenrahmen,versteuerung,journal_ab,
          datev_berater_nr,datev_mandant_nr)
          values(1,'Muster GmbH','Musterstraße 1','93047','Regensburg','rechnung@example.com','0941 1','198/113/10010','BY',
            'DE89370400440532013000','gmbh','SKR03','soll',2026,'12345','123')`;
        const [contact] = await tx`insert into contacts(name,strasse,plz,ort,land,email)
          values('Musterkunde GmbH','Musterweg 7','12345','Musterstadt','DE','kunde@example.org') returning id`;
        const [old] = await tx`insert into invoices(contact_id,issue_date,due_date,variant,advance_type,net,tax,gross,pdf,pdf_sha256,xml,xml_sha256)
          values(${contact!.id},'2026-12-01','2026-12-15','abschlag','anzahlung',30000,5700,35700,${pdf},
            ${createHash("sha256").update(pdf).digest("hex")},${xml},${createHash("sha256").update(xml).digest("hex")}) returning id`;
        await tx`insert into invoice_lines(invoice_id,position,description,quantity,unit,unit_price,tax_rate,net)
          values(${old!.id},1,'Alte Anforderung mit bereits realisiertem Nettoerlös',1000,'Psch.',30000,1900,30000)`;
        await tx`insert into invoice_taxes(invoice_id,rate,base,tax) values(${old!.id},1900,30000,5700)`;
        const [entry] = await tx`insert into journal_entries(date,description,source_type,source_id,kontenrahmen)
          values('2026-12-01','Alter Erlös vor #750','invoice',${old!.id},'SKR03') returning id`;
        await tx`insert into journal_lines(entry_id,account,debit,credit,tax_code) values
          (${entry!.id},'1400',35700,0,null),(${entry!.id},'8400',0,30000,'USt19'),(${entry!.id},'1766',0,5700,'USt19')`;
        await tx`update journal_entries set locked_at=now() where id=${entry!.id}`;
        await tx`update invoices set status='final',number='2026-001',number_year=2026,number_counter=1,locked_at=now() where id=${old!.id}`;
        await tx`insert into invoice_number_counters(year,last) values(2026,1)`;
        return { oldId: old!.id as string, entryId: entry!.id as string, contactId: contact!.id as string };
      });
      const [head] = await sql`select max(seq) as seq from audit_log`;
      const oldState = async () => ({
        invoice: await sql`select (to_jsonb(i)-'advance_accounting'-'replaces_invoice_id'-'service_date')::text as bytes from invoices i where id=${oldId}`,
        invoiceLines: await sql`select to_jsonb(l)::text as bytes from invoice_lines l where invoice_id=${oldId} order by id`,
        invoiceTaxes: await sql`select to_jsonb(t)::text as bytes from invoice_taxes t where invoice_id=${oldId} order by rate`,
        entry: await sql`select to_jsonb(e)::text as bytes from journal_entries e where id=${entryId}`,
        lines: await sql`select to_jsonb(l)::text as bytes from journal_lines l where entry_id=${entryId} order by id`,
        seals: await sql`select to_jsonb(s)::text as bytes from seals s where row_id in (${oldId},${entryId}) order by id`,
        audit: await sql`select to_jsonb(a)::text as bytes from audit_log a where seq<=${head!.seq} order by seq`,
      });
      const unchanged = await oldState();
      expect(unchanged.seals).toHaveLength(2);
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
      await migrate(database, { migrationsFolder: MIGRATIONS });
      expect(await oldState()).toEqual(unchanged);
      expect(await sql`select advance_accounting from invoices where id=${oldId}`).toEqual([{ advance_accounting: null }]);

      ({ closeDatabase: closeAppDatabase } = await import("../../db/index.ts"));
      const invoices = await import("./index.ts");
      const bank = await import("../bank/index.ts");
      const reports = await import("../auswertungen/index.ts");
      const vat = await import("../umsatzsteuer/index.ts");
      const actor = "transition:weiterarbeit";
      await bank.createCashInvoiceEntry(actor, { invoiceId: oldId, date: "2026-12-12", amount: 11_900 }, "2027-04-20");
      const fresh = await invoices.finalizeInvoice(
        actor,
        (
          await invoices.createDraft(actor, {
            contactId,
            issueDate: "2026-12-05",
            serviceFrom: null,
            serviceTo: null,
            paymentTermDays: 14,
            format: "zugferd",
            note: "",
            variant: "abschlag",
            advanceType: "anzahlung",
            lines: [{ description: "Neue Anforderung", quantity: 1000, unit: "Psch.", unitPrice: 20_000, taxRate: 1900 }],
          })
        ).id,
      );
      expect(fresh.advanceAccounting).toBe("deferred");
      await bank.createCashInvoiceEntry(actor, { invoiceId: fresh.id, date: "2026-12-15", amount: 23_800 }, "2027-04-20");
      const saldo = async (account: string, year?: number) => {
        const [row] =
          year === undefined
            ? await sql`select coalesce(sum(l.debit-l.credit),0)::int as amount from journal_lines l where l.account=${account}`
            : await sql`select coalesce(sum(l.debit-l.credit),0)::int as amount from journal_lines l join journal_entries e on e.id=l.entry_id
              where l.account=${account} and e.date >= ${`${year}-01-01`} and e.date < ${`${year + 1}-01-01`}`;
        return row!.amount;
      };
      expect(await saldo("8400", 2026)).toBe(-30_000);
      expect(await saldo("1710")).toBe(-20_000);
      expect(await saldo("1400")).toBe(23_800);

      const finalInvoice = async (issueDate: string) =>
        invoices.finalizeInvoice(
          actor,
          (
            await invoices.createDraft(actor, {
              contactId,
              issueDate,
              serviceFrom: "2027-01-20",
              serviceTo: null,
              paymentTermDays: 14,
              format: "zugferd",
              note: "",
              variant: "schluss",
              deducts: [oldId, fresh.id],
              lines: [{ description: "Gesamtleistung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
            })
          ).id,
        );
      const final = await finalInvoice("2027-01-20");
      expect(final).toMatchObject({ advanceAccounting: "deferred", net: 50_000, tax: 9_500, gross: 59_500 });
      await invoices.cancelInvoice(actor, final.id, "2027-02-12");
      // Den tatsächlichen Papierzwischenraum vor dem Ersatz prüfen: Ein später gespeicherter Ersatz trägt wieder
      // das Januar-Leistungsdatum und darf einen zwischenzeitlich falschen Februarstand nicht rückblickend verdecken.
      // Leistungsfortbestand: https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
      expect(await reports.openPositions("2027-02-28")).toMatchObject({
        receivables: [{ id: oldId, open: 23_800 }],
        unbilledReceivables: [{ id: final.id, open: 59_500 }],
        receivablesTotal: 83_300,
      });
      const between = await Promise.all([1, 2].map((month) => vat.computeVatFigures({ year: 2027, month })));
      expect(between.map(({ kz81, tax81 }) => ({ base: kz81, tax: tax81 }))).toEqual([
        { base: 70_000, tax: 13_300 },
        { base: 0, tax: 0 },
      ]);
      const replacement = await finalInvoice("2027-03-12");
      expect(replacement).toMatchObject({ replacesInvoiceId: final.id, gross: 59_500 });
      expect(await saldo("8400", 2026)).toBe(-30_000);
      expect(await saldo("8400", 2027)).toBe(-70_000);
      expect(await saldo("1710", 2027)).toBe(20_000);
      expect(await saldo("1710")).toBe(0);
      expect(await saldo("1400")).toBe(83_300);
      expect(await reports.openPositions("2027-02-28")).toMatchObject({
        receivables: [{ id: oldId, open: 23_800 }],
        unbilledReceivables: [{ id: final.id, open: 59_500 }],
        receivablesTotal: 83_300,
      });
      expect(await reports.openPositions("2027-03-31")).toMatchObject({
        receivables: [
          { id: oldId, open: 23_800 },
          { id: replacement.id, open: 59_500 },
        ],
        unbilledReceivables: [],
        receivablesTotal: 83_300,
      });
      const exported = [];
      for (const year of [2026, 2027]) {
        const totals = datevAccountTotals(parseDatevBuchungsstapel((await reports.datevExport(year)).bytes).bookings);
        const amount = (account: string) => {
          const row = totals.find((r) => r.account === account);
          return (row?.debit ?? 0) - (row?.credit ?? 0);
        };
        exported.push({ year, receivables: amount("1400"), revenue: amount("8400"), advances: amount("1710") });
      }
      expect(exported).toEqual([
        { year: 2026, receivables: 23_800, revenue: -30_000, advances: -20_000 },
        { year: 2027, receivables: 59_500, revenue: -70_000, advances: 20_000 },
      ]);
      expect(await oldState()).toEqual(unchanged);
      expect(await sql`select count(*)::int as count from cash_entries`).toEqual([{ count: 2 }]);
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
      // Ein Papieraustausch der neuen gemischten Schlusskette nimmt auch die bereits erbrachte alte Teilforderung
      // nicht zurück: Die unbezahlten 200 € netto/38 € USt bleiben im Januar, ohne Februar-Minderung/März-Neuerfassung.
      // Bestätigter Leistungsfortbestand: https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
      const figures = await Promise.all([1, 2, 3].map((month) => vat.computeVatFigures({ year: 2027, month })));
      expect(figures.map(({ kz81, tax81 }) => ({ base: kz81, tax: tax81 }))).toEqual([
        { base: 70_000, tax: 13_300 },
        { base: 0, tax: 0 },
        { base: 0, tax: 0 },
      ]);
    } finally {
      await closeAppDatabase?.();
      await sql.end();
      rmSync(previous, { recursive: true });
    }
  }, 120_000);
});
