import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const stack = (rows: string[]) => {
  const header = `"EXTF";700;21;"Buchungsstapel";13;20260102120000000;;"SD";"";"";1001;12345;20250101;4;20250101;20251231;"sevDesk";"";1;0;0;"EUR";;"";;;"03";;;"";""`;
  const columns = `Umsatz;Soll-/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basisumsatz;WKZ Basisumsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext`;
  return new TextEncoder().encode([header, columns, ...rows].join("\r\n"));
};

const INTERNAL_ID = "1f2e3d4c-5b6a-4789-8abc-0123456789ab";
const LONG = "EBA-BG-EUR-24-10001-2000001-30001-40001";

describe.skipIf(!testDatabaseUrl)("Review #472", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  let archive: typeof import("./archive.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    archive = await import("./archive.ts");
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
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports,
      contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist', 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
  });

  async function voucher(id: string, number: string, creditDebit = "C", date = "2025-01-01", gross = 119) {
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const [row] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${`voucher/${id}`}, 'sevdesk', ${importId}, 'purchaseinvoice', 'ausgabe', ${number}, ${date}, 'open', 100, 19, ${gross},
        ${JSON.stringify([{ rate: 1900, net: 100, tax: 19 }])}::jsonb, '[]'::jsonb, ${JSON.stringify({ status: "open", openAmount: gross, paidDate: null, items: [] })}::jsonb,
        ${JSON.stringify({ id, objectName: "Voucher", creditDebit })}::jsonb) returning id`;
    return row!.id as string;
  }

  const upload = (rows: string[]) =>
    archive.addArchiveFile("test-user", { bytes: stack(rows), filename: "EXTF_Buchungsstapel_2025.csv", kind: "datev", year: null });

  const year2025 = async () => (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;

  it("findet den Beleg, wenn die Kürzung auf 36 Zeichen an einem Leerzeichen beginnt", async () => {
    // Die letzten 36 Zeichen beginnen mit dem Leerzeichen; der DATEV-Parser schneidet es ab, im Feld stehen dann 35
    const number = "EBA-SG INVOICE-1234567890-ABCDEFG-HIJKLMNO";
    expect(number.slice(-36).startsWith(" ")).toBe(true);
    await voucher("501", number);
    await upload([`1,00;"H";"EUR";;;;70001;4390;"9";0101;"${number.slice(-36)}";"";;"gekürzt"`]);
    expect((await year2025()).bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 0 });
  });

  it("findet den Beleg über die gekürzte Belegnummer aus dem Buchungsstapel", async () => {
    await voucher("501", LONG);
    const found = await lexoffice.findLegacyVouchers(LONG.slice(-36));
    expect(found.map((f) => f.voucher.number)).toEqual([LONG]);
  });

  it("zählt eine UUID, die tatsächlich Nummer eines Belegs ist, nicht als ohne Belegnummer", async () => {
    await voucher("501", INTERNAL_ID);
    await upload([`1,00;"H";"EUR";;;;70001;4390;"9";0101;"${INTERNAL_ID}";"";;"Rechnung mit UUID"`]);
    expect((await year2025()).bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 0 });
  });

  it("kennzeichnet eine interne Kennung in der Liste so wie der Filter „ohne Beleg“", async () => {
    await voucher("501", "B-1");
    await upload([`1,00;"H";"EUR";;;;1201;70001;;0102;"${INTERNAL_ID}";"";;"Zahlung"`]);
    const filtered = await archive.listDatevBookings({ year: 2025, search: "", unmatched: true, page: 0 });
    expect(filtered.rows).toEqual([]);
    const all = await archive.listDatevBookings({ year: 2025, search: "", unmatched: false, page: 0 });
    // Was die Liste als „kein passender Beleg“ markiert, muss der Filter „ohne Beleg“ auch zeigen
    expect(all.rows.filter((r) => !r.matched).map((r) => r.voucherField1)).toEqual(filtered.rows.map((r) => r.voucherField1));
  });

  it("führt einen früher als Ausgabebeleg übernommenen D-Beleg weiter als übernommen", async () => {
    // Vor dem Fix waren nur D-Belege als purchaseinvoice übernehmbar; ihre Übernahme steht in Haben und ist gesperrt
    const id = await voucher("601", "B-D", "D");
    await sql`insert into documents (sha256, filename, mime_type, size, status, supplier_name, invoice_number, document_date, net, tax, gross, lexoffice_voucher_id)
      values (${"b".repeat(64)}, 'b.pdf', 'application/pdf', 4, 'gebucht', 'Lieferant', 'B-D', '2025-01-01', 100, 19, 119, ${id})`;
    const items = await legacy.openLegacyItems();
    expect(items.map((i) => [i.number, i.takenOver?.kind])).toEqual([["B-D", "document"]]);
  });

  // Gegenproben
  it("Probe: ein offener D-Beleg ist keine Verbindlichkeit mehr", async () => {
    await voucher("601", "B-D", "D");
    expect(await legacy.openLegacyItems()).toEqual([]);
  });

  it("Probe: Leerzeichen mitten in der gekürzten Nummer", async () => {
    const number = "EBA-SG-EUR-THRFS INVOICE-1234567890123_11";
    await voucher("501", number);
    await upload([`1,00;"H";"EUR";;;;70001;4390;"9";0101;"${number.slice(-36)}";"";;"gekürzt"`]);
    expect((await year2025()).bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 0 });
  });

  it("Probe: Zeitraumabfrage mit Zahlungen und Richtungsfilter läuft mit Storno-Paar", async () => {
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const pay = JSON.stringify({ status: "balanced", openAmount: 0, paidDate: null, items: [] });
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw) values
      ('invoice/11', 'sevdesk', ${importId}, 'invoice', 'einnahme', 'RE-1', '2025-04-08', 'paid', 100, 19, 119, '[{"rate":1900,"net":100,"tax":19}]'::jsonb, '[]'::jsonb, ${pay}::jsonb, '{"id":"11","invoiceType":"RE","paidAmount":0,"payDate":null}'::jsonb),
      ('invoice/12', 'sevdesk', ${importId}, 'creditnote', 'einnahme', 'RE-2', '2025-04-10', 'paid', -100, -19, -119, '[{"rate":1900,"net":-100,"tax":-19}]'::jsonb, '[]'::jsonb, ${pay}::jsonb, '{"id":"12","invoiceType":"SR","paidAmount":"0.00","payDate":null,"origin":{"id":"11","objectName":"Invoice"}}'::jsonb)`;
    const period = await lexoffice.legacyVouchersForPeriod({ period: "2025", direction: "einnahme", search: "", withPayments: true, limit: 10 });
    expect(period.total).toBe(2);
    expect(period.vouchers.every((v) => v.payments.length === 0 && v.paymentHistoryIssue === null)).toBe(true);
    const onCutoff = await legacy.openLegacyItems("2025-04-10");
    expect(onCutoff).toEqual([]);
  });
});
