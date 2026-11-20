import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/*
 * Migration 0312 (#1494): Die Standard-Einleitungen aus den Firmendaten werden zu Kopftext-Bausteinen mit Standard für
 * Rechnungen bzw. Angebote, danach entfallen die beiden Spalten. Eine leere Einleitung ergibt keinen Baustein; vorhandene
 * Bausteine bleiben, wie sie sind; das Änderungsprotokoll nennt die Migration als Urheber und die Hash-Kette hält.
 */
describe.skipIf(!testDatabaseUrl)("Migration 0312: Standard-Einleitung wird Standard-Textbaustein (Postgres)", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await admin`drop database if exists ${admin(name)} with (force)`;
    await admin`create database ${admin(name)}`;
    await admin.end();
    const previous = mkdtempSync(join(tmpdir(), "haben-migrationen-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
    const idx = full.entries.findIndex((e: { tag: string }) => e.tag === "0312_standard_textbaustein");
    writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...full, entries: full.entries.slice(0, idx) }));
    sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: previous });
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("übernimmt die nicht leere Einleitung als Standard-Baustein, lässt vorhandene Bausteine und entfernt die Spalten", async () => {
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'test:vorher', true)`;
      await tx`insert into company (id, name, invoice_intro, quote_intro) values (1, 'Testfirma', 'Für die Wartung berechne ich Ihnen:', '   ')`;
      await tx`insert into text_blocks (name, kind, text) values ('Dank zum Schluss', 'fuss', 'Vielen Dank!')`;
    });
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);

    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });

    expect(await sql`select name, kind, text, standard_fuer from text_blocks order by name`).toEqual([
      { name: "Dank zum Schluss", kind: "fuss", text: "Vielen Dank!", standard_fuer: null },
      { name: "Standard-Einleitung für Rechnungen", kind: "kopf", text: "Für die Wartung berechne ich Ihnen:", standard_fuer: "rechnung" },
    ]);
    expect(
      await sql`select column_name from information_schema.columns where table_name = 'company' and column_name in ('invoice_intro', 'quote_intro')`,
    ).toEqual([]);
    const [neu] = await sql`select actor from audit_log where table_name = 'text_blocks' and action = 'INSERT' order by seq desc limit 1`;
    expect(neu?.actor).toBe("system:migration");
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
    // Höchstens ein Standard je Belegart und Art
    await expect(sql`insert into text_blocks (name, kind, text, standard_fuer) values ('Zweiter', 'kopf', 'x', 'rechnung')`).rejects.toThrow(
      /text_blocks_standard/,
    );
  }, 120_000);
});
