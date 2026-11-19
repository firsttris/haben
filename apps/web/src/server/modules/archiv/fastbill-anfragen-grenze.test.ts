import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fastbillUsageText } from "../../../components/archiv/FastbillTeile.tsx";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe("fastbillUsageText (Review #1525)", () => {
  it("schreibt bei genau einer freien Anfrage „1 ist noch frei“", () => {
    expect(fastbillUsageText({ used: 49, freeAt: "2026-11-19T14:40:00Z" }, 50)).toMatch(/49 davon genutzt, 1 ist noch frei\./);
  });

  // Verworfen, wenn grün: Sommerzeit wird richtig nach Europe/Berlin umgerechnet
  it("rechnet die Uhrzeit auch in der Sommerzeit nach deutscher Zeit", () => {
    expect(fastbillUsageText({ used: 50, freeAt: "2026-07-01T10:05:00Z" }, 50)).toMatch(/um 12:05 Uhr frei\./);
  });
});

describe.skipIf(!testDatabaseUrl)("Anfragen an FastBill über der Grenze (Review #1525, Postgres)", () => {
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
    expect(fastbillUsageText(usage, 50)).toMatch(/die nächste wird um 15:10 Uhr frei\./);
  });

  // Verworfen, wenn grün: Aufrufe des Artikel-Abrufs (im Speicher) zählen mit
  it("zählt die Aufrufe des Artikel-Abrufs mit", async () => {
    const t = Date.now() - 5 * 60_000;
    zugang.noteFastbillCalls([t, t + 1000]);
    expect(await anfragen.fastbillUsage()).toEqual({ used: 2, freeAt: new Date(t + 3_600_000).toISOString() });
  });
});
