import { mapSevCreditNote, mapSevInvoice, type SevCreditNote, type SevInvoice } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/* docs/sevdesk.md: Ein Stornopaar hebt sich im Umsatz auf (#472). Beträge erfunden. */

const pos = (sumNet: string, sumTax: string, sumGross: string, taxRate: string) => ({ sumNet, sumTax, sumGross, taxRate });

const head = { invoiceDate: "2025-03-10", status: "1000", paidAmount: 0, payDate: null };

describe.skipIf(!testDatabaseUrl)("sevDesk-Stornopaar je Steuersatz (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let archive: typeof import("./archive.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
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
    await sql`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'soll', 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk')`;
  });

  async function insert(mapped: ReturnType<typeof mapSevInvoice>, raw: object) {
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const v = mapped.voucher;
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${v.lexofficeId}, 'sevdesk', ${importId}, ${v.type}, ${v.direction}, ${v.number}, ${v.date}, ${v.status}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(mapped.payment)}::jsonb, ${JSON.stringify(raw)}::jsonb)`;
  }

  const insertInvoice = (invoice: object, positions: object[]) => insert(mapSevInvoice(invoice as SevInvoice, positions as never[]), { ...invoice, positions });

  it("hebt sich bei Soll je Steuersatz auf, auch mit einer Rabattzeile", async () => {
    await insertInvoice({ ...head, id: "11", invoiceNumber: "RE-1", invoiceType: "RE", sumNet: "1300.00", sumTax: "211.00", sumGross: "1511.00" }, [
      pos("1000.00", "190.00", "1190.00", "19"),
      pos("500.00", "35.00", "535.00", "7"),
      pos("-200.00", "-14.00", "-214.00", "7"),
    ]);
    await insertInvoice(
      {
        ...head,
        id: "12",
        invoiceNumber: "RE-2",
        invoiceType: "SR",
        origin: { id: "11", objectName: "Invoice" },
        sumNet: "-1300.00",
        sumTax: "-211.00",
        sumGross: "-1511.00",
      },
      [pos("-1000.00", "-190.00", "-1190.00", "19"), pos("-500.00", "-35.00", "-535.00", "7"), pos("200.00", "14.00", "214.00", "7")],
    );
    const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
    expect(year.vat.map((m) => ({ kz81: m.kz81, tax81: m.tax81, kz86: m.kz86, tax86: m.tax86 }))).toEqual([{ kz81: 0, tax81: 0, kz86: 0, tax86: 0 }]);
  });

  it("zählt eine Gutschrift aus creditnote/ nicht zur letzten Rechnungsnummer", async () => {
    await insertInvoice({ ...head, id: "11", invoiceNumber: "RE-1", invoiceType: "RE", sumNet: "100", sumTax: "19", sumGross: "119" }, [
      pos("100", "19", "119", "19"),
    ]);
    const note = { ...head, id: "31", creditNoteDate: "2025-03-20", creditNoteNumber: "GU-1", sumNet: "100", sumTax: "19", sumGross: "119" };
    await insert(mapSevCreditNote(note as unknown as SevCreditNote, []), note);
    expect((await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!.lastInvoiceNumber).toBe("RE-1");
  });

  it("wertet eine groß geschriebene UUID im Belegfeld als interne Kennung", async () => {
    await insertInvoice({ ...head, id: "11", invoiceNumber: "RE-1", invoiceType: "RE", sumNet: "100", sumTax: "19", sumGross: "119" }, [
      pos("100", "19", "119", "19"),
    ]);
    const csv = [
      '"EXTF";700;21;"Buchungsstapel";13;;;"";"";"";0;0;20250101;4;20250101;20251231;"";"";;;0;"EUR";;"";;;"";;;"";',
      "Umsatz;Soll-/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basisumsatz;WKZ Basisumsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext",
      '1,00;"H";"EUR";;;;1201;70001;;0101;"ABCDEF00-0000-4000-8000-000000000001";;;"Zahlung"',
    ].join("\r\n");
    await archive.addArchiveFile("test-user", { bytes: new TextEncoder().encode(csv), filename: "EXTF_Buchungsstapel_2025.csv", kind: "datev", year: null });
    expect((await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!.bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 1 });
  });
});
