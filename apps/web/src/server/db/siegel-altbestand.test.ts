import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

const ID = {
  kontakt: "00000000-0000-4000-8000-0000000000c1",
  konto: "00000000-0000-4000-8000-0000000000b1",
  abruf: "00000000-0000-4000-8000-0000000000b2",
  umsatz: "00000000-0000-4000-8000-0000000000b3",
  buchung: "00000000-0000-4000-8000-0000000000e1",
  rechnung: "00000000-0000-4000-8000-0000000000a1",
  beleg: "00000000-0000-4000-8000-0000000000d1",
  voranmeldung: "00000000-0000-4000-8000-0000000000f1",
  kasse: "00000000-0000-4000-8000-000000000071",
  zuordnung: "00000000-0000-4000-8000-000000000081",
  rechnung2: "00000000-0000-4000-8000-0000000002a1",
  beleg2: "00000000-0000-4000-8000-0000000002d1",
  pauschale: "00000000-0000-4000-8000-000000000291",
  anlage: "00000000-0000-4000-8000-000000000292",
  afa: "00000000-0000-4000-8000-000000000293",
  belegstorno: "00000000-0000-4000-8000-000000000294",
};

/*
 * Siegel aus älteren Schemaständen (#1574): Ein Siegel prüft nur die Spalten und Kindtabellen, die es beim
 * Festschreiben gab. Der erste Bestand ist auf dem Stand von Migration 0064 versiegelt, also vor jeder Spalte, die eine
 * versiegelte Tabelle später bekam, und vor den Anhängen (0125), der Aufteilung (0129) und dem Abgabevermerk (0138).
 * Der zweite ist auf dem Stand von 0190 versiegelt, wie auf einer Instanz, die über mehrere Versionen gebucht hat:
 * Seine Siegel decken Spalten ab, die denen von 0064 fehlen. Nach dem Update darf die Prüfung an beiden nichts melden;
 * was an den Triggern vorbei in eine nicht abgedeckte Spalte oder Kindtabelle geschrieben wird, muss sie melden.
 */
describe.skipIf(!testDatabaseUrl)("Siegel aus älteren Schemaständen (Postgres)", () => {
  let sql: postgres.Sql;

  /**
   * Stand 0190: Rechnung mit Einleitung (0085) und Anhang, Beleg mit Aufteilung, dazu je eine Zeile der Tabellen, die
   * bisher keine späteren Spalten haben, damit eine künftige Spalte dort am Altbestand auffällt.
   */
  async function zwischenbestand() {
    await sql`insert into invoices (id, contact_id, issue_date, due_date, net, tax, gross, intro)
      values (${ID.rechnung2}, ${ID.kontakt}, '2026-02-01', '2026-02-15', 10000, 1900, 11900, 'Guten Tag')`;
    await sql`insert into invoice_lines (invoice_id, position, description, quantity, unit, unit_price, tax_rate, net)
      values (${ID.rechnung2}, 1, 'Beratung', 1000, 'C62', 10000, 1900, 10000)`;
    await sql`insert into invoice_taxes (invoice_id, rate, base, tax) values (${ID.rechnung2}, 1900, 10000, 1900)`;
    await sql`insert into invoice_attachments (invoice_id, filename, mime_type, sha256, size)
      values (${ID.rechnung2}, 'anhang.pdf', 'application/pdf', ${"f".repeat(64)}, 10)`;
    await sql`update invoices set status = 'final', number = 'RE-2026-0001', number_year = 2026, number_counter = 1, locked_at = now()
      where id = ${ID.rechnung2}`;
    await sql`insert into documents (id, sha256, filename, mime_type, size, supplier_name, document_date, net, tax, gross)
      values (${ID.beleg2}, ${"9".repeat(64)}, 'beleg2.pdf', 'application/pdf', 1234, 'Lieferant C', '2026-02-05', 5000, 950, 5950)`;
    await sql`insert into document_amounts (document_id, tax_rate, net, tax) values (${ID.beleg2}, 1900, 5000, 950)`;
    await sql`insert into document_splits (document_id, position, category, tax_rate, net, tax) values (${ID.beleg2}, 1, 'buero', 1900, 5000, 950)`;
    await sql`update documents set status = 'gebucht', locked_at = now() where id = ${ID.beleg2}`;
    await sql`insert into pauschalen (id, art, date, description, details, amount, journal_entry_id)
      values (${ID.pauschale}, 'fahrt', '2026-02-03', 'Fahrt zum Kunden', '{"km": 20}'::jsonb, 600, ${ID.buchung})`;
    await sql`insert into assets (id, name, kind, method, account, acquisition_date, cost)
      values (${ID.anlage}, 'Rechner', 'beweglich', 'linear', '0420', '2026-01-10', 120000)`;
    await sql`insert into asset_depreciations (id, asset_id, year, depreciation, entry_id) values (${ID.afa}, ${ID.anlage}, 2026, 40000, ${ID.buchung})`;
    await sql`insert into document_cancellations (id, document_id, date, journal_entry_id)
      values (${ID.belegstorno}, ${ID.beleg2}, '2026-02-10', ${ID.buchung})`;
  }

  /** Je versiegelter Tabelle, die später Spalten bekam, ein Datensatz; festgeschrieben über die Trigger von 0064 */
  async function altbestand() {
    await sql`insert into company (id, name, versteuerung) values (1, 'Testfirma', 'ist')`;
    await sql`insert into contacts (id, name) values (${ID.kontakt}, 'Kunde A')`;
    await sql`insert into bank_accounts (id, name, iban) values (${ID.konto}, 'Giro', 'DE02120300000000202051')`;
    await sql`insert into bank_imports (id, bank_account_id, filename, sha256, format, added, skipped)
      values (${ID.abruf}, ${ID.konto}, 'umsatz.csv', ${"a".repeat(64)}, 'csv', 1, 0)`;
    await sql`insert into bank_transactions (id, bank_account_id, import_id, booking_date, amount, dedup_hash)
      values (${ID.umsatz}, ${ID.konto}, ${ID.abruf}, '2025-03-10', 11900, ${"b".repeat(64)})`;
    await sql.begin(async (tx) => {
      await tx`insert into journal_entries (id, date, description, source_type, source_id, kontenrahmen)
        values (${ID.buchung}, '2025-03-10', 'Zahlung RE-2025-0001', 'manuell', gen_random_uuid(), 'SKR03')`;
      await tx`insert into journal_lines (entry_id, account, debit, credit)
        values (${ID.buchung}, '1200', 11900, 0), (${ID.buchung}, '8400', 0, 10000), (${ID.buchung}, '1776', 0, 1900)`;
      await tx`update journal_entries set locked_at = now() where id = ${ID.buchung}`;
    });
    await sql`insert into invoices (id, contact_id, issue_date, due_date, net, tax, gross)
      values (${ID.rechnung}, ${ID.kontakt}, '2025-03-01', '2025-03-15', 10000, 1900, 11900)`;
    await sql`insert into invoice_lines (invoice_id, position, description, quantity, unit, unit_price, tax_rate, net)
      values (${ID.rechnung}, 1, 'Beratung', 1000, 'C62', 10000, 1900, 10000)`;
    await sql`insert into invoice_taxes (invoice_id, rate, base, tax) values (${ID.rechnung}, 1900, 10000, 1900)`;
    await sql`update invoices set status = 'final', number = 'RE-2025-0001', number_year = 2025, number_counter = 1, locked_at = now()
      where id = ${ID.rechnung}`;
    await sql`insert into documents (id, sha256, filename, mime_type, size, supplier_name, document_date, net, tax, gross)
      values (${ID.beleg}, ${"c".repeat(64)}, 'beleg.pdf', 'application/pdf', 1234, 'Lieferant B', '2025-03-05', 5000, 950, 5950)`;
    await sql`insert into document_amounts (document_id, tax_rate, net, tax) values (${ID.beleg}, 1900, 5000, 950)`;
    await sql`update documents set status = 'gebucht', locked_at = now() where id = ${ID.beleg}`;
    await sql`insert into vat_returns (id, year, month, kz81, kz66, kz83) values (${ID.voranmeldung}, 2025, 3, 10000, 950, 950)`;
    await sql`update vat_returns set status = 'sent', transfer_ticket = 'et1234567890', sent_at = now(), locked_at = now()
      where id = ${ID.voranmeldung}`;
    await sql`insert into cash_entries (id, number, date, amount, kind, text) values (${ID.kasse}, 1, '2025-03-02', 2000, 'einlage', 'Einlage')`;
    await sql`insert into allocations (id, transaction_id, kind, invoice_id, amount)
      values (${ID.zuordnung}, ${ID.umsatz}, 'invoice', ${ID.rechnung}, 11900)`;
  }

  beforeAll(async () => {
    const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await admin`drop database if exists ${admin(name)} with (force)`;
    await admin`create database ${admin(name)}`;
    await admin.end();
    const full = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
    /** Ordner mit den Migrationen vor `tag` */
    const vor = (tag: string) => {
      const ordner = mkdtempSync(join(tmpdir(), "haben-migrationen-"));
      cpSync(MIGRATIONS, ordner, { recursive: true });
      const idx = full.entries.findIndex((e: { tag: string }) => e.tag === tag);
      writeFileSync(join(ordner, "meta", "_journal.json"), JSON.stringify({ ...full, entries: full.entries.slice(0, idx) }));
      return ordner;
    };
    sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: vor("0065_hauptbuch_sperren") });
    await altbestand();
    await migrate(drizzle(sql), { migrationsFolder: vor("0191_journal_basis") });
    await zwischenbestand();
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
  }, 180_000);

  afterAll(async () => {
    await sql?.end();
  });

  type Befund = { art: string; tabelle: string; zeile: string | null; befund: string };
  const befunde = (tx: postgres.Sql | postgres.TransactionSql = sql) => tx<Befund[]>`select art, tabelle, zeile, befund from haben_integrity_problems()`;

  /** Wie ein Betreiber mit vollem Zugriff: Trigger abgeschaltet. Die Transaktion wird danach zurückgerollt. */
  async function vorbeiAnDenTriggern(work: (tx: postgres.TransactionSql) => Promise<unknown>): Promise<Befund[]> {
    let result: Befund[] = [];
    const rollback = new Error("rollback");
    await sql
      .begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await work(tx);
        await tx`set local session_replication_role = origin`;
        result = await befunde(tx);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
    return result;
  }

  it("meldet am Bestand aus beiden Ständen nach dem Update nichts", async () => {
    const siegel = await sql<{ table_name: string; row_id: string; columns: Record<string, string[]> }[]>`
      select table_name, row_id, columns from seals order by id`;
    expect(siegel.map((s) => s.table_name)).toEqual([
      ...["journal_entries", "invoices", "documents", "vat_returns", "cash_entries", "allocations"],
      ...["invoices", "documents", "pauschalen", "asset_depreciations", "document_cancellations"],
    ]);
    const spalten = (id: string) => siegel.find((s) => s.row_id === id)!.columns;
    // Die Voraussetzung des Tests: Die Siegel von 0064 kennen weder basis noch die später versiegelten Kindtabellen
    expect(spalten(ID.buchung).journal_lines).not.toContain("basis");
    expect(Object.keys(spalten(ID.rechnung))).not.toContain("invoice_attachments");
    expect(Object.keys(spalten(ID.beleg))).not.toContain("document_splits");
    expect(Object.keys(spalten(ID.voranmeldung))).not.toContain("vat_return_filings");
    // Die Siegel von 0190 decken ab, was denen von 0064 fehlt: Einleitung und Anhang der zweiten Rechnung sind gesetzt
    // und trotzdem kein Befund
    expect(spalten(ID.rechnung).invoices).not.toContain("intro");
    expect(spalten(ID.rechnung2).invoices).toContain("intro");
    expect(Object.keys(spalten(ID.rechnung2))).toContain("invoice_attachments");
    expect(spalten(ID.beleg2).document_splits).not.toContain("own_account_id");
    expect(await befunde()).toEqual([]);
    // #1580: Auch die Standardwerte stimmen nach dem Update vom ältesten Stand mit dem Sollbestand überein
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { checkTriggerIntegrity } = await import("./trigger-inventory.ts");
    expect(await checkTriggerIntegrity(drizzle(sql))).toEqual({ problems: [], hints: [] });
  });

  // #1580: Den Standardwert liest die Prüfung der Siegel aus dem Katalog. Wer ihn nachzieht und die alte Zeile auf
  // denselben Wert setzt, fällt ihr nicht auf, dem Sollbestand der Standardwerte schon. Dasselbe gilt für eine Spalte,
  // die durch eine erzeugte Spalte mit festem Wert ersetzt wird: Auch deren Ausdruck steht in pg_attrdef.
  it.each([
    [
      "der Standardwert von vat_returns.kz41 nachgezogen ist",
      "vat_returns",
      "Standardwert von vat_returns.kz41 wurde verändert",
      ["alter table vat_returns alter column kz41 set default 500000", `update vat_returns set kz41 = 500000 where id = '${ID.voranmeldung}'`],
    ],
    [
      "journal_lines.basis durch eine erzeugte Spalte mit festem Wert ersetzt ist",
      "journal_lines",
      "Zusätzlicher Standardwert von journal_lines.basis",
      ["alter table journal_lines drop column basis, add column basis integer generated always as (99999) stored"],
    ],
  ])("meldet über den Sollbestand, wenn %s", async (_fall, tabelle, befund, statements) => {
    const { sql: query } = await import("drizzle-orm");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { checkTriggerIntegrity } = await import("./trigger-inventory.ts");
    const rollback = new Error("rollback");
    let siegel: unknown[] | undefined;
    let sperren: unknown[] | undefined;
    await drizzle(sql)
      .transaction(async (tx) => {
        await tx.execute(query`set local session_replication_role = replica`);
        for (const statement of statements) await tx.execute(query.raw(statement));
        await tx.execute(query`set local session_replication_role = origin`);
        siegel = [...(await tx.execute(query`select art, tabelle, zeile, befund from haben_integrity_problems()`))];
        sperren = (await checkTriggerIntegrity(tx)).problems;
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
    expect(siegel).toEqual([]);
    expect(sperren).toEqual([{ art: "sperre", tabelle, zeile: null, seq: null, befund }]);
  });

  it("bricht ab, wenn ein Siegel eine Kindtabelle nennt, die die Prüfung nicht kennt", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`create or replace function haben_seal_columns(tbl text) returns jsonb language sql stable as
          $$ select jsonb_build_object(tbl, haben_columns(tbl::regclass), 'neue_kindtabelle', '[]'::jsonb) $$`;
        await befunde(tx);
      }),
    ).rejects.toThrow(/Integritätsprüfung kennt neue_kindtabelle im Siegel von journal_entries nicht/);
    expect(await befunde()).toEqual([]);
  });

  it.each([
    // #1574: basis fließt in die Voranmeldung ein
    [
      "journal_lines.basis",
      "journal_entries",
      ID.buchung,
      (tx: postgres.TransactionSql) => tx`update journal_lines set basis = 99999 where entry_id = ${ID.buchung} and account = '8400'`,
    ],
    // Standardwert 0 bzw. 'EUR': Alte Zeilen tragen ihn, eine Abweichung davon fällt auf
    [
      "vat_returns.kz41",
      "vat_returns",
      ID.voranmeldung,
      (tx: postgres.TransactionSql) => tx`update vat_returns set kz41 = 500000 where id = ${ID.voranmeldung}`,
    ],
    ["invoices.currency", "invoices", ID.rechnung, (tx: postgres.TransactionSql) => tx`update invoices set currency = 'USD' where id = ${ID.rechnung}`],
    [
      "invoice_lines.discount_amount",
      "invoices",
      ID.rechnung,
      (tx: postgres.TransactionSql) => tx`update invoice_lines set discount_amount = 5000 where invoice_id = ${ID.rechnung}`,
    ],
    [
      "invoice_taxes.original_base",
      "invoices",
      ID.rechnung,
      (tx: postgres.TransactionSql) => tx`update invoice_taxes set original_base = 777 where invoice_id = ${ID.rechnung}`,
    ],
    // 0 ist nicht leer: kein Vorsteuerabzug statt der bisherigen Regel
    [
      "documents.vorsteuer_anteil",
      "documents",
      ID.beleg,
      (tx: postgres.TransactionSql) => tx`update documents set vorsteuer_anteil = 0 where id = ${ID.beleg}`,
    ],
    [
      "document_amounts.vorsteuer_anteil",
      "documents",
      ID.beleg,
      (tx: postgres.TransactionSql) => tx`update document_amounts set vorsteuer_anteil = 5000 where document_id = ${ID.beleg}`,
    ],
    [
      "allocations.tax_shares",
      "allocations",
      ID.zuordnung,
      (tx: postgres.TransactionSql) => tx`update allocations set tax_shares = '[{"rate": 700, "gross": 11900}]'::jsonb where id = ${ID.zuordnung}`,
    ],
    [
      "cash_entries.tax_shares",
      "cash_entries",
      ID.kasse,
      (tx: postgres.TransactionSql) => tx`update cash_entries set tax_shares = '[{"rate": 700, "gross": 2000}]'::jsonb where id = ${ID.kasse}`,
    ],
    // Siegel von 0190: nur was nach 0190 dazukam, ist nicht abgedeckt
    [
      "invoices.intro_vorlage",
      "invoices",
      ID.rechnung2,
      (tx: postgres.TransactionSql) => tx`update invoices set intro_vorlage = 'Vorlage' where id = ${ID.rechnung2}`,
    ],
    [
      "document_splits.own_account_id",
      "documents",
      ID.beleg2,
      (tx: postgres.TransactionSql) => tx`update document_splits set own_account_id = gen_random_uuid() where document_id = ${ID.beleg2}`,
    ],
  ])("meldet %s, an den Triggern vorbei geändert", async (spalte, tabelle, zeile, aendern) => {
    expect(await vorbeiAnDenTriggern(aendern)).toEqual([{ art: "siegel", tabelle, zeile, befund: `Spalte ${spalte} geändert, die das Siegel nicht abdeckt` }]);
  });

  it.each([
    [
      "invoice_attachments",
      "invoices",
      ID.rechnung,
      (tx: postgres.TransactionSql) => tx`insert into invoice_attachments (invoice_id, filename, mime_type, sha256, size)
        values (${ID.rechnung}, 'x.pdf', 'application/pdf', ${"d".repeat(64)}, 10)`,
    ],
    [
      "document_splits",
      "documents",
      ID.beleg,
      (tx: postgres.TransactionSql) => tx`insert into document_splits (document_id, position, category, tax_rate, net, tax)
        values (${ID.beleg}, 1, 'buero', 1900, 5000, 950)`,
    ],
    [
      "vat_return_filings",
      "vat_returns",
      ID.voranmeldung,
      (tx: postgres.TransactionSql) => tx`insert into vat_return_filings (vat_return_id, filed_on, transfer_ticket, kz83, filename, sha256, size)
        values (${ID.voranmeldung}, '2025-04-10', 'et1234567890', 950, 'p.pdf', ${"e".repeat(64)}, 10)`,
    ],
  ])("meldet eine Zeile in %s, an den Triggern vorbei eingefügt", async (kindtabelle, tabelle, zeile, einfuegen) => {
    expect(await vorbeiAnDenTriggern(einfuegen)).toEqual([
      { art: "siegel", tabelle, zeile, befund: `Zeile in ${kindtabelle} eingefügt, die das Siegel nicht abdeckt` },
    ]);
  });

  it("meldet nichts Zusätzliches, wenn das Siegel die Spalte abdeckt", async () => {
    const rollback = new Error("rollback");
    await sql
      .begin(async (tx) => {
        const [e] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
          values (current_date, 'Neue Buchung', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
        await tx`insert into journal_lines (entry_id, account, debit, credit, basis)
          values (${e!.id}, '1200', 11900, 0, null), (${e!.id}, '8400', 0, 10000, null), (${e!.id}, '1776', 0, 1900, 10000)`;
        await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
        // Der Kopf der Kette wird erst beim Commit fortgeschrieben
        await tx`set constraints all immediate`;
        expect(await befunde(tx)).toEqual([]);
        await tx`set local session_replication_role = replica`;
        await tx`update journal_lines set basis = 99999 where entry_id = ${e!.id} and account = '1776'`;
        await tx`set local session_replication_role = origin`;
        expect(await befunde(tx)).toEqual([{ art: "siegel", tabelle: "journal_entries", zeile: e!.id, befund: "Inhalt passt nicht zum Siegel" }]);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
  });
});
