import type postgres from "postgres";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Sperrtrigger in Kette prüfen (Postgres, #764)", () => {
  let sql: postgres.Sql;
  let integrity: typeof import("./integrity.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    integrity = await import("./integrity.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  // Jede Gegenprobe wird vollständig zurückgebaut; ausschließlich die isolierte Worker-Datenbank.
  async function withTrigger(statement: string, table: string, trigger: string, check: () => Promise<void>) {
    const [before] = await sql`select pg_get_triggerdef(t.oid) as definition from pg_trigger t
      join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace
      and c.relname = ${table} and t.tgname = ${trigger}`;
    try {
      await sql.unsafe(statement);
      await check();
    } finally {
      await sql.unsafe(`drop trigger if exists "${trigger}" on public."${table}"`);
      await sql.unsafe(before!.definition);
    }
  }

  const problems = async () => (await integrity.checkIntegrity()).problems.filter((p) => p.art === "sperre");

  it("ist nach frischer Migration und nach erneutem Migrationslauf befundfrei", async () => {
    expect(await problems()).toEqual([]);
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const { fileURLToPath } = await import("node:url");
    await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../../../../drizzle", import.meta.url)) });
    expect(await problems()).toEqual([]);
  });

  it.each(["disable", "enable replica"])("meldet %s als Sperrbefund mit Tabelle und Trigger", async (mode) => {
    await withTrigger(`alter table year_closings ${mode} trigger year_closings_append_only`, "year_closings", "year_closings_append_only", async () => {
      expect(await problems()).toContainEqual(
        expect.objectContaining({ tabelle: "year_closings", befund: expect.stringContaining("year_closings_append_only") }),
      );
    });
  });

  it("akzeptiert ENABLE ALWAYS und trennt den Katalogzustand vom Replikationsmodus", async () => {
    await withTrigger("alter table year_closings enable always trigger year_closings_append_only", "year_closings", "year_closings_append_only", async () => {
      expect(await problems()).toEqual([]);
    });
    await sql`set session_replication_role = replica`;
    try {
      expect(await problems()).toEqual([]);
    } finally {
      await sql`set session_replication_role = origin`;
    }
  });

  it("meldet einen fehlenden Trigger", async () => {
    await withTrigger("drop trigger contacts_no_delete on contacts", "contacts", "contacts_no_delete", async () => {
      expect(await problems()).toContainEqual(expect.objectContaining({ tabelle: "contacts", befund: expect.stringContaining("contacts_no_delete") }));
    });
  });

  it("meldet die Umgehung mit WHEN(false)", async () => {
    await withTrigger(
      `create or replace trigger journal_lines_locked before insert or update or delete on journal_lines
      for each row when (false) execute function haben_reject_locked_journal_line()`,
      "journal_lines",
      "journal_lines_locked",
      async () => {
        expect(await problems()).toContainEqual(expect.objectContaining({ tabelle: "journal_lines", befund: expect.stringContaining("journal_lines_locked") }));
      },
    );
  });

  it.each([
    "create or replace function haben_reject_locked() returns trigger language plpgsql as $$ begin return NEW; end $$",
    "alter function haben_reject_locked() set search_path = schatten, public",
    "alter function haben_reject_locked() security definer",
  ])("meldet eine geänderte Funktion: %s", async (statement) => {
    const [before] = await sql`select pg_get_functiondef('haben_reject_locked()'::regprocedure) as definition`;
    try {
      await sql.unsafe(statement);
      expect(await problems()).toContainEqual(expect.objectContaining({ befund: expect.stringContaining("haben_reject_locked()") }));
    } finally {
      await sql`alter function haben_reject_locked() reset all`;
      await sql.unsafe(before!.definition);
    }
  });

  // #1580: An diesem Standardwert misst die Prüfung der Siegel, was ein älteres Siegel nicht abdeckt
  it("meldet einen geänderten Standardwert einer versiegelten Tabelle mit Tabelle und Spalte", async () => {
    try {
      await sql`alter table vat_returns alter column kz41 set default 500000`;
      expect(await problems()).toEqual([
        { art: "sperre", tabelle: "vat_returns", zeile: null, seq: null, befund: "Standardwert von vat_returns.kz41 wurde verändert" },
      ]);
    } finally {
      await sql`alter table vat_returns alter column kz41 set default 0`;
    }
    expect(await problems()).toEqual([]);
  });

  it("meldet einen zusätzlichen Betreibertrigger nur als Hinweis", async () => {
    try {
      await sql`create function betreiber_probe() returns trigger language plpgsql as $$ begin return NEW; end $$`;
      await sql`create trigger betreiber_probe after insert on contacts for each row execute function betreiber_probe()`;
      await sql`alter table contacts disable trigger betreiber_probe`;
      const report = await integrity.checkIntegrity();
      expect(report.problems).toEqual([]);
      expect(report.triggerHints).toContain("Zusätzlicher Trigger public.contacts.betreiber_probe");
    } finally {
      await sql`drop trigger if exists betreiber_probe on contacts`;
      await sql`drop function if exists betreiber_probe()`;
    }
  });

  // Maßgeblich ist der Suchpfad, mit dem die Prüffunktionen starten. Eine fremde Funktion, die sie aufrufen, kann ihn
  // bis zum Ende der Transaktion ändern; diese hier gibt dabei nur das Ergebnis der eingebauten zurück.
  it("meldet ein Schema im Suchpfad, auch wenn eine Funktion darin den Suchpfad während der Prüfung ändert", async () => {
    const [{ name }] = (await sql`select current_user as name`) as unknown as [{ name: string }];
    try {
      await sql.unsafe(`create schema "${name}"`);
      await sql.unsafe(`create function "${name}".jsonb_build_array(bigint, text, text, text, text, text, jsonb, jsonb) returns jsonb
        language sql as $$ select pg_catalog.jsonb_build_array($1, $2, $3, $4, $5, $6, $7, $8)
        from pg_catalog.set_config('search_path', 'public', true) $$`);
      expect(await problems()).toContainEqual(expect.objectContaining({ tabelle: "Datenbank", befund: `Schema ${name} im Suchpfad der Verbindung` }));
    } finally {
      await sql.unsafe(`drop schema if exists "${name}" cascade`);
    }
  });

  it("nennt Tabelle und Trigger in der Wochenmail und in der Start-Logzeile", async () => {
    const mail = await import("../mail/mail.ts");
    const pruefwertMail = await import("./pruefwert-mail.ts");
    const sent: { text: string; subject: string }[] = [];
    mail.setMailTransportForTests(
      () =>
        ({
          sendMail: async (message: { text: string; subject: string }) => {
            sent.push(message);
            return nodemailer.createTransport({ jsonTransport: true }).sendMail(message);
          },
        }) as unknown as ReturnType<typeof nodemailer.createTransport>,
    );
    await mail.saveMailSettings("synthetische-probe", {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      username: "probe",
      password: "probe",
      fromAddress: "haben@example.com",
      reminderTo: "probe@example.com",
      remindersEnabled: false,
      reminderDays: [],
    });
    await withTrigger("alter table year_closings disable trigger year_closings_append_only", "year_closings", "year_closings_append_only", async () => {
      const now = new Date();
      now.setDate(now.getDate() + 1);
      now.setHours(10);
      expect(await pruefwertMail.runDuePruefwertMail(now)).toMatchObject({ problems: 1 });
      expect(sent[0]!.subject).toContain("mit Befunden");
      expect(sent[0]!.text).toContain("year_closings");
      expect(sent[0]!.text).toContain("year_closings_append_only");
      const { logTriggerIntegrity } = await import("../../db/trigger-inventory.ts");
      const { db } = await import("../../db/index.ts");
      const lines: string[] = [];
      await logTriggerIntegrity(db, (line) => lines.push(line));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("year_closings");
      expect(lines[0]).toContain("year_closings_append_only");
    });
  });
});
