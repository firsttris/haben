import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { taxDetails, turnoverFixtures } from "../../../test-fixtures/gesamtumsatz.ts";

describe.skipIf(!testDatabaseUrl)("Gesamtumsatz: weitere Quellen und Herkunftsgrenzen (Postgres)", () => {
  let sql: postgres.Sql;
  let read: typeof import("./gesamtumsatz.ts");
  let f: Awaited<ReturnType<typeof turnoverFixtures>>;
  beforeAll(async () => {
    sql = await setupTestDb();
    read = await import("./gesamtumsatz.ts");
  }, 30_000);
  beforeEach(async () => {
    f = await turnoverFixtures(sql);
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("zählt Kfz-Wertabgabe mit USt-Basis statt der kleineren Elektro-EÜR-Entnahme", async () => {
    await sql`insert into assets (name, kind, method, account, acquisition_date, cost, useful_life_months, private_use)
      values ('Elektroauto', 'kfz', 'linear', '0320', '2026-12-10', 5000000, 72,
        '{"listPrice":5890000,"drive":"elektro","rate":25,"vat":true}')`;
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 47_120, complete: true });
    expect(result.items).toContainEqual(expect.objectContaining({ source: "privateUse", occurredOn: "2026-12-31", net: 47_120 }));
  });
  it("erfindet bei fehlenden Rechnungssteuerzeilen keinen Netto-Zufluss von null", async () => {
    const invoice = await f.invoice();
    await sql`delete from invoice_taxes where invoice_id = ${invoice}`;
    await f.allocate(await f.transaction(11_900), invoice, 11_900);
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: false });
  });
  it("liest echte Kassenrechnungszahlung mit gespeichertem Anteil und negativer Gegenzeile", async () => {
    const invoice = await f.invoice();
    await sql`update invoices set status = 'final', number = ${crypto.randomUUID()}, locked_at = now() where id = ${invoice}`;
    const original = await f.cash(3_967, "2025-12-30", {
      kind: "rechnung",
      invoice_id: invoice,
      tax_treatment: null,
      tax_rate: null,
      tax_shares: JSON.stringify([{ rate: 1900, base: 3334, tax: 633 }]),
      tax_shares_invoice_id: invoice,
    });
    await f.cash(-3_967, "2026-01-05", { kind: "rechnung", invoice_id: invoice, tax_treatment: null, tax_rate: null, reverses_id: original });
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: -3_334, complete: true });
    expect(result.items[0]).toMatchObject({ occurredOn: "2026-01-05", basisSource: "stored" });
  });
  it("übernimmt bei Rückzahlung auf eine Korrektur die ursprüngliche Umsatzklassifikation", async () => {
    const original = await f.invoice("steuerfrei", 10_000, 0, taxDetails({ exemption: { number: "14", letter: "a" } }));
    const correction = await f.invoice("kleinunternehmer", -2_000, 0);
    await sql`update invoices set corrects_id = ${original} where id = ${correction}`;
    await f.allocate(await f.transaction(-2_000), correction, -2_000);
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: true });
  });
  it("hält §-4-Hilfsumsätze ohne eigenständige Zuordnung ungeklärt", async () => {
    const invoice = await f.invoice("steuerfrei", 2_500, 0, taxDetails({ exemption: { number: "8", letter: "a" } }));
    await f.allocate(await f.transaction(2_500), invoice, 2_500);
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: false });
  });
  it("beachtet denselben expliziten Kontenausschluss bei offenen Bankbeträgen", async () => {
    await f.transaction(1_000);
    await sql`update bank_accounts set excluded_at = now() where id = ${f.accountId}`;
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: true, items: [] });
  });
  it("liest innerhalb einer übergebenen Transaktion ihren noch nicht abgeschlossenen Stand", async () => {
    const { withActor } = await import("../../db/actor.ts");
    const { schema } = await import("../../db/index.ts");
    await withActor("umsatztest", async (tx) => {
      await tx
        .insert(schema.cashEntries)
        .values({ number: 1, date: "2026-12-01", amount: 1_000, kind: "einnahme", text: "Transaktion", taxTreatment: "kleinunternehmer", taxRate: 0 });
      expect(await read.gesamtumsatzForYear(2026, tx)).toMatchObject({ included: 1_000, complete: true });
    });
  });
  it("zählt einen Kassenimportspiegel nicht ein zweites Mal als Nebenbucheinnahme", async () => {
    const entry = await f.journal("import", crypto.randomUUID(), [
      { account: "1000", debit: 1_000, credit: 0, taxCode: null },
      { account: "8195", debit: 0, credit: 1_000, taxCode: "KU" },
    ]);
    await f.cash(1_000, "2026-11-05", { kind: "import", tax_treatment: null, tax_rate: null, journal_entry_id: entry });
    const result = await read.gesamtumsatzForYear(2026);
    expect(result.items.filter((item) => item.source === "cash")).toHaveLength(0);
    expect(result.items.filter((item) => item.source === "journal")).toHaveLength(1);
    expect(result.complete).toBe(false);
  });
});
