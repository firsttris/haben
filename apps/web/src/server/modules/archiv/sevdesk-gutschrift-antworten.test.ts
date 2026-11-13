import { mapSevCreditNote, mapSevPaymentLogs, type SevCheckAccountTransactionLog, type SevCreditNote } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import gutschriften from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/gutschrift.json";
import zahlungen from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/gutschrift-zahlungen.json";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Anonymisierte Gutschriften aus Buchhaltungsversion 1.0, je eine je `bookingCategory`, dazu zwei bezahlte Honorar-Gutschriften
 * mit ihrer Zahlung aus `CheckAccountTransactionLog` (Auszahlung, `amountPaid` negativ). docs/sevdesk.md: Honorar und Provision
 * folgen der Buchung von sevDesk als Aufwand mit Vorsteuer (#472). Beträge maskiert.
 */

type Fixture = { creditNote: Record<string, unknown>; positions: unknown[] };
const notes = gutschriften as unknown as Fixture[];
const byCategory = (category: string) => notes.filter((n) => n.creditNote.bookingCategory === category);

describe.skipIf(!testDatabaseUrl)("Gutschriften aus sevDesk 1.0 mit Zahlungen (Postgres)", () => {
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

  beforeEach(() => reset("SKR03", "ist"));

  async function importAll() {
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const ids = new Map<string, string>();
    for (const n of notes) {
      const { voucher: v, payment } = mapSevCreditNote(n.creditNote as unknown as SevCreditNote, n.positions as never[]);
      const [row] =
        await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
        values (${v.lexofficeId}, 'sevdesk', ${importId}, ${v.type}, ${v.direction}, ${v.number}, ${v.date}, ${v.status}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(payment)}::jsonb, ${JSON.stringify({ ...n.creditNote, positions: n.positions })}::jsonb)
        returning id`;
      ids.set(v.lexofficeId, row!.id as string);
    }
    for (const [key, items] of mapSevPaymentLogs(zahlungen as unknown as SevCheckAccountTransactionLog[])) {
      const voucherId = ids.get(key);
      for (const item of items) {
        const log = (zahlungen as { id: string }[]).find((l) => l.id === item.sourceId);
        await sql`insert into legacy_voucher_payments (voucher_id, import_id, source, external_id, transaction_id, account_id, account_name, date, amount, raw)
          values (${voucherId!}, ${importId}, 'sevdesk', ${item.sourceId}, ${item.transactionId}, ${item.accountId}, 'Basiskonto', ${item.date}, ${item.amount}, ${JSON.stringify(log)}::jsonb)`;
      }
    }
    return ids;
  }

  const detail = async (ids: Map<string, string>, n: Fixture) => (await lexoffice.legacyVoucherDetail(ids.get(`creditnote/${n.creditNote.id}`)!))!.voucher;

  it("hat zu beiden bezahlten Honorar-Gutschriften genau eine Auszahlung", () => {
    const paid = [...byCategory("ROYALTY_ASSIGNED"), ...byCategory("ROYALTY_UNASSIGNED")];
    expect(paid.map((n) => n.creditNote.status)).toEqual(["1000", "1000"]);
    const logs = mapSevPaymentLogs(zahlungen as unknown as SevCheckAccountTransactionLog[]);
    for (const n of paid) {
      const items = logs.get(`creditnote/${n.creditNote.id}`) ?? [];
      expect(items).toHaveLength(1);
      expect(items[0]!.amount).toBeLessThan(0);
    }
  });

  it.each([["ROYALTY_ASSIGNED"], ["ROYALTY_UNASSIGNED"]])("führt die bezahlte %s als Ausgabe ohne offene Zahlungsfrage", async (category) => {
    const ids = await importAll();
    const v = await detail(ids, byCategory(category)[0]!);
    expect(v).toMatchObject({ type: "purchasecreditnote", direction: "ausgabe" });
    expect(v.gross).toBeGreaterThan(0);
    expect(v.paymentHistoryIssue).toBeNull();
    expect(v.payment?.items).toHaveLength(1);
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR03", "soll"],
    ["SKR04", "ist"],
    ["SKR04", "soll"],
  ])("sperrt bei %s und %s den Abgleich nicht wegen der Zahlungen", async (kontenrahmen, versteuerung) => {
    await reset(kontenrahmen, versteuerung);
    await importAll();
    const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2024)!;
    expect(year.vatIssue).toBeNull();
    expect(year.ausgaben.count).toBe(3);
  });

  it("führt ein Buchungskonto auf einem Aufwandskonto bis zur Kontoart weiter als Einnahme", async () => {
    const ids = await importAll();
    const aufwand = byCategory("ACCOUNTING_TYPE").find(
      (n) => (n.creditNote.accountingType as { name?: string } | undefined)?.name !== "Einnahmen / Erlöse / Verkäufe",
    )!;
    expect(await detail(ids, aufwand)).toMatchObject({ type: "creditnote", direction: "einnahme" });
  });

  it("bietet keine der Gutschriften als offenen Posten an", async () => {
    await importAll();
    expect(await legacy.openLegacyItems("2025-12-31")).toEqual([]);
  });
});
