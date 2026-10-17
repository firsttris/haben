import nodemailer from "nodemailer";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parsePruefwert } from "../lib/pruefwert.ts";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe("Prüfwert lesen", () => {
  const hash = "0a".repeat(32);

  it("versteht die Form aus Mail, Archiv und Oberfläche", () => {
    expect(parsePruefwert(`Nr. 1234 · ${hash}`)).toEqual({ seq: 1234, hash });
    expect(parsePruefwert(`  Nr. 7 ·\n${hash.toUpperCase()}  `)).toEqual({ seq: 7, hash });
    expect(parsePruefwert(`1234:${hash}`)).toEqual({ seq: 1234, hash });
    expect(parsePruefwert(`Prüfwert 2026, Stand 16.10.2026: Nr. 12 · ${hash}`)).toEqual({ seq: 12, hash });
  });

  it("lehnt Unvollständiges ab", () => {
    expect(parsePruefwert("Nr. 1234")).toBeNull();
    expect(parsePruefwert(`Nr. 1234 · ${hash.slice(1)}`)).toBeNull();
    expect(parsePruefwert(`Nr. 1234 · ${hash}0`)).toBeNull();
    expect(parsePruefwert(hash)).toBeNull();
  });
});

describe.skipIf(!testDatabaseUrl)("Hash-Kette und Siegel (Postgres)", () => {
  let sql: postgres.Sql;
  let integrity: typeof import("./integrity.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    integrity = await import("./integrity.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  const problems = (tx: postgres.Sql | postgres.TransactionSql = sql) =>
    tx<{ art: string; tabelle: string; zeile: string | null; befund: string }[]>`select art, tabelle, zeile, befund from haben_integrity_problems()`;

  /** Führt work in einer Transaktion aus, die danach zurückgerollt wird; liefert ihr Ergebnis */
  async function rolledBack<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    let result: T;
    const rollback = new Error("rollback");
    await sql
      .begin(async (tx) => {
        result = await work(tx);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error;
      });
    return result!;
  }

  /** Wie ein Betreiber mit vollem Zugriff: Trigger abgeschaltet */
  async function tamper(tx: postgres.TransactionSql, work: () => Promise<unknown>) {
    await tx`set local session_replication_role = replica`;
    await work();
    await tx`set local session_replication_role = origin`;
  }

  /** Buchung wie über das Hauptbuch: anlegen, Zeilen, festschreiben, alles in einer Transaktion */
  async function lockedEntry() {
    return sql.begin(async (tx) => {
      const [e] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values ('2026-01-10', 'Test', 'invoice', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, '1400', 11900, 0), (${e!.id}, '8400', 0, 11900)`;
      await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
      return e!.id as string;
    });
  }

  async function lockedInvoice() {
    const [i] = await sql`insert into invoices (issue_date, due_date, net, tax, gross, pdf)
      values ('2026-01-10', '2026-01-24', 10000, 1900, 11900, ${Buffer.from("%PDF-1.7")}) returning id`;
    await sql`insert into invoice_lines (invoice_id, position, description, quantity, unit, unit_price, tax_rate, net)
      values (${i!.id}, 1, 'Beratung', 1000, 'h', 10000, 1900, 10000)`;
    await sql`insert into invoice_taxes (invoice_id, rate, base, tax) values (${i!.id}, 1900, 10000, 1900)`;
    await sql`update invoices set status = 'final', number = ${`2026-${i!.id.slice(0, 6)}`}, locked_at = now() where id = ${i!.id}`;
    return i!.id as string;
  }

  it("verkettet jeden Eintrag lückenlos und hält den Kopf aktuell", async () => {
    await lockedEntry();
    const rows = await sql`select seq, prev_hash, row_hash from audit_log order by seq`;
    expect(rows.length).toBeGreaterThan(3);
    rows.forEach((r, i) => {
      expect(Number(r.seq)).toBe(i + 1);
      if (i > 0) expect(r.prev_hash).toEqual(rows[i - 1]!.row_hash);
    });
    // Erster Eintrag: Hinweis der Migration auf die nachträglich gebildete Kette
    const [first] = await sql`select table_name, actor, prev_hash from audit_log where seq = 1`;
    expect(first).toMatchObject({ table_name: "audit_chain", actor: "system:migration" });
    expect(first!.prev_hash).toEqual(Buffer.alloc(32));
    const head = await integrity.chainHead();
    expect(head).toMatchObject({ seq: rows.length, hash: rows.at(-1)!.row_hash.toString("hex") });
    expect(await problems()).toEqual([]);
  });

  it("versiegelt beim Festschreiben, auch die abhängigen Zeilen", async () => {
    const entry = await lockedEntry();
    const invoice = await lockedInvoice();
    const seals = await sql`select table_name, row_id, genesis, columns from seals where row_id in (${entry}, ${invoice})`;
    expect(seals.map((s) => s.table_name).sort()).toEqual(["invoices", "journal_entries"]);
    expect(seals.every((s) => s.genesis === false)).toBe(true);
    expect(seals.find((s) => s.table_name === "invoices")!.columns).toHaveProperty("invoice_taxes");
    // Das Siegel steht selbst in der Kette
    const [audited] = await sql`select new_value from audit_log where table_name = 'seals' and new_value ->> 'row_id' = ${invoice}`;
    expect(audited!.new_value).toHaveProperty("digest");
    // Siegel und Kopf sind nicht direkt änderbar
    await expect(sql`update seals set digest = 'x' where row_id = ${invoice}`).rejects.toThrow(/nur ergänzt/);
    await expect(sql`update audit_chain set seq = 1`).rejects.toThrow(/nur vom Audit-Log/);
    await expect(sql`delete from audit_chain`).rejects.toThrow(/nur vom Audit-Log/);
    expect(await problems()).toEqual([]);
  });

  it("erkennt geänderte Buchungszeilen, Positionen und Steuerbeträge", async () => {
    const entry = await lockedEntry();
    const invoice = await lockedInvoice();
    expect(
      await rolledBack(async (tx) => {
        await tamper(tx, () => tx`update journal_lines set account = '8300' where entry_id = ${entry} and account = '8400'`);
        return problems(tx);
      }),
    ).toEqual([{ art: "siegel", tabelle: "journal_entries", zeile: entry, befund: "Inhalt passt nicht zum Siegel" }]);
    expect(
      await rolledBack(async (tx) => {
        await tamper(tx, () => tx`update invoice_taxes set tax = 1 where invoice_id = ${invoice}`);
        return problems(tx);
      }),
    ).toEqual([{ art: "siegel", tabelle: "invoices", zeile: invoice, befund: "Inhalt passt nicht zum Siegel" }]);
    // Auch das PDF selbst, nicht nur seine Prüfsumme
    expect(
      await rolledBack(async (tx) => {
        await tamper(tx, () => tx`update invoices set pdf = ${Buffer.from("%PDF-1.7 gefälscht")} where id = ${invoice}`);
        return problems(tx);
      }),
    ).toHaveLength(1);
    expect(await problems()).toEqual([]);
  });

  it("erkennt aufgehobene Festschreibungen, gelöschte Datensätze und fehlende Siegel", async () => {
    const entry = await lockedEntry();
    const [doc] = await sql`insert into documents (sha256, filename, mime_type, size) values ('aufheben', 'a.pdf', 'application/pdf', 1) returning id`;
    await sql`insert into document_amounts (document_id, tax_rate, net, tax) values (${doc!.id}, 1900, 100, 19)`;
    await sql`update documents set locked_at = now() where id = ${doc!.id}`;
    const found = await rolledBack(async (tx) => {
      await tamper(tx, async () => {
        await tx`update documents set locked_at = null where id = ${doc!.id}`;
        await tx`delete from journal_lines where entry_id = ${entry}`;
        await tx`delete from journal_entries where id = ${entry}`;
        await tx`insert into documents (sha256, filename, mime_type, size, locked_at) values ('x', 'x.pdf', 'application/pdf', 1, now())`;
      });
      return problems(tx);
    });
    expect(found.map((p) => p.befund).sort()).toEqual([
      "Festgeschrieben, aber ohne Siegel",
      "Festschreibung aufgehoben",
      "Versiegelter Datensatz fehlt",
    ]);
  });

  it("versiegelt jede Kassenbuchzeile beim Anlegen und erkennt stille Änderungen", async () => {
    const [{ n }] = (await sql`select coalesce(max(number), 0)::int + 1 as n from cash_entries`) as unknown as [{ n: number }];
    const [entry] = await sql`insert into cash_entries (number, date, amount, kind, text)
      values (${n}, '2026-03-01', 5000, 'einlage', 'Wechselgeld') returning id`;
    const [seal] = await sql`select genesis from seals where table_name = 'cash_entries' and row_id = ${entry!.id}`;
    expect(seal).toEqual({ genesis: false });
    expect(await problems()).toEqual([]);

    const changed = await rolledBack(async (tx) => {
      await tamper(tx, () => tx`update cash_entries set text = 'Privat', amount = 500 where id = ${entry!.id}`);
      return problems(tx);
    });
    expect(changed).toEqual([{ art: "siegel", tabelle: "cash_entries", zeile: entry!.id, befund: "Inhalt passt nicht zum Siegel" }]);

    const deleted = await rolledBack(async (tx) => {
      await tamper(tx, () => tx`delete from cash_entries where id = ${entry!.id}`);
      return problems(tx);
    });
    expect(deleted).toEqual([{ art: "siegel", tabelle: "cash_entries", zeile: entry!.id, befund: "Versiegelter Datensatz fehlt" }]);

    const unsealed = await rolledBack(async (tx) => {
      await tamper(tx, () => tx`insert into cash_entries (number, date, amount, kind, text) values (${n + 1}, '2026-03-02', 100, 'einlage', 'nachgeschoben')`);
      return problems(tx);
    });
    expect(unsealed).toEqual([expect.objectContaining({ tabelle: "cash_entries", befund: "Festgeschrieben, aber ohne Siegel" })]);
  });

  it("versiegelt Zuordnungen, Pauschalen und AfA beim Anlegen und erkennt stille Änderungen", async () => {
    const entry = await lockedEntry();
    const [account] = await sql`insert into bank_accounts (name, iban) values ('Giro', ${`DE${entry.replace(/\D/g, "").padEnd(20, "0").slice(0, 20)}`}) returning id`;
    const [imported] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${account!.id}, 'auszug.csv', ${entry}, 'csv', 1, 0) returning id`;
    const [transaction] = await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, dedup_hash)
      values (${account!.id}, ${imported!.id}, '2026-01-20', 11900, ${entry}) returning id`;
    const [allocation] = await sql`insert into allocations (transaction_id, kind, amount) values (${transaction!.id}, 'privat', 11900) returning id`;
    const [pauschale] = await sql`insert into pauschalen (art, date, description, details, amount, journal_entry_id)
      values ('fahrt', '2026-01-20', 'Kunde', '{"km": 40}', 1200, ${entry}) returning id`;
    const [asset] = await sql`insert into assets (name, kind, method, account, acquisition_date, cost)
      values ('Laptop', 'edv', 'digital', '0650', '2026-01-05', 150000) returning id`;
    const [afa] = await sql`insert into asset_depreciations (asset_id, year, depreciation, entry_id)
      values (${asset!.id}, 2026, 150000, ${entry}) returning id`;
    const rows = { allocations: allocation!.id, pauschalen: pauschale!.id, asset_depreciations: afa!.id } as Record<string, string>;

    const seals = await sql`select table_name, row_id, genesis from seals where row_id in ${sql(Object.values(rows))}`;
    expect(Object.fromEntries(seals.map((s) => [s.table_name, s.row_id]))).toEqual(rows);
    expect(seals.every((s) => s.genesis === false)).toBe(true);
    expect(await problems()).toEqual([]);

    const changed = await rolledBack(async (tx) => {
      await tamper(tx, async () => {
        await tx`update allocations set kind = 'gebuehren' where id = ${rows.allocations!}`;
        await tx`update pauschalen set details = '{"km": 400}' where id = ${rows.pauschalen!}`;
        await tx`update asset_depreciations set depreciation = 1 where id = ${rows.asset_depreciations!}`;
      });
      return problems(tx);
    });
    expect(changed.map(({ tabelle, zeile, befund }) => ({ tabelle, zeile, befund }))).toEqual(
      Object.entries(rows).map(([tabelle, zeile]) => ({ tabelle, zeile, befund: "Inhalt passt nicht zum Siegel" })),
    );

    const deleted = await rolledBack(async (tx) => {
      await tamper(tx, () => tx`delete from pauschalen where id = ${rows.pauschalen!}`);
      return problems(tx);
    });
    expect(deleted).toEqual([{ art: "siegel", tabelle: "pauschalen", zeile: rows.pauschalen, befund: "Versiegelter Datensatz fehlt" }]);

    const unsealed = await rolledBack(async (tx) => {
      await tamper(tx, () => tx`insert into allocations (transaction_id, kind, amount, reverses_id) values (${transaction!.id}, 'privat', -11900, ${rows.allocations!})`);
      return problems(tx);
    });
    expect(unsealed).toEqual([expect.objectContaining({ tabelle: "allocations", befund: "Festgeschrieben, aber ohne Siegel" })]);
  });

  it("erkennt ein gefälschtes Siegel über den Eintrag in der Kette", async () => {
    const invoice = await lockedInvoice();
    const found = await rolledBack(async (tx) => {
      await tamper(tx, async () => {
        await tx`update invoice_lines set net = 1 where invoice_id = ${invoice}`;
        await tx`update seals set digest = haben_seal_digest(table_name, row_id, columns) where row_id = ${invoice}`;
      });
      return problems(tx);
    });
    expect(found).toEqual([expect.objectContaining({ art: "siegel", zeile: invoice, befund: "Siegel weicht vom Eintrag im Audit-Log ab" })]);
  });

  it("erkennt geänderte, gelöschte und abgeschnittene Einträge im Audit-Log", async () => {
    await lockedEntry();
    const [{ seq }] = (await sql`select max(seq)::int as seq from audit_log`) as unknown as [{ seq: number }];
    const changed = await rolledBack(async (tx) => {
      await tamper(tx, () => tx`update audit_log set actor = 'jemand' where seq = ${seq - 2}`);
      return problems(tx);
    });
    expect(changed).toEqual([{ art: "kette", tabelle: "audit_log", zeile: expect.any(String), befund: "Inhalt passt nicht zum Hash" }]);

    const deleted = await rolledBack(async (tx) => {
      await tamper(tx, () => tx`delete from audit_log where seq = ${seq - 2}`);
      return problems(tx);
    });
    expect(deleted.map((p) => p.befund)).toEqual([`Lücke: auf Eintrag ${seq - 3} folgt ${seq - 1}`]);

    const cut = await rolledBack(async (tx) => {
      await tamper(tx, () => tx`delete from audit_log where seq = ${seq}`);
      return problems(tx);
    });
    // Der letzte Eintrag ist das Siegel der Buchung; es fehlt nun auch in der Kette
    expect(cut).toEqual([
      expect.objectContaining({ art: "kopf", befund: `Kopf steht bei ${seq}, das Audit-Log endet bei ${seq - 1}` }),
      expect.objectContaining({ art: "siegel", tabelle: "journal_entries", befund: "Siegel fehlt im Audit-Log" }),
    ]);
  });

  it("eine neu berechnete Kette fällt erst beim Prüfwert von außerhalb auf", async () => {
    await lockedEntry();
    const head = (await integrity.chainHead())!;
    expect(await integrity.checkPruefwert(head.seq, head.hash.toUpperCase())).toEqual({ status: "ok", seq: head.seq });
    expect(await integrity.checkPruefwert(head.seq + 1000, head.hash)).toEqual({ status: "fehlt", seq: head.seq + 1000, head: head.seq });

    // Ein früherer Eintrag geändert, die Hashes stehen gelassen: der Hash an der Nummer stimmt noch, die Kette nicht
    const [original] = await sql`select actor from audit_log where seq = 2`;
    const setActor = (actor: string | null) =>
      sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update audit_log set actor = ${actor} where seq = 2`;
      });
    await setActor("jemand");
    try {
      expect(await integrity.checkPruefwert(head.seq, head.hash)).toEqual({
        status: "beschaedigt",
        seq: head.seq,
        first: 2,
        befund: "Inhalt passt nicht zum Hash",
      });
    } finally {
      await setActor(original!.actor);
    }
    expect(await integrity.checkPruefwert(head.seq, head.hash)).toEqual({ status: "ok", seq: head.seq });

    // Ein Betreiber ändert einen Eintrag und rechnet die ganze Kette samt Kopf neu
    const result = await rolledBack(async (tx) => {
      await tamper(tx, async () => {
        await tx`update audit_log set actor = 'jemand' where seq = 2`;
        await tx`do $$
          declare r audit_log; prev bytea := haben_audit_genesis();
          begin
            for r in select * from audit_log order by seq loop
              update audit_log set prev_hash = prev, row_hash = haben_audit_hash(prev, r) where id = r.id returning row_hash into prev;
            end loop;
            update audit_chain set hash = prev;
          end $$`;
      });
      const [row] = await tx`select encode(row_hash, 'hex') as hash from audit_log where seq = ${head.seq}`;
      return { problems: await problems(tx), hash: row!.hash as string };
    });
    expect(result.problems).toEqual([]);
    expect(result.hash).not.toBe(head.hash);
  });

  it("bleibt eindeutig bei parallelen Transaktionen", async () => {
    const pool = postgres(testDatabaseUrl!, { max: 8, onnotice: () => {} });
    try {
      await Promise.all(
        Array.from({ length: 16 }, (_, i) =>
          pool.begin(async (tx) => {
            await tx`insert into bank_accounts (name, iban) values (${`K${i}`}, ${`DE00PARALLEL${i}A`})`;
            await tx`select pg_sleep(${(i % 4) * 0.02})`;
            await tx`insert into bank_accounts (name, iban) values (${`L${i}`}, ${`DE00PARALLEL${i}B`})`;
          }),
        ),
      );
    } finally {
      await pool.end();
    }
    const [stats] = await sql`select count(*)::int as n, max(seq)::int as max, count(distinct prev_hash)::int as prevs from audit_log`;
    expect(stats).toMatchObject({ n: stats!.max, prevs: stats!.n });
    expect(await problems()).toEqual([]);
  });

  it("lehnt REPEATABLE READ ab, Savepoints lassen Kette und Kopf stimmig", async () => {
    await expect(
      sql.begin("isolation level repeatable read", (tx) => tx`insert into bank_accounts (name, iban) values ('RR', 'DE00RR')`),
    ).rejects.toThrow(/nur unter READ COMMITTED/);
    await sql.begin(async (tx) => {
      await tx`insert into bank_accounts (name, iban) values ('S1', 'DE00SAVE1')`;
      await tx.savepoint((sp) => sp`insert into bank_accounts (name, iban) values ('S2', 'DE00SAVE2')`).catch(() => {});
      await tx
        .savepoint(async (sp) => {
          await sp`insert into bank_accounts (name, iban) values ('S3', 'DE00SAVE3')`;
          throw new Error("zurück");
        })
        .catch(() => {});
    });
    const [head] = await sql`select seq, hash from audit_chain`;
    const [last] = await sql`select seq, row_hash from audit_log order by seq desc limit 1`;
    expect(Number(head!.seq)).toBe(Number(last!.seq));
    expect(head!.hash).toEqual(last!.row_hash);
    expect(await problems()).toEqual([]);
  });

  it("verkettet viele Einträge einer Transaktion ohne quadratischen Aufwand", async () => {
    const started = performance.now();
    await sql`insert into bank_accounts (name, iban) select 'Massen ' || g, 'DE00MASSE' || g from generate_series(1, 20000) g`;
    // Mit einer Kopfzeile, die je Eintrag geändert wird, wären es rund 15 s; jetzt etwa 1,5 s (Luft für langsame CI)
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(await problems()).toEqual([]);
  });

  it("hängt nicht von Zeitzone oder späteren Spalten ab", async () => {
    await lockedInvoice();
    const found = await rolledBack(async (tx) => {
      await tx`set local timezone = 'America/New_York'`;
      await tx`alter table invoices add column spaeter text not null default 'neu'`;
      await tx`alter table journal_lines add column spaeter integer not null default 1`;
      return problems(tx);
    });
    expect(found).toEqual([]);
  });

  it("meldet einen Befund in der Prüfung mit Anzahl und Kopf", async () => {
    const report = await integrity.checkIntegrity();
    expect(report.problems).toEqual([]);
    expect(report.entries).toBe(report.head!.seq);
    expect(report.seals).toBeGreaterThan(0);
    expect(report.truncated).toBe(false);
  });
});

describe.skipIf(!testDatabaseUrl)("Prüfwert per E-Mail (Postgres)", () => {
  let sql: postgres.Sql;
  let mail: typeof import("./mail.ts");
  const sent: { to: string; subject: string; text: string }[] = [];
  const DAY = 24 * 60 * 60 * 1000;
  /** Vormittags in Berlin, so viele Tage ab heute */
  const at = (days: number) => {
    const date = new Date(Date.now() + days * DAY);
    date.setUTCHours(9, 0, 0, 0);
    return date;
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    mail = await import("./mail.ts");
    mail.setMailTransportForTests(() => {
      const transport = nodemailer.createTransport({ jsonTransport: true });
      return {
        sendMail: async (message: { to: string; subject: string; text: string }) => {
          sent.push(message);
          return transport.sendMail(message);
        },
      } as unknown as ReturnType<typeof nodemailer.createTransport>;
    });
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("schickt den Prüfwert wöchentlich, nur bei Änderungen und nur wenn eingeschaltet", async () => {
    expect(await mail.runDuePruefwertMail(at(1))).toBeNull(); // kein E-Mail-Zugang
    await mail.saveMailSettings("test", {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      username: "max",
      password: "geheim",
      fromAddress: "haben@example.com",
      reminderTo: "max@example.com",
      remindersEnabled: false,
      reminderDays: [],
    });

    const first = await mail.runDuePruefwertMail(at(1));
    expect(first).toEqual({ seq: expect.any(Number), problems: 0, rewritten: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("max@example.com");
    expect(sent[0]!.subject).toBe(`Haben: Prüfwert des Änderungsprotokolls (Nr. ${first!.seq})`);
    const [row] = await sql`select encode(row_hash, 'hex') as hash from audit_log where seq = ${first!.seq}`;
    expect(sent[0]!.text).toContain(`Nr. ${first!.seq} · ${row!.hash}`);
    expect(sent[0]!.text).toContain("unverändert");

    // Innerhalb einer Woche nicht noch einmal
    expect(await mail.runDuePruefwertMail(at(5))).toBeNull();
    // Nach einer Woche nicht, wenn nur die eigene Mail im Protokoll steht; danach wird nur einmal am Tag geprüft
    expect(await mail.runDuePruefwertMail(at(9))).toBeNull();
    await sql`insert into bank_accounts (name, iban) values ('Neu', 'DE00PRUEFWERT')`;
    expect(await mail.runDuePruefwertMail(at(9))).toBeNull();
    // Nach einer Änderung am nächsten Tag schon
    expect(await mail.runDuePruefwertMail(at(10))).toEqual({ seq: expect.any(Number), problems: 0, rewritten: false });
    expect(sent).toHaveLength(2);

    // Ohne neuen Eintrag, aber neu verkettet: der Prüfwert der letzten Mail passt nicht mehr
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update audit_log set actor = 'jemand' where seq = 2`;
      await tx`do $$
        declare r audit_log; prev bytea := haben_audit_genesis();
        begin
          for r in select * from audit_log order by seq loop
            update audit_log set prev_hash = prev, row_hash = haben_audit_hash(prev, r) where id = r.id returning row_hash into prev;
          end loop;
          update audit_chain set hash = prev;
        end $$`;
    });
    expect(await mail.runDuePruefwertMail(at(18))).toMatchObject({ problems: 0, rewritten: true });
    expect(sent).toHaveLength(3);
    expect(sent[2]!.subject).toMatch(/^Haben: Änderungsprotokoll mit Befunden/);
    expect(sent[2]!.text).toContain("hat jetzt einen anderen Hash");

    // Abgeschaltet: keine Mail
    await sql`update mail_settings set pruefwert_mail = false`;
    await sql`insert into bank_accounts (name, iban) values ('Neu 2', 'DE00PRUEFWERT2')`;
    expect(await mail.runDuePruefwertMail(at(30))).toBeNull();
    expect(sent).toHaveLength(3);
  });
});
