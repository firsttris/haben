import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Sperren und Eindeutigkeit in der Datenbank (Postgres)", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate journal_lines, journal_entries, document_amounts, documents, invoices, invoice_number_counters, "user" cascade`;
  });

  async function entry(locked: boolean) {
    const [e] = await sql`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
      values ('2026-01-10', 'Test', 'invoice', gen_random_uuid(), 'SKR03') returning id`;
    await sql`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, '1400', 100, 0), (${e!.id}, '8400', 0, 100)`;
    if (locked) await sql`update journal_entries set locked_at = now() where id = ${e!.id}`;
    return e!.id as string;
  }

  it("Buchungszeilen lassen sich weder aus einer festgeschriebenen Buchung heraus- noch in sie hineinziehen", async () => {
    const locked = await entry(true);
    const open = await entry(false);
    await expect(sql`update journal_lines set entry_id = ${open} where entry_id = ${locked}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`update journal_lines set entry_id = ${locked} where entry_id = ${open}`).rejects.toThrow(/festgeschrieben/);
    const [n] = await sql`select count(*)::int as n from journal_lines where entry_id = ${locked}`;
    expect(n!.n).toBe(2);
  });

  it("eine Buchung wird erst nach ihren Zeilen festgeschrieben, nicht schon beim Einfügen", async () => {
    await expect(
      sql`insert into journal_entries (date, description, source_type, source_id, kontenrahmen, locked_at)
        values ('2026-01-10', 'Test', 'invoice', gen_random_uuid(), 'SKR03', now())`,
    ).rejects.toThrow(/erst nach ihren Zeilen/);
  });

  it("Beträge eines gebuchten Belegs lassen sich nicht umhängen", async () => {
    const [booked] = await sql`insert into documents (sha256, filename, mime_type, size) values ('a', 'a.pdf', 'application/pdf', 1) returning id`;
    const [other] = await sql`insert into documents (sha256, filename, mime_type, size) values ('b', 'b.pdf', 'application/pdf', 1) returning id`;
    await sql`insert into document_amounts (document_id, tax_rate, net, tax) values (${booked!.id}, 1900, 100, 19)`;
    await sql`update documents set locked_at = now() where id = ${booked!.id}`;
    await expect(sql`update document_amounts set document_id = ${other!.id} where document_id = ${booked!.id}`).rejects.toThrow(/gebucht/);
  });

  it("Audit-Log ohne ELSTER-XML, Zeilenkennung auch bei Tabellen mit dem Jahr als Schlüssel", async () => {
    await sql`insert into invoice_number_counters (year, last) values (2026, 1)`;
    const [counter] = await sql`select row_id from audit_log where table_name = 'invoice_number_counters' order by id desc limit 1`;
    expect(counter!.row_id).toBe("2026");

    await sql`insert into brm_requests (art, test, ok, code, message, request_xml, response_xml, server_response_xml)
      values ('liste', true, true, 0, 'ok', '<a/>', '<b/>', '<c/>')`;
    const [brm] = await sql`select new_value from audit_log where table_name = 'brm_requests' order by id desc limit 1`;
    expect(brm!.new_value).toMatchObject({ art: "liste" });
    expect(brm!.new_value).not.toHaveProperty("request_xml");
    expect(brm!.new_value).not.toHaveProperty("response_xml");
    expect(brm!.new_value).not.toHaveProperty("server_response_xml");
  });

  it("höchstens ein Nutzer und ein festgeschriebenes Storno je Rechnung", async () => {
    await sql`insert into "user" (id, name, email) values ('u1', 'A', 'a@example.de')`;
    await expect(sql`insert into "user" (id, name, email) values ('u2', 'B', 'b@example.de')`).rejects.toThrow(/user_single/);

    const [original] = await sql`insert into invoices (status, number, issue_date, due_date, locked_at)
      values ('final', 'RE-1', '2026-01-10', '2026-01-24', now()) returning id`;
    await sql`insert into invoices (kind, status, number, issue_date, due_date, corrects_id, locked_at)
      values ('storno', 'final', 'RE-2', '2026-01-11', '2026-01-11', ${original!.id}, now())`;
    await expect(
      sql`insert into invoices (kind, status, number, issue_date, due_date, corrects_id, locked_at)
        values ('storno', 'final', 'RE-3', '2026-01-11', '2026-01-11', ${original!.id}, now())`,
    ).rejects.toThrow(/invoices_one_storno/);
  });
});
