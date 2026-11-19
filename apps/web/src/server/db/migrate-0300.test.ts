import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test-db.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/*
 * Migration 0300 (#306, Schritt 4): `import_movements.refs` auf einer Instanz mit übernommenen Bewegungen. Die Migration
 * fügt nur eine leere Spalte an; vorhandene Bewegungen, ihr Eintrag im Änderungsprotokoll und die Hash-Kette bleiben,
 * wie sie sind, und die Tabelle bleibt nur anhängbar.
 */
describe.skipIf(!testDatabaseUrl)("Migration 0300: Referenzen an bestehenden Importbewegungen (Postgres)", () => {
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
    const idx = full.entries.findIndex((e: { tag: string }) => e.tag === "0300_importvertrag_referenzen");
    writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...full, entries: full.entries.slice(0, idx) }));
    sql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: previous });
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Bewegung mit Bindung, Lieferung, Abruf und Umsatz, wie `storeBatch` sie anlegt; `refs` nur, wenn es die Spalte gibt */
  async function bewegung(nr: number, refs?: Record<string, string>) {
    const [konto] = await sql`insert into bank_accounts (name, iban) values (${`Giro ${nr}`}, ${`DE8937040044053201300${nr}`}) returning id`;
    const [abruf] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${konto!.id}, ${`Abruf ${nr}`}, ${String(nr).repeat(64)}, 'enablebanking', 1, 0) returning id`;
    const [umsatz] = await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, purpose, dedup_hash, bank_reference)
      values (${konto!.id}, ${abruf!.id}, '2026-11-12', -4999, 'Rechnung 9/2026', ${`h${nr}`}, ${`ER-${nr}`}) returning id`;
    const [quelle] = await sql`insert into import_sources (bank_account_id, provider, external_account_id, account_kind, cutover_date)
      values (${konto!.id}, 'enablebanking', ${`hash-${nr}`}, 'bank', '2026-11-01') returning id`;
    const [lieferung] = await sql`insert into import_batches (source_id, idempotency_key, fetch_id, part_index, part_last,
        coverage_from, coverage_to, blocking, fingerprint, bank_import_id, checkpoint, complete)
      values (${quelle!.id}, ${`schluessel-${nr}`}, ${`abruf-${nr}`}, 0, true, '2026-11-01', '2026-11-12', 0, 'f', ${abruf!.id}, '2026-11-12', true)
      returning id`;
    const werte = { source_id: quelle!.id, batch_id: lieferung!.id, source_event_id: `ER-${nr}`, component: "main", kind: "payment" };
    const [b] = refs
      ? await sql`insert into import_movements (source_id, batch_id, source_event_id, component, kind, booking_date, amount, currency, details, transaction_id, refs)
          values (${werte.source_id}, ${werte.batch_id}, ${werte.source_event_id}, 'main', 'payment', '2026-11-12', -4999, 'EUR', 'd', ${umsatz!.id}, ${JSON.stringify(refs)}::jsonb)
          returning id`
      : await sql`insert into import_movements (source_id, batch_id, source_event_id, component, kind, booking_date, amount, currency, details, transaction_id)
          values (${werte.source_id}, ${werte.batch_id}, ${werte.source_event_id}, 'main', 'payment', '2026-11-12', -4999, 'EUR', 'd', ${umsatz!.id})
          returning id`;
    return b!.id as string;
  }

  const protokoll = (id: string) =>
    sql<{ new_value: Record<string, unknown>; row_hash: Buffer }[]>`select new_value, row_hash from audit_log
      where table_name = 'import_movements' and row_id = ${id}`;

  it("fügt nur eine leere Spalte an: alte Bewegung, ihr Protokolleintrag und die Hash-Kette bleiben, Ändern bleibt gesperrt", async () => {
    const alt = await bewegung(1);
    const vorher = await protokoll(alt);
    expect(vorher).toHaveLength(1);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);

    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });

    const [zeile] = await sql`select refs from import_movements where id = ${alt}`;
    expect(zeile!.refs).toBeNull();
    expect(await protokoll(alt)).toEqual(vorher);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);

    // Eine neue Bewegung trägt ihre Referenzen, auch im Änderungsprotokoll
    const refs = { providerReference: "ER-2", relatedEventId: "ER-1", orderId: "12-34567-89012" };
    const neu = await bewegung(2, refs);
    const [eintrag] = await protokoll(neu);
    expect(eintrag!.new_value.refs).toEqual(refs);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);

    // Nur anhängen, auch für die neue Spalte: alte Bewegungen bekommen ihre Referenzen nicht nachträglich
    await expect(sql`update import_movements set refs = ${JSON.stringify(refs)}::jsonb where id = ${alt}`).rejects.toThrow(
      "import_movements darf nur ergänzt werden",
    );
  });
});
