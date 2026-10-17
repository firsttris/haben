import postgres from "postgres";
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

  /** Buchung mit zwei Zeilen; ohne Festschreiben nur innerhalb einer Transaktion möglich (0065) */
  async function entry(q: postgres.Sql | postgres.TransactionSql, locked: boolean, kontenrahmen = "SKR03", date = "2026-01-10") {
    const [e] = await q`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
      values (${date}, 'Test', 'invoice', gen_random_uuid(), ${kontenrahmen}) returning id`;
    await q`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, '1400', 100, 0), (${e!.id}, '8400', 0, 100)`;
    if (locked) await q`update journal_entries set locked_at = now() where id = ${e!.id}`;
    return e!.id as string;
  }

  const lockedEntry = (kontenrahmen = "SKR03", date = "2026-01-10") => sql.begin((tx) => entry(tx, true, kontenrahmen, date));

  it("Buchungszeilen lassen sich weder aus einer festgeschriebenen Buchung heraus- noch in sie hineinziehen", async () => {
    const locked = await lockedEntry();
    await sql.begin(async (tx) => {
      const open = await entry(tx, false);
      await expect(tx.savepoint((sp) => sp`update journal_lines set entry_id = ${open} where entry_id = ${locked}`)).rejects.toThrow(/festgeschrieben/);
      await expect(tx.savepoint((sp) => sp`update journal_lines set entry_id = ${locked} where entry_id = ${open}`)).rejects.toThrow(/festgeschrieben/);
      await tx`update journal_entries set locked_at = now() where id = ${open}`;
    });
    const [n] = await sql`select count(*)::int as n from journal_lines where entry_id = ${locked}`;
    expect(n!.n).toBe(2);
  });

  describe("Hauptbuch (0065)", () => {
    beforeEach(async () => {
      await sql`truncate company cascade`;
    });

    it("eine Buchung, die bis zum Commit nicht festgeschrieben ist, wird abgelehnt", async () => {
      await expect(sql.begin((tx) => entry(tx, false))).rejects.toThrow(/nicht festgeschrieben/);
      // Auch nicht als einzelne Anweisungen ohne Transaktion
      await expect(
        sql`insert into journal_entries (date, description, source_type, source_id, kontenrahmen) values ('2026-01-10', 'Test', 'invoice', gen_random_uuid(), 'SKR03')`,
      ).rejects.toThrow(/nicht festgeschrieben/);
      const [n] = await sql`select count(*)::int as n from journal_entries`;
      expect(n!.n).toBe(0);
      // Festgeschrieben oder in derselben Transaktion wieder entfernt: in Ordnung
      await lockedEntry();
      await sql.begin(async (tx) => {
        const open = await entry(tx, false);
        await tx`delete from journal_lines where entry_id = ${open}`;
        await tx`delete from journal_entries where id = ${open}`;
      });
      const [after] = await sql`select count(*)::int as n from journal_entries`;
      expect(after!.n).toBe(1);
    });

    it("eine Buchung trägt den Kontenrahmen der Firmendaten", async () => {
      // Ohne Firmendaten gibt es nichts zu vergleichen
      await lockedEntry("SKR04");
      await sql`insert into company (id, kontenrahmen) values (1, 'SKR03')`;
      await expect(lockedEntry("SKR04")).rejects.toThrow(/Kontenrahmen SKR04, die Firmendaten stehen auf SKR03/);
      await lockedEntry("SKR03");
    });

    it("Kontenrahmen, Versteuerung und § 19 UStG lassen sich nicht ändern, sobald im laufenden Jahr gebucht ist", async () => {
      const year = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()).slice(0, 4));
      await sql`insert into company (id, kontenrahmen, versteuerung, kleinunternehmer) values (1, 'SKR03', 'soll', true)`;
      // Nur Buchungen im Vorjahr: Umstellen zum Jahreswechsel geht
      await lockedEntry("SKR03", `${year - 1}-12-31`);
      await sql`update company set versteuerung = 'ist'`;
      await sql`update company set kleinunternehmer = false`;
      await sql`update company set kleinunternehmer = true`;
      await sql`update company set kontenrahmen = 'SKR04', kleinunternehmer = false`;
      await sql`update company set kontenrahmen = 'SKR03'`;

      await lockedEntry("SKR03", `${year}-01-02`);
      await expect(sql`update company set kontenrahmen = 'SKR04'`).rejects.toThrow(new RegExp(`Im Jahr ${year} gibt es schon Buchungen`));
      await expect(sql`update company set versteuerung = 'soll'`).rejects.toThrow(/schon Buchungen/);
      await expect(sql`update company set kleinunternehmer = true`).rejects.toThrow(/schon Buchungen/);
      // Ausschalten von § 19 und alle anderen Felder bleiben frei
      await sql`update company set name = 'Neu', kleinunternehmer = false`;
      const [row] = await sql`select kontenrahmen, versteuerung, kleinunternehmer, name from company`;
      expect(row).toEqual({ kontenrahmen: "SKR03", versteuerung: "ist", kleinunternehmer: false, name: "Neu" });
    });

    it("eine Änderung der Firmendaten wartet auf eine laufende Buchung und sieht sie danach", async () => {
      const year = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()).slice(0, 4));
      await sql`insert into company (id, kontenrahmen) values (1, 'SKR03')`;
      const other = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
      try {
        let release!: () => void;
        const hold = new Promise<void>((resolve) => (release = resolve));
        let booked!: () => void;
        const started = new Promise<void>((resolve) => (booked = resolve));
        // Buchung hält die Sperre der Kette, bis sie freigegeben wird
        const booking = sql.begin(async (tx) => {
          await entry(tx, true, "SKR03", `${year}-03-01`);
          booked();
          await hold;
        });
        await started;
        const change = other`update company set kontenrahmen = 'SKR04'`.then(
          () => "geändert",
          (error: Error) => error.message,
        );
        // Die Änderung wartet; erst nach dem Commit der Buchung prüft sie und lehnt ab
        await new Promise((resolve) => setTimeout(resolve, 200));
        release();
        await booking;
        expect(await change).toMatch(/schon Buchungen/);
      } finally {
        await other.end();
      }
    });
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
