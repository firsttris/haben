import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * docs/sevdesk.md: Das Stornopaar gilt nur, „wenn zu beiden keine Zahlung besteht; sonst
 * bleibt der Stand unklar“ (#472). settledOn liest payDate laut sevDesk-OpenAPI als „the date the end-customer has paid the invoice“.
 */

const BALANCED = { status: "balanced", openAmount: 0, paidDate: null, items: [] };

describe.skipIf(!testDatabaseUrl)("sevDesk-Stornopaar mit Zahlungstag (Postgres)", () => {
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

  beforeEach(async () => {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await sql`truncate journal_lines, journal_entries, document_amounts, documents, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist', 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
  });

  async function insert(id: string, type: string, number: string, date: string, gross: number, raw: Record<string, unknown>) {
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const tax = Math.round((gross * 19) / 119);
    const [created] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${`invoice/${id}`}, 'sevdesk', ${importId}, ${type}, 'einnahme', ${number}, ${date}, 'paid', ${gross - tax}, ${tax}, ${gross},
        ${JSON.stringify([{ rate: 1900, net: gross - tax, tax }])}::jsonb, '[]'::jsonb, ${JSON.stringify(BALANCED)}::jsonb,
        ${JSON.stringify({ id, objectName: "Invoice", status: "1000", ...raw })}::jsonb)
      returning id`;
    return created!.id as string;
  }

  const stornoRaw = { invoiceType: "SR", paidAmount: 0, payDate: null, origin: { id: "11", objectName: "Invoice" } };

  it.each([
    ["paidAmount 0", 0],
    ["ohne paidAmount", null],
  ])("wertet eine Rechnung mit payDate nicht als unbezahlt storniert (%s)", async (_name, paidAmount) => {
    const id = await insert("11", "invoice", "RE-2025-0001", "2025-04-08", 11_900, {
      invoiceType: "RE",
      paidAmount,
      payDate: "2025-04-09T00:00:00+02:00",
    });
    await insert("12", "creditnote", "RE-2025-0002", "2025-04-10", -11_900, stornoRaw);
    const detail = await lexoffice.legacyVoucherDetail(id);
    expect(detail!.voucher.payment?.status).not.toBe("cancelled");
    expect(detail!.voucher.paymentHistoryIssue).toMatch(/Zahlungshistorie unvollständig/);
  });

  it("wertet auch einen Zahlungstag an der Stornorechnung als Zahlung", async () => {
    const id = await insert("11", "invoice", "RE-2025-0001", "2025-04-08", 11_900, { invoiceType: "RE", paidAmount: 0, payDate: null });
    await insert("12", "creditnote", "RE-2025-0002", "2025-04-10", -11_900, { ...stornoRaw, payDate: "2025-04-11T00:00:00+02:00" });
    expect((await lexoffice.legacyVoucherDetail(id))!.voucher.payment?.status).not.toBe("cancelled");
  });

  it("sperrt bei Ist-Versteuerung den Abgleich, solange die Zahlung am payDate nicht geklärt ist", async () => {
    await insert("11", "invoice", "RE-2025-0001", "2025-04-08", 11_900, { invoiceType: "RE", paidAmount: 0, payDate: "2025-04-09T00:00:00+02:00" });
    await insert("12", "creditnote", "RE-2025-0002", "2025-04-10", -11_900, stornoRaw);
    const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
    expect(year.vatIssue).not.toBeNull();
  });

  it("Storno am Stichtag selbst lässt keinen offenen Posten", async () => {
    await insert("11", "invoice", "RE-2025-0001", "2025-04-08", 11_900, { invoiceType: "RE", paidAmount: 0, payDate: null });
    await insert("12", "creditnote", "RE-2025-0002", "2025-04-30", -11_900, stornoRaw);
    expect(await legacy.openLegacyItems("2025-04-30")).toEqual([]);
  });

  it("Paar ohne paidAmount und ohne payDate bleibt storniert", async () => {
    const id = await insert("11", "invoice", "RE-2025-0001", "2025-04-08", 11_900, { invoiceType: "RE", paidAmount: null, payDate: null });
    await insert("12", "creditnote", "RE-2025-0002", "2025-04-10", -11_900, { ...stornoRaw, paidAmount: null });
    expect((await lexoffice.legacyVoucherDetail(id))!.voucher.payment?.status).toBe("cancelled");
  });
});
