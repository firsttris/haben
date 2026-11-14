import { sql as query } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { checkTriggerIntegrity, readTriggerInventory } from "./trigger-inventory.ts";

describe.skipIf(!testDatabaseUrl)("Unabhängige Gegenproben PR 874, Code Runde 1", () => {
  let sql: postgres.Sql;
  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function rolledBack(check: (tx: ReturnType<typeof drizzle>) => Promise<void>) {
    const rollback = new Error("Review-Gegenprobe zurückrollen");
    try {
      await drizzle(sql).transaction(async (tx) => {
        await check(tx as unknown as ReturnType<typeof drizzle>);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  it("liest innerhalb einer Transaktion stabil und stellt ihren Suchpfad wieder her", async () => {
    const baseline = await readTriggerInventory(drizzle(sql));
    await rolledBack(async (tx) => {
      await tx.execute(query`set local search_path = public, pg_catalog`);
      expect(await readTriggerInventory(tx)).toEqual(baseline);
      expect(await tx.execute(query`select current_setting('search_path') as path`)).toEqual([{ path: "public, pg_catalog" }]);
    });
  });

  it("erkennt geänderte Triggerargumente auch bei unveränderter Triggerfunktion", async () => {
    await rolledBack(async (tx) => {
      await tx.execute(query`create or replace trigger journal_lines_locked before insert or update or delete
        on public.journal_lines for each row execute function public.haben_reject_locked_journal_line('review874')`);
      expect((await checkTriggerIntegrity(tx)).problems).toContainEqual(
        expect.objectContaining({
          tabelle: "journal_lines",
          befund: "Trigger public.journal_lines.journal_lines_locked wurde verändert",
        }),
      );
    });
  });

  it.each(["immutable", "strict", "parallel safe"])("erkennt das geänderte Funktionsattribut %s", async (attribute) => {
    await rolledBack(async (tx) => {
      await tx.execute(query.raw(`alter function public.haben_reject_locked() ${attribute}`));
      expect((await checkTriggerIntegrity(tx)).problems).toContainEqual(
        expect.objectContaining({
          befund: "Funktion public.haben_reject_locked() wurde verändert",
        }),
      );
    });
  });

  it("erkennt eine veränderte Hilfsfunktion ohne direkte Triggerreferenz", async () => {
    await rolledBack(async (tx) => {
      await tx.execute(query`create or replace function public.haben_seal_columns(tbl text) returns jsonb
        language sql as $$ select '[]'::jsonb $$`);
      expect((await checkTriggerIntegrity(tx)).problems).toContainEqual(
        expect.objectContaining({
          befund: "Funktion public.haben_seal_columns(tbl text) wurde verändert",
        }),
      );
    });
  });

  it("erkennt eine deaktivierte Sperre trotz überschattetem set_config und pg_trigger", async () => {
    await rolledBack(async (tx) => {
      // Kein Superuser für den Angriff; nur eigene synthetische Objekte in dieser Wegwerf-Datenbank.
      await tx.execute(query`create role review874_probe_owner nosuperuser nocreatedb nocreaterole nologin`);
      await tx.execute(query`grant usage, create on schema public to review874_probe_owner`);
      await tx.execute(query`alter table public.year_closings owner to review874_probe_owner`);
      await tx.execute(query`set local role review874_probe_owner`);
      await tx.execute(query`create table public.pg_trigger as table pg_catalog.pg_trigger`);
      await tx.execute(query`create function public.set_config(text, text, boolean) returns text
        language sql as $$ select $2 $$`);
      await tx.execute(query`create function public.pg_get_triggerdef(oid, boolean) returns text
        language sql set search_path = pg_catalog as $$ select pg_catalog.pg_get_triggerdef($1, $2) $$`);
      await tx.execute(query`create function public.pg_get_function_identity_arguments(oid) returns text
        language sql set search_path = pg_catalog as $$ select pg_catalog.pg_get_function_identity_arguments($1) $$`);
      await tx.execute(query`create function public.pg_get_functiondef(oid) returns text
        language sql set search_path = pg_catalog as $$ select pg_catalog.pg_get_functiondef($1) $$`);
      await tx.execute(query`alter table public.year_closings disable trigger year_closings_append_only`);
      await tx.execute(query`set local search_path = public, pg_catalog`);
      expect(
        await tx.execute(query`select tgenabled from pg_catalog.pg_trigger
        where tgrelid = 'public.year_closings'::regclass and tgname = 'year_closings_append_only'`),
      ).toEqual([{ tgenabled: "D" }]);
      const result = await checkTriggerIntegrity(tx);
      expect(result.problems.map((p) => p.befund)).toContain("Trigger public.year_closings.year_closings_append_only ist abgeschaltet");
    });
  });

  it("liest pg_catalog.pg_trigger trotz einer gleichnamigen temporären Tabelle", async () => {
    await rolledBack(async (tx) => {
      await tx.execute(query`create temporary table pg_trigger as table pg_catalog.pg_trigger`);
      await tx.execute(query`alter table public.year_closings disable trigger year_closings_append_only`);
      expect(
        await tx.execute(query`select tgenabled from pg_catalog.pg_trigger
        where tgrelid = 'public.year_closings'::regclass and tgname = 'year_closings_append_only'`),
      ).toEqual([{ tgenabled: "D" }]);
      const result = await checkTriggerIntegrity(tx);
      expect(result.problems.map((p) => p.befund)).toContain("Trigger public.year_closings.year_closings_append_only ist abgeschaltet");
    });
  });
});
