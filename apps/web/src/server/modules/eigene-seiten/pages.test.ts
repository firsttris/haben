import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Eigene Seiten (Postgres)", () => {
  let pages: typeof import("./pages.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    pages = await import("./pages.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate custom_pages`;
  });

  it("legt Seiten an, sortiert sie nach Name, ändert und löscht sie und protokolliert jede Änderung", async () => {
    const bestellungen = await pages.createCustomPage(actor, { name: " Bestellungen ", url: " https://n8n.example.de/webhook/bestellungen " });
    expect(bestellungen).toMatchObject({ name: "Bestellungen", url: "https://n8n.example.de/webhook/bestellungen" });
    const lager = await pages.createCustomPage(actor, { name: "Lager", url: "http://192.168.1.20:5678/lager" });
    await pages.updateCustomPage(actor, lager.id, { name: "Abholung", url: "http://192.168.1.20:5678/abholung" });
    expect((await pages.listCustomPages()).map((p) => [p.name, p.url])).toEqual([
      ["Abholung", "http://192.168.1.20:5678/abholung"],
      ["Bestellungen", "https://n8n.example.de/webhook/bestellungen"],
    ]);
    expect(await pages.getCustomPage(bestellungen.id)).toMatchObject({ name: "Bestellungen" });

    await pages.deleteCustomPage(actor, bestellungen.id);
    expect(await pages.getCustomPage(bestellungen.id)).toBeNull();

    const log = await sql<{ action: string; actor: string }[]>`select action, actor from audit_log where table_name = 'custom_pages' order by seq`;
    expect(log.map((row) => row.action)).toEqual(["INSERT", "INSERT", "UPDATE", "DELETE"]);
    expect(log.every((row) => row.actor === actor)).toBe(true);
  });

  it("weist ungültige Eingaben mit deutscher Meldung ab", async () => {
    await expect(pages.createCustomPage(actor, { name: " ", url: "https://n8n.example.de/" })).rejects.toThrow(/Name fehlt/);
    await expect(pages.createCustomPage(actor, { name: "x".repeat(41), url: "https://n8n.example.de/" })).rejects.toThrow(/40 Zeichen/);
    await expect(pages.createCustomPage(actor, { name: "Skript", url: "javascript:alert(1)" })).rejects.toThrow(pages.CustomPageError);
    // test-db.ts setzt BETTER_AUTH_URL auf http://localhost:3000
    await expect(pages.createCustomPage(actor, { name: "Haben", url: "http://localhost:3000/bank" })).rejects.toThrow(/anderen Adresse/);
    await expect(pages.updateCustomPage(actor, "00000000-0000-0000-0000-000000000000", { name: "x", url: "https://n8n.example.de/" })).rejects.toThrow(
      /nicht gefunden/,
    );
    await expect(pages.deleteCustomPage(actor, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/nicht gefunden/);
    expect(await pages.listCustomPages()).toEqual([]);
  });
});
