import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";

/** Versiegelte Tabellen (docs/architektur.md, Manipulationserkennung; `haben_seal_columns` ab 0138) */
const versiegelt = [
  "journal_entries",
  "journal_lines",
  "invoices",
  "invoice_lines",
  "invoice_taxes",
  "documents",
  "document_amounts",
  "document_splits",
  "vat_returns",
  "cash_entries",
  "allocations",
  "pauschalen",
  "asset_depreciations",
  "document_cancellations",
  "invoice_attachments",
  "vat_return_filings",
  "payslips",
  "payslip_cancellations",
];

describe.skipIf(!testDatabaseUrl)("TRUNCATE auf festgeschriebenen und nur anhängbaren Tabellen (Postgres)", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  /**
   * Tabellen, deren Zeilen ein BEFORE-DELETE-Trigger schützt (nur anhängen, gesperrt ab Festschreibung, nicht löschbar),
   * und die versiegelten. Zeilen-Trigger feuern bei TRUNCATE nicht; dafür braucht jede einen eigenen Statement-Trigger.
   * tgtype: 1 = je Zeile, 2 = BEFORE, 8 = DELETE, 32 = TRUNCATE
   */
  async function geschuetzteTabellen(): Promise<string[]> {
    const rows = await sql<{ name: string }[]>`select distinct c.relname as name from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and t.tgtype & 3 = 3 and t.tgtype & 8 = 8`;
    return [...new Set([...versiegelt, ...rows.map((r) => r.name)])].sort();
  }

  async function mitTruncateSchutz(): Promise<Set<string>> {
    const rows = await sql<{ name: string }[]>`select distinct c.relname as name from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and t.tgtype & 3 = 2 and t.tgtype & 32 = 32 and t.tgenabled <> 'D'`;
    return new Set(rows.map((r) => r.name));
  }

  it("jede versiegelte und jede gegen DELETE geschützte Tabelle hat einen Trigger vor TRUNCATE", async () => {
    const tabellen = await geschuetzteTabellen();
    // Plausibel: der Katalog liefert die Tabellen wirklich (journal_entries über haben_reject_locked, audit_log ohne Zeilen-Trigger)
    expect(tabellen).toEqual(expect.arrayContaining(["journal_entries", "bank_transactions", "contacts", "seals", "user_logins"]));
    const geschuetzt = await mitTruncateSchutz();
    expect(tabellen.filter((t) => !geschuetzt.has(t))).toEqual([]);
  });

  it("jede dieser Tabellen lehnt TRUNCATE und TRUNCATE … CASCADE ab, auch wenn sie leer ist", async () => {
    // external_imports hat seit 0198 einen eigenen Trigger, der eine leere Tabelle leeren lässt (external-import.test.ts)
    const tabellen = (await geschuetzteTabellen()).filter((t) => t !== "external_imports");
    const durchgelassen: string[] = [];
    await sql.begin(async (tx) => {
      for (const t of tabellen) {
        for (const cascade of [false, true]) {
          const statement = `truncate "${t}"${cascade ? " cascade" : ""}`;
          // Ohne CASCADE lehnt Postgres eine Tabelle, auf die ein Fremdschlüssel zeigt, schon vor den Triggern ab
          const abgelehnt = cascade
            ? /darf nicht geleert werden|darf nur ergänzt werden/
            : /darf nicht geleert werden|darf nur ergänzt werden|referenced in a foreign key constraint/;
          const ok = await tx
            .savepoint((sp) => sp.unsafe(statement))
            .then(() => true)
            .catch((e: Error) => {
              if (!abgelehnt.test(e.message)) throw e;
              return false;
            });
          if (ok) durchgelassen.push(`${t}${cascade ? " cascade" : ""}`);
        }
      }
    });
    expect(durchgelassen).toEqual([]);
  });

  it("festgeschriebene Buchung: weder ihre Zeilen noch die Buchungen samt abhängigen Tabellen lassen sich leeren", async () => {
    const [company] = await sql`insert into company (id, name, kontenrahmen) values (1, 'Testbetrieb', 'SKR04') returning kontenrahmen`;
    const entry = await sql.begin(async (tx) => {
      const [e] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values ('2026-01-10', 'Test', 'invoice', gen_random_uuid(), ${company!.kontenrahmen}) returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, '1200', 100, 0), (${e!.id}, '4400', 0, 100)`;
      await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
      return e!.id as string;
    });
    const [vorher] = await sql`select count(*)::int as n from audit_log`;

    await expect(sql`truncate journal_lines`).rejects.toThrow(/journal_lines darf nicht geleert werden/);
    await expect(sql`truncate journal_entries cascade`).rejects.toThrow(/darf nicht geleert werden/);
    await expect(sql`truncate journal_entries, journal_lines restart identity cascade`).rejects.toThrow(/darf nicht geleert werden/);

    const [zeilen] = await sql`select count(*)::int as n from journal_lines where entry_id = ${entry}`;
    expect(zeilen!.n).toBe(2);
    const [nachher] = await sql`select count(*)::int as n from audit_log`;
    expect(nachher!.n).toBe(vorher!.n);
    const [problems] = await sql`select count(*)::int as n from haben_integrity_problems()`;
    expect(problems!.n).toBe(0);
  });
});
