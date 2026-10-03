import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Pauschalen (Postgres)", () => {
  let pauschalen: typeof import("./pauschalen.ts");
  let annual: typeof import("./annual.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const today = "2026-10-03";

  beforeAll(async () => {
    sql = await setupTestDb();
    pauschalen = await import("./pauschalen.ts");
    annual = await import("./annual.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate pauschalen, asset_depreciations, assets, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, company cascade`;
    await sql`insert into company (id, name, versteuerung, kontenrahmen, bundesland) values (1, 'Testfirma', 'ist', 'SKR03', 'BW')`;
  });

  const linesOf = async (journalEntryId: string) =>
    (await sql`select e.date::text as date, e.locked_at is not null as locked, l.account, l.debit, l.credit from journal_lines l
      join journal_entries e on e.id = l.entry_id where e.id = ${journalEntryId} order by l.debit desc`).map((r) => ({ ...r }));

  it("bucht Homeoffice-Tage zum Monatsende an Privateinlage", async () => {
    const row = await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-03", tage: 12 }, today);
    expect(row).toMatchObject({ art: "homeoffice", date: "2026-03-31", amount: 7200, details: { tage: 12 } });
    expect(await linesOf(row.journalEntryId)).toEqual([
      { date: "2026-03-31", locked: true, account: "4288", debit: 7200, credit: 0 },
      { date: "2026-03-31", locked: true, account: "1890", debit: 0, credit: 7200 },
    ]);
  });

  it("hält Monats- und Jahresgrenze der Homeoffice-Tage ein", async () => {
    await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-02", tage: 20 }, today);
    await expect(pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-02", tage: 9 }, today)).rejects.toThrow(/nur 28 Tage/);
    for (const month of ["01", "03", "04", "05", "06", "07", "08", "09"]) {
      await pauschalen.createPauschale(actor, { art: "homeoffice", month: `2026-${month}`, tage: 23 }, today);
    }
    // 20 + 8 × 23 = 204 Tage; 7 weitere wären 211
    await expect(pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-10", tage: 7 }, today)).rejects.toThrow(/höchstens 210 Tage/);
    await expect(pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-11", tage: 1 }, today)).rejects.toThrow(/Zukunft/);
    await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-10", tage: 6 }, today);
    const list = await pauschalen.listPauschalen(2026);
    expect(list.homeoffice).toEqual({ tage: 210, maxTage: 210, proTag: 600 });
    expect(list.totals.homeoffice).toBe(126_000);
    await expect(pauschalen.createPauschale(actor, { art: "homeoffice", month: "2019-05", tage: 1 }, today)).rejects.toThrow(/erst ab 2020/);
  });

  it("rechnet Fahrten hin und zurück und Verpflegung mit gestellten Mahlzeiten", async () => {
    const fahrt = await pauschalen.createPauschale(
      actor,
      { art: "fahrt", date: "2026-04-14", description: "Workshop Kunde, Karlsruhe", km: 42.5, fahrzeug: "pkw", hinUndZurueck: true },
      today,
    );
    expect(fahrt.amount).toBe(2550);
    expect((await linesOf(fahrt.journalEntryId)).map((l) => l.account)).toEqual(["4673", "1890"]);

    const verpflegung = await pauschalen.createPauschale(
      actor,
      { art: "verpflegung", date: "2026-04-15", description: "Kundenprojekt München", tag: "ganztag", fruehstueck: true },
      today,
    );
    expect(verpflegung.amount).toBe(2240);
    await expect(
      pauschalen.createPauschale(actor, { art: "verpflegung", date: "2026-04-16", description: "München", tag: "abreise", mittag: true, abend: true }, today),
    ).rejects.toThrow(/keine Pauschale/);
  });

  it("storniert per Gegenzeile und Gegenbuchung, nur einmal", async () => {
    const row = await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-05", tage: 10 }, today);
    await pauschalen.reversePauschale(actor, row.id);
    await expect(pauschalen.reversePauschale(actor, row.id)).rejects.toThrow(/bereits storniert/);

    const [reversal] = await sql`select * from pauschalen where reverses_id = ${row.id}`;
    expect(reversal).toMatchObject({ amount: -6000, date: "2026-05-31" });
    expect(await linesOf(reversal!.journal_entry_id)).toEqual([
      { date: "2026-05-31", locked: true, account: "1890", debit: 6000, credit: 0 },
      { date: "2026-05-31", locked: true, account: "4288", debit: 0, credit: 6000 },
    ]);
    await expect(pauschalen.reversePauschale(actor, reversal!.id)).rejects.toThrow(/nicht gefunden/);

    const list = await pauschalen.listPauschalen(2026);
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]).toMatchObject({ id: row.id, storniert: true });
    expect(list.homeoffice.tage).toBe(0);
    expect(list.totals.homeoffice).toBe(0);
    // Die stornierten Tage sind wieder frei
    await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-05", tage: 31 }, today);
  });

  it("ist nur anzuhängen", async () => {
    const row = await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-01", tage: 3 }, today);
    await expect(sql`update pauschalen set amount = 1 where id = ${row.id}`).rejects.toThrow();
    await expect(sql`delete from pauschalen where id = ${row.id}`).rejects.toThrow();
  });

  it("landet in den Zeilen der Anlage EÜR und als Einlage", async () => {
    await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-03", tage: 10 }, today);
    await pauschalen.createPauschale(
      actor,
      { art: "fahrt", date: "2026-03-10", description: "Kunde", km: 100, fahrzeug: "pkw", hinUndZurueck: false },
      today,
    );
    await pauschalen.createPauschale(actor, { art: "verpflegung", date: "2026-03-10", description: "Kunde", tag: "eintaegig" }, today);
    const storno = await pauschalen.createPauschale(actor, { art: "verpflegung", date: "2026-03-11", description: "Kunde", tag: "eintaegig" }, today);
    await pauschalen.reversePauschale(actor, storno.id);

    const euer = await annual.euerYear(2026);
    expect(euer.figures).toMatchObject({ tagespauschale: 6000, fahrtNutzungseinlage: 3000, verpflegung: 1400, einlagen: 10_400 });
    expect(euer.ausgaben).toBe(10_400);
    expect(euer.gewinn).toBe(-10_400);
  });
});
