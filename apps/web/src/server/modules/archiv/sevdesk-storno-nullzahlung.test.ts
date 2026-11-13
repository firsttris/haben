import { mapSevInvoice, mapSevPaymentLogs, type SevCheckAccountTransactionLog, type SevInvoice } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import paar from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/storno-paar.json";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #472, Rückmeldung zum Storno von 2020: An der Stornorechnung hängt genau ein Eintrag aus `CheckAccountTransactionLog` mit
 * `amountPaid` 0 (als Zahl) und Statuswechsel 100 → 200; Geld ist nicht geflossen. sevDesk legt ihn beim Stornieren an. Ein
 * solcher Eintrag darf das Paar nicht als bezahlt ausweisen. Aufbau der Antworten aus `buchhaltung-2.0/storno-paar.json` und
 * `buchhaltung-1.0/gutschrift-zahlungen.json`, Kennungen und Tag erfunden.
 */

const PAY_DATE = "2025-04-10T15:42:00+02:00";

const log = (objectId: string, amountPaid: number | string): SevCheckAccountTransactionLog =>
  ({
    id: `LOG_${objectId}_${amountPaid}`,
    objectName: "CheckAccountTransactionLog",
    checkAccountTransaction: {
      id: "ID_90",
      objectName: "CheckAccountTransaction",
      valueDate: PAY_DATE,
      checkAccount: { id: "ID_91", objectName: "CheckAccount" },
      deletedAt: null,
    },
    fromStatus: "100",
    toStatus: "200",
    amountPaid,
    bookingDate: PAY_DATE,
    object: { id: objectId, objectName: "Invoice" },
  }) as unknown as SevCheckAccountTransactionLog;

describe.skipIf(!testDatabaseUrl)("sevDesk-Storno mit Zuordnung über 0 € (Postgres)", () => {
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

  async function insert(part: { invoice: unknown; positions: unknown[] }, change: Record<string, unknown> = {}) {
    const raw = { ...(part.invoice as Record<string, unknown>), ...change };
    const { voucher: v, payment } = mapSevInvoice(raw as unknown as SevInvoice, part.positions as never[]);
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const [row] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${v.lexofficeId}, 'sevdesk', ${importId}, ${v.type}, ${v.direction}, ${v.number}, ${v.date}, ${v.status}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(payment)}::jsonb, ${JSON.stringify({ ...raw, positions: part.positions })}::jsonb)
      returning id`;
    return row!.id as string;
  }

  async function insertLogs(ids: Map<string, string>, logs: SevCheckAccountTransactionLog[]) {
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    for (const [key, items] of mapSevPaymentLogs(logs)) {
      for (const item of items) {
        const raw = logs.find((l) => String(l.id) === item.sourceId);
        await sql`insert into legacy_voucher_payments (voucher_id, import_id, source, external_id, transaction_id, account_id, account_name, date, amount, raw)
          values (${ids.get(key)!}, ${importId}, 'sevdesk', ${item.sourceId}, ${item.transactionId}, ${item.accountId}, 'Basiskonto', ${item.date}, ${item.amount}, ${JSON.stringify(raw)}::jsonb)`;
      }
    }
  }

  const originalId = paar.original_storniert.invoice.id;
  const stornoId = paar.stornorechnung.invoice.id;

  async function insertPair(logs: SevCheckAccountTransactionLog[]) {
    const original = await insert(paar.original_storniert);
    const storno = await insert(paar.stornorechnung, { payDate: PAY_DATE });
    await insertLogs(
      new Map([
        [`invoice/${originalId}`, original],
        [`invoice/${stornoId}`, storno],
      ]),
      logs,
    );
    return { original, storno };
  }

  const status = async (id: string) => (await lexoffice.legacyVoucherDetail(id))!.voucher.payment?.status;

  it.each([
    ["SKR03", "ist"],
    ["SKR03", "soll"],
    ["SKR04", "ist"],
    ["SKR04", "soll"],
  ])("wertet das Paar bei %s und %s trotz Eintrag über 0 € an der Stornorechnung als storniert", async (kontenrahmen, versteuerung) => {
    await reset(kontenrahmen, versteuerung);
    const { original, storno } = await insertPair([log(stornoId, 0)]);
    expect(await status(original)).toBe("cancelled");
    expect(await status(storno)).toBe("cancelled");
    const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
    expect(year.vatIssue).toBeNull();
  });

  it("wertet auch einen Eintrag über 0 € als Text oder an der Rechnung nicht als Zahlung", async () => {
    const { original } = await insertPair([log(stornoId, "0.00"), log(originalId, 0)]);
    expect(await status(original)).toBe("cancelled");
    expect(await legacy.openLegacyItems("2025-12-31")).toEqual([]);
  });

  it("bleibt unklar, wenn ein Eintrag einen Betrag zuordnet", async () => {
    const { original, storno } = await insertPair([log(stornoId, 0), log(originalId, 100)]);
    expect(await status(original)).not.toBe("cancelled");
    expect(await status(storno)).not.toBe("cancelled");
  });

  // Aus dem TDD-Review: dieselbe Regel für eine gewöhnliche, voll bezahlte Rechnung mit belegter Zahlung
  async function paidInvoice(logs: SevCheckAccountTransactionLog[]) {
    const id = await insert(paar.original_storniert, { payDate: PAY_DATE, paidAmount: "100.00" });
    await insertLogs(new Map([[`invoice/${originalId}`, id]]), logs);
    return id;
  }

  it.each([
    ["SKR03", "ist"],
    ["SKR03", "soll"],
    ["SKR04", "ist"],
    ["SKR04", "soll"],
  ])("macht bei %s und %s eine bezahlte Rechnung mit zusätzlicher Zuordnung über 0 € nicht unklar", async (kontenrahmen, versteuerung) => {
    await reset(kontenrahmen, versteuerung);
    const id = await paidInvoice([log(originalId, 100), log(originalId, 0)]);
    expect((await lexoffice.legacyVoucherDetail(id))!.voucher.paymentHistoryIssue).toBeNull();
    expect((await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!.vatIssue).toBeNull();
  });

  it("führt bei Ist die Zahlung im Monat, ohne den Eintrag über 0 €", async () => {
    const id = await paidInvoice([log(originalId, 100), log(originalId, 0)]);
    const { vouchers } = await lexoffice.legacyVouchersForPeriod({ period: "2025-04", direction: "alle", search: "", withPayments: true, limit: 100 });
    expect(vouchers.find((v) => v.id === id)!.payments).toEqual([{ date: "2025-04-10", amount: 10_000 }]);
  });
});
