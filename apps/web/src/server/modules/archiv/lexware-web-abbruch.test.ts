import { readFileSync } from "node:fs";
import { zipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../../../../../packages/import/test-fixtures/lexoffice-web/${name}`, import.meta.url), "utf8"));
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** Ein Teil der Sicherung mit zwei Buchhaltungsbelegen ohne Dateien */
function backup() {
  const entries = ["purchase-gross.json", "purchase-creditnote-net.json"].map((name) => ({ ...(fixture(name) as { list: { entityId: string } }), files: [] }));
  return zipSync({
    "manifest.json": encode({ format: "haben-lexware-web", version: 1, part: 1, createdAt: "2026-11-02T10:00:00.000Z" }),
    "kontakte.json": encode(fixture("contacts.json")),
    ...Object.fromEntries(entries.map((e) => [`belege/${e.list.entityId}.json`, encode(e)])),
  });
}

describe.skipIf(!testDatabaseUrl)("Umzug über die Web-Oberfläche abbrechen (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("„Abbrechen“ hält die Übernahme einer Sicherung an und endet als abgebrochen", async () => {
    const id = await lexoffice.startWebImport("test-user", [{ name: "teil-01.zip", bytes: backup() }]);
    expect(lexoffice.cancelImport(id)).toBe(true);
    for (let i = 0; i < 100 && (await lexoffice.latestImport())?.status === "laeuft"; i++) await new Promise((r) => setTimeout(r, 50));
    const run = await lexoffice.latestImport();
    expect({ status: run!.status, imported: run!.progress.imported }).toEqual({ status: "abgebrochen", imported: 0 });
  });
});
