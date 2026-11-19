import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Anfragen an FastBill über der Grenze (Postgres)", () => {
  let sql: postgres.Sql;
  let anfragen: typeof import("./fastbill-anfragen.ts");
  let zugang: typeof import("./fastbill-zugang.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    anfragen = await import("./fastbill-anfragen.ts");
    zugang = await import("./fastbill-zugang.ts");
  }, 30_000);

  beforeEach(async () => {
    await sql`delete from lexoffice_imports`;
    await sql`delete from fastbill_connection`;
    zugang.forgetOtherFastbillCalls();
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("nennt über der Grenze (Tarif heruntergesetzt) die Uhrzeit, zu der der Client wirklich wieder anfragt", async () => {
    // Lauf mit Tarif Pro: 60 Anfragen ab 13:05 UTC im Abstand von 30 s; danach Tarif auf Solo (50) geändert
    const now = Date.parse("2026-11-19T14:00:00Z");
    const start = now - 55 * 60_000;
    const calls = Array.from({ length: 60 }, (_, i) => start + i * 30_000);
    await sql`insert into lexoffice_imports (source, status, progress) values ('fastbill', 'fertig', ${JSON.stringify({ fastbillCalls: calls })}::jsonb)`;
    await sql`insert into fastbill_connection (id, email, ciphertext, calls_per_hour) values (1, 'a@example.org', decode('00', 'hex'), 50)`;
    const usage = await anfragen.fastbillUsage(now);
    expect(usage.used).toBe(60);
    // Der Client wartet bis starts[länge - callsPerHour] + 1 h (packages/import/src/fastbill/client.ts:318), hier calls[10] = 13:10 UTC
    expect(usage.freeAt).toBe("2026-11-19T14:10:00.000Z");
  });

  it("zählt die Aufrufe des Artikel-Abrufs mit", async () => {
    const t = Date.now() - 5 * 60_000;
    zugang.noteFastbillCalls([t, t + 1000]);
    expect(await anfragen.fastbillUsage()).toEqual({ used: 2, freeAt: new Date(t + 3_600_000).toISOString() });
  });
});
