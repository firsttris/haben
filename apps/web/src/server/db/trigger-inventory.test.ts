import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";

const migrationsFolder = fileURLToPath(new URL("../../../drizzle", import.meta.url));

describe.skipIf(!testDatabaseUrl)("Sollbestand der Sperrtrigger (Postgres, #764)", () => {
  let sql: postgres.Sql;
  let inventory: typeof import("./trigger-inventory.ts");
  beforeAll(async () => {
    sql = await setupTestDb();
    inventory = await import("./trigger-inventory.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  it("hält den eingecheckten Sollbestand mit der frisch migrierten Testdatenbank aktuell", async () => {
    const expected = JSON.parse(readFileSync(new URL("./trigger-inventory.json", import.meta.url), "utf8"));
    expect(await inventory.readTriggerInventory(drizzle(sql))).toEqual(expected);
  });

  it.each([
    "drop function haben_reject_locked() cascade",
    "create or replace trigger journal_lines_locked before update of account on journal_lines for each row execute function haben_reject_locked_journal_line()",
  ])("erkennt fehlende Funktion beziehungsweise UPDATE OF: %s", async (statement) => {
    const rollback = new Error("Gegenprobe zurückrollen");
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe(statement);
        const result = await inventory.checkTriggerIntegrity(drizzle(tx));
        expect(result.problems).toContainEqual(expect.objectContaining({ art: "sperre" }));
        if (statement.startsWith("drop function")) {
          expect(result.problems).toContainEqual(expect.objectContaining({ befund: expect.stringContaining("Funktion public.haben_reject_locked() fehlt") }));
        }
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("prüft den Constraintaufschub und speichert stabile Namen statt OIDs", async () => {
    const rollback = new Error("Gegenprobe zurückrollen");
    await expect(
      sql.begin(async (tx) => {
        const [trigger] = await tx`select tgname as name, c.relname as table, pg_get_triggerdef(t.oid) as definition
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgdeferrable limit 1`;
        expect(trigger).toBeDefined();
        await tx.unsafe(`drop trigger "${trigger!.name}" on "${trigger!.table}"`);
        await tx.unsafe(trigger!.definition.replace("DEFERRABLE", "NOT DEFERRABLE").replace(" INITIALLY DEFERRED", ""));
        expect((await inventory.checkTriggerIntegrity(drizzle(tx))).problems).toContainEqual(
          expect.objectContaining({ befund: expect.stringContaining(trigger!.name) }),
        );
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    const first = await inventory.readTriggerInventory(drizzle(sql));
    await sql`set search_path = pg_catalog`;
    try {
      expect(await inventory.readTriggerInventory(drizzle(sql))).toEqual(first);
    } finally {
      await sql`reset search_path`;
    }
  });

  it("bleibt nach einem Update von 0191 auf den aktuellen Stand befundfrei", async () => {
    const previous = mkdtempSync(join(tmpdir(), "haben-trigger-update-"));
    cpSync(migrationsFolder, previous, { recursive: true });
    const journalPath = join(previous, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((e: { idx: number }) => e.idx < 192) }));
    // Diese Datei besitzt eine eigene Worker-Datenbank; keine Verbindung der App ist eingebunden.
    await sql`drop schema public cascade`;
    await sql`create schema public`;
    await sql`drop schema drizzle cascade`;
    await migrate(drizzle(sql), { migrationsFolder: previous });
    await sql`insert into company (id, name) values (1, 'Synthetische Updateprobe')`;
    await migrate(drizzle(sql), { migrationsFolder });
    expect(await inventory.checkTriggerIntegrity(drizzle(sql))).toEqual({ problems: [], hints: [] });
  }, 120_000);
});
