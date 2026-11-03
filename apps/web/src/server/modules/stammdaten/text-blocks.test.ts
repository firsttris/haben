import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Textbausteine (Postgres)", () => {
  let blocks: typeof import("./text-blocks.ts");
  let contacts: typeof import("./contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    blocks = await import("./text-blocks.ts");
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate text_blocks, contact_versions, contacts cascade`;
  });

  it("legt Kopf- und Fußtexte an, ordnet sie Kunden zu, archiviert und protokolliert", async () => {
    const kunde = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "",
      plz: "",
      ort: "Hamburg",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const kopf = await blocks.createTextBlock(actor, {
      name: "Rahmenvertrag Phoenix",
      kind: "kopf",
      text: "  Gemäß Rahmenvertrag RV-2026-17, Bestellnummer 4500123456, berechnen wir:  ",
      contactId: kunde.id,
    });
    expect(kopf.text).toBe("Gemäß Rahmenvertrag RV-2026-17, Bestellnummer 4500123456, berechnen wir:");
    await blocks.createTextBlock(actor, { name: "Dank", kind: "fuss", text: "Vielen Dank für die gute Zusammenarbeit." });
    expect((await blocks.listTextBlocks()).map((b) => [b.kind, b.name, b.contactId])).toEqual([
      ["fuss", "Dank", null],
      ["kopf", "Rahmenvertrag Phoenix", kunde.id],
    ]);

    await blocks.updateTextBlock(actor, kopf.id, { name: "Rahmenvertrag Phoenix", kind: "kopf", text: "Neuer Text", contactId: null });
    await blocks.setTextBlockArchived(actor, kopf.id, true);
    expect((await blocks.listTextBlocks()).map((b) => b.name)).toEqual(["Dank"]);
    expect(await blocks.listTextBlocks({ archived: true })).toHaveLength(2);

    await expect(blocks.createTextBlock(actor, { name: " ", kind: "kopf", text: "x" })).rejects.toThrow(/Bezeichnung/);
    await expect(blocks.createTextBlock(actor, { name: "x", kind: "kopf", text: "x", contactId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(
      /Kontakt nicht gefunden/,
    );
    await expect(sql`insert into text_blocks (name, kind, text) values ('x', 'mitte', 'y')`).rejects.toThrow(/text_blocks_kind/);
    const log = await sql`select action from audit_log where table_name = 'text_blocks' and row_id = ${kopf.id} order by id`;
    expect(log.map((r) => r.action)).toEqual(["INSERT", "UPDATE", "UPDATE"]);
  });
});
