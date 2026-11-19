import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl, workerDocumentsDir } from "../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/*
 * Migrationen 0298/0299 (#865) auf einer Instanz mit Bankumsätzen: Die Migration legt nur Tabellen und Trigger an. Die
 * einmalige Bestandsprüfung danach legt Verdachtsfälle an, ändert aber keinen Umsatz und keine Zuordnung.
 */
describe.skipIf(!testDatabaseUrl)("Migration 0298: Bankdubletten auf bestehenden Umsätzen (Postgres)", () => {
  let sql: postgres.Sql;
  const stand = () => sql`select md5(string_agg(t::text, '|' order by t.id)) as umsaetze,
      (select md5(string_agg(a::text, '|' order by a.id)) from allocations a) as zuordnungen
    from bank_transactions t`;

  beforeAll(async () => {
    const name = decodeURIComponent(new URL(testDatabaseUrl!).pathname.slice(1));
    const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await admin`drop database if exists ${admin(name)} with (force)`;
    await admin`create database ${admin(name)}`;
    await admin.end();
    const previous = mkdtempSync(join(tmpdir(), "haben-migrationen-"));
    cpSync(MIGRATIONS, previous, { recursive: true });
    const full = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
    const idx = full.entries.findIndex((e: { tag: string }) => e.tag === "0298_bank_dubletten");
    writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...full, entries: full.entries.slice(0, idx) }));
    sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: previous });
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("lässt Umsätze und Zuordnungen unverändert und legt erst mit der Bestandsprüfung nur Verdachtsfälle an", async () => {
    const [konto] = await sql`insert into bank_accounts (name, iban) values ('Giro', 'DE89370400440532013000') returning id`;
    const datei = (n: number) => sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${konto!.id}, ${`auszug-${n}.csv`}, ${String(n).repeat(64)}, 'csv', 1, 0) returning id`;
    const [erste] = await datei(1);
    const [zweite] = await datei(2);
    const umsatz = (importId: string, purpose: string, hash: string) => sql`insert into bank_transactions
        (bank_account_id, import_id, booking_date, amount, purpose, dedup_hash)
      values (${konto!.id}, ${importId}, '2025-11-12', -4999, ${purpose}, ${hash}) returning id`;
    const [original] = await umsatz(erste!.id, "AMAZON MK TP DE KUNDENREFERENZ 0", "h1");
    const [dublette] = await umsatz(zweite!.id, "AMAZON MKTP DE K UNDENREFERENZ", "h2");
    await umsatz(zweite!.id, "Miete November", "h3");
    await sql`insert into allocations (transaction_id, kind, amount) values (${dublette!.id}, 'gebuehren', -4999)`;
    const vorher = await stand();

    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
    expect(await stand()).toEqual(vorher);
    expect(await sql`select * from bank_duplicate_reviews`).toEqual([]);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);

    Object.assign(process.env, {
      DATABASE_URL: testDatabaseUrl,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
      DOCUMENTS_DIR: workerDocumentsDir(),
    });
    const { runExistingDuplicateCheck } = await import("../modules/bank/duplicate-scan.ts");
    expect(await runExistingDuplicateCheck()).toEqual({ added: 1 });
    expect(await runExistingDuplicateCheck()).toBeNull();
    expect(await stand()).toEqual(vorher);
    expect(await sql`select transaction_id, original_transaction_id, decision from bank_duplicate_reviews`).toEqual([
      { transaction_id: dublette!.id, original_transaction_id: original!.id, decision: "pending" },
    ]);
    // Die vorhandene Zuordnung schützt den Umsatz vor der Markierung
    const [review] = await sql`select id from bank_duplicate_reviews`;
    await expect(sql`insert into bank_duplicate_decisions (review_id, decision) values (${review!.id}, 'duplicate')`).rejects.toThrow(
      /Erst die Zuordnung aufheben/,
    );
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });
});
