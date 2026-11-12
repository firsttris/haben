import { mapSevInvoice, type SevInvoice } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import paar from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/storno-paar.json";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const PAY_DATE = "2025-04-10T15:42:00+02:00";

describe.skipIf(!testDatabaseUrl)("Review #472: Stornorechnung mit payDate", () => {
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
  const status = async (id: string) => (await lexoffice.legacyVoucherDetail(id))!.voucher.payment?.status;

  it.each([
    ["Zahl 0", 0, true],
    ["Text 0", "0", true],
    ["Text 0,00", "0,00", true],
    ["Text 0.00", "0.00", true],
    ["leer", "", false],
    ["fehlt", undefined, false],
    ["null", null, false],
    ["Text 0.01", "0.01", false],
    ["Zahl 1", 1, false],
  ])("paidAmount %s mit payDate an der SR", async (_n, paidAmount, cancelled) => {
    const original = await insert(paar.original_storniert);
    const storno = await insert(paar.stornorechnung, { payDate: PAY_DATE, paidAmount });
    expect((await status(original)) === "cancelled").toBe(cancelled);
    expect((await status(storno)) === "cancelled").toBe(cancelled);
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ])("Storno mit payDate nach dem Stichtag: Original offen mit Grund (%s, %s)", async (k, v) => {
    await reset(k, v);
    const original = await insert(paar.original_storniert);
    await insert(paar.stornorechnung, { payDate: PAY_DATE });
    const items = await legacy.openLegacyItems("2025-04-09");
    expect(items.map((i) => [i.id, i.blocker?.includes("Storno nach dem Stichtag")])).toEqual([[original, true]]);
  });

  it("Storno mit payDate am Stichtag: nichts offen", async () => {
    await insert(paar.original_storniert);
    await insert(paar.stornorechnung, { payDate: PAY_DATE });
    expect(await legacy.openLegacyItems("2025-04-10")).toEqual([]);
  });

  it("Storno mit payDate und belegter Einzelzahlung bleibt unklar", async () => {
    const original = await insert(paar.original_storniert);
    const storno = await insert(paar.stornorechnung, { payDate: PAY_DATE });
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    await sql`insert into legacy_voucher_payments (voucher_id, import_id, source, external_id, date, amount, raw)
      values (${storno}, ${importId}, 'sevdesk', 'x1', '2025-04-10', -10000, '{}'::jsonb)`;
    expect(await status(original)).not.toBe("cancelled");
    expect(await status(storno)).not.toBe("cancelled");
  });

  it("Zwei volle Stornos zu einer Rechnung, eins mit payDate: höchstens ein Paar storniert", async () => {
    const original = await insert(paar.original_storniert);
    const s1 = await insert(paar.stornorechnung);
    const s2 = await insert(paar.stornorechnung, { id: "ID_10", invoiceNumber: "<anon2>", payDate: PAY_DATE });
    const states = await Promise.all([original, s1, s2].map(status));
    expect(states.filter((s) => s === "cancelled").length).toBeLessThanOrEqual(2);
  });

  it("Zwei volle Stornos ohne payDate (Vergleich): höchstens ein Paar storniert", async () => {
    const original = await insert(paar.original_storniert);
    const s1 = await insert(paar.stornorechnung);
    const s2 = await insert(paar.stornorechnung, { id: "ID_10", invoiceNumber: "<anon2>" });
    const states = await Promise.all([original, s1, s2].map(status));
    expect(states.filter((s) => s === "cancelled").length).toBeLessThanOrEqual(2);
  });

  it("Zwei volle Stornos, eins mit payDate: Ist-Abgleich nicht stillschweigend frei mit falschem Umsatz", async () => {
    await insert(paar.original_storniert);
    await insert(paar.stornorechnung);
    await insert(paar.stornorechnung, { id: "ID_10", invoiceNumber: "<anon2>", payDate: PAY_DATE });
    const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
    const kz81 = year.vat.reduce((s, m) => s + m.kz81, 0);
    console.log("REVIEW", JSON.stringify({ vatIssue: year.vatIssue, kz81, months: year.vat.filter((m) => m.kz81 !== 0) }));
    expect(year.vatIssue).not.toBeNull();
  });

  it.each([["ist"], ["soll"]])("SR mit payDate ohne paidAmount: Ist sperrt, Soll nicht (%s)", async (v) => {
    await reset("SKR04", v);
    await insert(paar.original_storniert);
    await insert(paar.stornorechnung, { payDate: PAY_DATE, paidAmount: null });
    const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
    expect(year.vatIssue !== null).toBe(v === "ist");
  });

  it("SR-Detail ohne Zahlungstag und ohne Hinweis", async () => {
    await insert(paar.original_storniert);
    const storno = await insert(paar.stornorechnung, { payDate: PAY_DATE });
    const d = (await lexoffice.legacyVoucherDetail(storno))!.voucher;
    expect(d.payment?.paidDate ?? null).toBeNull();
    expect(d.paymentHistoryIssue).toBeNull();
  });
});
