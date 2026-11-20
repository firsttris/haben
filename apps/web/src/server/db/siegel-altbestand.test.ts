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
};

/*
 * Siegel aus einem älteren Schemastand (#1574): Ein Siegel prüft nur die Spalten und Kindtabellen, die es beim
 * Festschreiben gab. Der Bestand hier ist auf dem Stand von Migration 0064 versiegelt, also vor jeder Spalte, die eine
 * versiegelte Tabelle später bekam, und vor den Anhängen (0125), der Aufteilung (0129) und dem Abgabevermerk (0138).
 * Nach dem Update darf die Prüfung an ihm nichts melden; was an den Triggern vorbei in eine solche Spalte oder
 * Kindtabelle geschrieben wird, muss sie melden.
 */
describe.skipIf(!testDatabaseUrl)("Siegel aus einem älteren Schemastand (Postgres)", () => {
  let sql: postgres.Sql;

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
    const previous = mkdtempSync(join(tmpdir(), "haben-migrationen-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
    const idx = full.entries.findIndex((e: { tag: string }) => e.tag === "0065_hauptbuch_sperren");
    writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...full, entries: full.entries.slice(0, idx) }));
    sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: previous });
    await altbestand();
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

  it("meldet am Altbestand nach dem Update nichts", async () => {
    const siegel = await sql<{ table_name: string; columns: Record<string, string[]> }[]>`select table_name, columns from seals order by id`;
    expect(siegel.map((s) => s.table_name)).toEqual(["journal_entries", "invoices", "documents", "vat_returns", "cash_entries", "allocations"]);
    // Die Voraussetzung des Tests: Die Siegel kennen weder basis noch die später versiegelten Kindtabellen
    expect(siegel[0]!.columns.journal_lines).not.toContain("basis");
    expect(Object.keys(siegel[1]!.columns)).not.toContain("invoice_attachments");
    expect(Object.keys(siegel[2]!.columns)).not.toContain("document_splits");
    expect(Object.keys(siegel[3]!.columns)).not.toContain("vat_return_filings");
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
