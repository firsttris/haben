import { mapSevCreditNote, type SevCreditNote } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import gutschriften from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/gutschrift-kategorien.json";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Gutschriften aus Buchhaltungsversion 2.0 (#472): Provision und Honorar mit `taxRule` 9 am Kopf, `taxRate` 0 am Kopf und
 * 19 % an den Positionen, fertiggestellt und nicht bezahlt. sevDesk bucht sie wie in 1.0 im Soll des Aufwandskontos mit BU 9
 * (DATEV-Export in den Fixtures); Haben folgt dem wie bei 1.0 (docs/sevdesk.md).
 */

type Fixture = { creditNote: Record<string, unknown>; positions: unknown[] };
const notes = gutschriften as unknown as Fixture[];
const byCategory = (category: string) => notes.find((n) => n.creditNote.bookingCategory === category)!;

describe.skipIf(!testDatabaseUrl)("Gutschriften aus sevDesk 2.0 (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: string, versteuerung: string) {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await leeren(sql)`truncate legacy_voucher_payments, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk')`;
  }

  async function importAll() {
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const ids = new Map<string, string>();
    for (const n of notes) {
      const { voucher: v, payment } = mapSevCreditNote(n.creditNote as unknown as SevCreditNote, n.positions as never[]);
      const [row] =
        await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
        values (${v.lexofficeId}, 'sevdesk', ${importId}, ${v.type}, ${v.direction}, ${v.number}, ${v.date}, ${v.status}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(payment)}::jsonb, ${JSON.stringify({ ...n.creditNote, positions: n.positions })}::jsonb)
        returning id`;
      ids.set(String(n.creditNote.bookingCategory), row!.id as string);
    }
    return ids;
  }

  const year = async () => (await lexoffice.reconciliation()).years.find((y) => y.year === 2026)!;

  it.each([
    ["SKR03", "ist"],
    ["SKR03", "soll"],
    ["SKR04", "ist"],
    ["SKR04", "soll"],
  ])("zählt bei %s und %s Provision und Honorar als Ausgabe mit Vorsteuer", async (kontenrahmen, versteuerung) => {
    await reset(kontenrahmen, versteuerung);
    await importAll();
    const y = await year();
    expect(y.vatIssue).toBeNull();
    expect(y.ausgaben).toMatchObject({ net: 200, tax: 38, gross: 238 });
    expect(y.einnahmen).toMatchObject({ count: 0, gross: 0 });
    expect(y.vat).toHaveLength(1);
    expect(y.vat[0]).toMatchObject({ kz66: 38, kz81: 0, tax81: 0 });
  });

  it.each([["PROVISION"], ["ROYALTY_ASSIGNED"]])("zeigt %s in Detail und Zeitraum als Ausgabe-Gutschrift mit 19 %", async (category) => {
    await reset("SKR03", "ist");
    const id = (await importAll()).get(category)!;
    const detail = (await lexoffice.legacyVoucherDetail(id))!.voucher;
    expect(detail).toMatchObject({ type: "purchasecreditnote", direction: "ausgabe", net: 100, tax: 19, gross: 119 });
    expect(detail.taxes).toEqual([{ rate: 1900, net: 100, tax: 19 }]);
    const period = await lexoffice.legacyVouchersForPeriod({ period: "2026-11", direction: "ausgabe", search: "", withPayments: false, limit: 10 });
    expect(period.vouchers.find((v) => v.id === id)).toMatchObject({ net: 100, tax: 19, gross: 119 });
  });

  it("führt die Gutschrift über 0 € als Ausgabe-Gutschrift ohne Betrag", async () => {
    await reset("SKR03", "ist");
    const id = (await importAll()).get("ROYALTY_UNASSIGNED")!;
    expect((await lexoffice.legacyVoucherDetail(id))!.voucher).toMatchObject({ type: "purchasecreditnote", direction: "ausgabe", gross: 0 });
    expect(byCategory("ROYALTY_UNASSIGNED").creditNote.sumGross).toBe("0");
  });

  it("bietet keine der offenen Gutschriften als offenen Posten an", async () => {
    await reset("SKR03", "ist");
    await importAll();
    expect(await legacy.openLegacyItems("2026-11-12")).toEqual([]);
  });
});
