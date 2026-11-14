import { ARTICLE_FIELDS, readCsvTable, suggestMapping } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Eigene Mengeneinheiten (#748): anlegen mit Bezeichnung und Code nach UN/ECE Rec. 20/21, nie löschen oder umbenennen, nur
 * archivieren. Die Codes gelten auch für archivierte Einheiten, damit ältere Entwürfe ihre E-Rechnung behalten.
 */
describe.skipIf(!testDatabaseUrl)("Eigene Einheiten (Postgres)", () => {
  let sql: postgres.Sql;
  let units: typeof import("./units.ts");
  let articles: typeof import("./articles.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    units = await import("./units.ts");
    articles = await import("./articles.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate articles, units cascade`;
  });

  it("legt eine Einheit mit Code an und liefert sie für Auswahl und E-Rechnung", async () => {
    const ue = await units.createUnit(actor, { label: " UE ", code: "c62" });
    expect(ue).toMatchObject({ label: "UE", code: "C62", archivedAt: null });
    expect((await units.listUnits()).map((u) => u.label)).toEqual(["UE"]);
    expect(await units.loadUnitCodes()).toEqual({ UE: "C62" });
  });

  it("lehnt doppelte, feste und ungültige Einheiten ab", async () => {
    await units.createUnit(actor, { label: "m²", code: "MTK" });
    await expect(units.createUnit(actor, { label: "M²", code: "MTK" })).rejects.toThrow("gibt es schon");
    await expect(units.createUnit(actor, { label: "Std.", code: "HUR" })).rejects.toThrow("gibt es schon");
    await expect(units.createUnit(actor, { label: "qm", code: "QM" })).rejects.toThrow("UN/ECE");
    await expect(units.createUnit(actor, { label: "", code: "C62" })).rejects.toThrow("Bezeichnung fehlt");
  });

  it("archiviert und stellt wieder her; archivierte behalten ihren Code und blockieren die Bezeichnung", async () => {
    const lfm = await units.createUnit(actor, { label: "lfm", code: "LM" });
    await units.setUnitArchived(actor, lfm.id, true);
    expect((await units.listUnits()).find((u) => u.label === "lfm")?.archivedAt).not.toBeNull();
    expect(await units.loadUnitCodes()).toEqual({ lfm: "LM" });
    await expect(units.createUnit(actor, { label: "lfm", code: "MTR" })).rejects.toThrow("gibt es schon");
    await units.setUnitArchived(actor, lfm.id, false);
    expect((await units.listUnits()).find((u) => u.label === "lfm")?.archivedAt).toBeNull();
  });

  it("prüft Einheiten von Artikeln: fest, eigene oder unbekannt", async () => {
    await units.createUnit(actor, { label: "UE", code: "C62" });
    await expect(units.assertKnownUnit("Std.")).resolves.toBeUndefined();
    await expect(units.assertKnownUnit("UE")).resolves.toBeUndefined();
    await expect(units.assertKnownUnit("Karton")).rejects.toThrow("Einheit „Karton“");
  });

  it("steht im Änderungsprotokoll und lässt sich nicht per TRUNCATE leeren", async () => {
    await units.createUnit(actor, { label: "kg", code: "KGM" });
    const [row] = await sql`select actor, new_value from audit_log where table_name = 'units' order by id desc limit 1`;
    expect(row).toMatchObject({ actor, new_value: expect.objectContaining({ label: "kg", code: "KGM" }) });
    await expect(sql`truncate units`).rejects.toThrow(/geleert/);
  });

  it("lässt Bezeichnung und Code nicht ändern und nichts löschen", async () => {
    const t = await units.createUnit(actor, { label: "t", code: "TNE" });
    await expect(sql`update units set label = 'to' where id = ${t.id}`).rejects.toThrow(/wie angelegt/);
    await expect(sql`update units set code = 'KGM' where id = ${t.id}`).rejects.toThrow(/wie angelegt/);
    await expect(sql`delete from units where id = ${t.id}`).rejects.toThrow(/archiviert/);
  });

  it("ein Artikel nimmt feste und eigene Einheiten, keine unbekannten", async () => {
    await units.createUnit(actor, { label: "UE", code: "C62" });
    expect((await articles.createArticle(actor, { description: "Nachhilfe", unit: "UE", unitPrice: 2_500, taxRate: 0 })).unit).toBe("UE");
    expect((await articles.createArticle(actor, { description: "Beratung", unit: "Std.", unitPrice: 9_500, taxRate: 1900 })).unit).toBe("Std.");
    await expect(articles.createArticle(actor, { description: "Kiste", unit: "Karton", unitPrice: 100, taxRate: 1900 })).rejects.toThrow("Einheit „Karton“");
  });

  // Review: „toString“ ist weder fest noch angelegt; die Zeile gehört schon im Plan zu den Fehlern
  it("meldet im CSV-Import eine unbekannte Einheit wie „toString“ schon im Plan als Fehler", async () => {
    const csv = await import("./csv-import.ts");
    const { db } = await import("../../db/index.ts");
    const read = readCsvTable(new TextEncoder().encode("Bezeichnung;Einheit;Nettopreis;Umsatzsteuer\nBeratung;toString;95,00;19\n"), {
      encoding: "auto",
      delimiter: "auto",
    });
    if (!read.ok) throw new Error(read.error);
    const plan = await csv.planArticleImport(db, read.table, suggestMapping(read.table.header, ARTICLE_FIELDS));
    expect(plan[0]!.status).toBe("fehler");
    expect(plan[0]!.message).toMatch(/Einheit/);
  });
});
