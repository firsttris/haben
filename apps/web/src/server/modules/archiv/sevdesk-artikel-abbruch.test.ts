import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Abbrechen während der Artikel (#472): Nach „Abbrechen“ legt der Schritt keinen weiteren Artikel an. Die Artikel sind
 * schon geladen, das Speichern ruft die API nicht mehr auf; ohne Prüfung des Signals liefe die Schleife bis zum Ende.
 */

const abort = { controller: new AbortController(), afterInserts: Number.POSITIVE_INFINITY, inserts: 0 };

vi.mock("../stammdaten/index.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../stammdaten/index.ts")>();
  return {
    ...original,
    insertArticle: async (...args: Parameters<typeof original.insertArticle>) => {
      const row = await original.insertArticle(...args);
      abort.inserts += 1;
      if (abort.inserts >= abort.afterInserts) abort.controller.abort();
      return row;
    },
  };
});

function part(id: string) {
  return {
    id,
    objectName: "Part",
    name: `Probeartikel ${id}`,
    partNumber: `P-${id}`,
    unity: { id: "1", objectName: "Unity" },
    priceNet: "10.00",
    taxRate: "19",
    status: "100",
  };
}

describe.skipIf(!testDatabaseUrl)("Artikel aus sevDesk: Abbruch (Postgres)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("legt nach dem Abbrechen keinen weiteren Artikel an", async () => {
    const { importSevdeskArticles } = await import("./sevdesk-artikel.ts");
    const parts = [part("21"), part("22"), part("23")];
    const unities = [{ id: "1", objectName: "Unity", name: "Stk", uneceTradeUnitCode: "C62" }];
    const client = {
      async *parts() {
        yield* parts;
      },
      async *unities() {
        yield* unities;
      },
    } as unknown as import("@haben/import").SevdeskClient;
    abort.afterInserts = 1;
    const progress = { failed: [] } as unknown as Parameters<typeof importSevdeskArticles>[2];

    await importSevdeskArticles("test-user", client, progress, abort.controller.signal).catch(() => {});

    const [count] = await sql`select count(*)::int as n from articles where sevdesk_id is not null`;
    expect(count!.n).toBe(1);
  });
});
