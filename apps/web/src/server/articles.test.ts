import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Artikelkatalog (Postgres)", () => {
  let articles: typeof import("./articles.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    articles = await import("./articles.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate articles`;
  });

  it("legt an, ändert, archiviert und protokolliert", async () => {
    const beratung = await articles.createArticle(actor, { number: "B-01", description: "Beratung Softwarearchitektur", unit: "Std.", unitPrice: 11_000, taxRate: 1900 });
    await articles.createArticle(actor, { description: "Workshop, ganztägig", unit: "Tag", unitPrice: 98_000, taxRate: 1900, note: "inkl. Vorbereitung" });
    expect((await articles.listArticles()).map((a) => a.description)).toEqual(["Workshop, ganztägig", "Beratung Softwarearchitektur"]);

    await articles.updateArticle(actor, beratung.id, { number: "B-01", description: "Beratung Softwarearchitektur", unit: "Std.", unitPrice: 12_000, taxRate: 1900 });
    await articles.setArticleArchived(actor, beratung.id, true);
    expect((await articles.listArticles()).map((a) => a.number)).toEqual([""]);
    expect(await articles.listArticles({ archived: true })).toHaveLength(2);
    await articles.setArticleArchived(actor, beratung.id, false);
    expect((await articles.listArticles()).find((a) => a.id === beratung.id)?.unitPrice).toBe(12_000);

    await expect(articles.createArticle(actor, { description: " ", unit: "Std.", unitPrice: 1, taxRate: 1900 })).rejects.toThrow(/Bezeichnung/);
    await expect(articles.updateArticle(actor, "00000000-0000-0000-0000-000000000000", { description: "x", unit: "Std.", unitPrice: 1, taxRate: 0 })).rejects.toThrow(/nicht gefunden/);
    const log = await sql`select action from audit_log where table_name = 'articles' and row_id = ${beratung.id} order by id`;
    expect(log.map((r) => r.action)).toEqual(["INSERT", "UPDATE", "UPDATE", "UPDATE"]);
  });
});
