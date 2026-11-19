import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fastbillUsageText } from "../../../components/archiv/FastbillTeile.tsx";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe("fastbillUsageText", () => {
  it("nennt genutzte und freie Anfragen und, wenn keine frei ist, wann die nächste frei wird", () => {
    expect(fastbillUsageText({ used: 0, freeAt: null }, 50)).toBe("");
    expect(fastbillUsageText({ used: 12, freeAt: "2026-11-19T14:40:00Z" }, 50)).toMatch(/12 davon genutzt, 38 sind noch frei\./);
    expect(fastbillUsageText({ used: 50, freeAt: "2026-11-19T14:40:00Z" }, 50)).toMatch(
      /50 davon genutzt, 0 sind noch frei, die nächste wird um 15:40 Uhr frei\./,
    );
  });
});

describe.skipIf(!testDatabaseUrl)("Anfragen an FastBill in der letzten Stunde (Postgres)", () => {
  let sql: postgres.Sql;
  let anfragen: typeof import("./fastbill-anfragen.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    anfragen = await import("./fastbill-anfragen.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("zählt nur Anfragen der letzten Stunde aus dem letzten Lauf; frei wird es, wenn die älteste eine Stunde alt ist", async () => {
    const now = Date.parse("2026-11-19T14:00:00Z");
    const calls = [now - 2 * 3_600_000, now - 50 * 60_000, now - 10 * 60_000];
    await sql`insert into lexoffice_imports (source, status, progress) values ('fastbill', 'fertig', ${JSON.stringify({ fastbillCalls: calls })}::jsonb)`;
    expect(await anfragen.fastbillUsage(now)).toEqual({ used: 2, freeAt: "2026-11-19T14:10:00.000Z" });
    expect(await anfragen.fastbillUsage(now + 3 * 3_600_000)).toEqual({ used: 0, freeAt: null });
  });
});
