import { mapSevInvoice, type SevInvoice } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #472: sevDesk entfernt beim DATEV-Export aus der Belegnummer alle Zeichen außerhalb des Zeichensatzes von Belegfeld 1
 * (belegt: Punkt und Umlaute) und nimmt dann die letzten 36. Nummern erfunden.
 */

const belegfeld = (fields: string[]) =>
  [
    '"EXTF";700;21;"Buchungsstapel";13;;;"";"";"";0;0;20250101;4;20250101;20251231;"";"";;;0;"EUR";;"";;;"";;;"";',
    "Umsatz;Soll-/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basisumsatz;WKZ Basisumsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext",
    ...fields.map((f) => `1,00;"H";"EUR";;;;1201;70001;;0101;"${f}";;;"Zahlung"`),
  ].join("\r\n");

describe.skipIf(!testDatabaseUrl)("Belegnummern aus dem DATEV-Export von sevDesk (Postgres)", () => {
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
    await leeren(sql)`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'soll', 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk')`;
  });

  async function insert(number: string, source = "sevdesk") {
    const raw = {
      id: number,
      invoiceDate: "2025-03-10",
      invoiceNumber: number,
      invoiceType: "RE",
      status: "1000",
      paidAmount: 0,
      payDate: null,
      sumNet: "100",
      sumTax: "19",
      sumGross: "119",
    };
    const { voucher: v, payment } = mapSevInvoice(raw as unknown as SevInvoice, []);
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${v.lexofficeId}, ${source}, ${importId}, ${v.type}, ${v.direction}, ${number}, ${v.date}, ${v.status}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(payment)}::jsonb, ${JSON.stringify(raw)}::jsonb)`;
  }

  async function bookings(fields: string[]) {
    await archive.addArchiveFile("test-user", {
      bytes: new TextEncoder().encode(belegfeld(fields)),
      filename: "EXTF_Buchungsstapel_2025.csv",
      kind: "datev",
      year: null,
    });
    return (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!.bookings;
  }

  it.each([
    ["Punkt", "RE.2025.0001", "RE20250001"],
    ["Umlaute", "Büro-2025-äö1", "Bro-2025-1"],
    ["Unterstrich und Klammer", "RE_2025(0001)", "RE20250001"],
    ["erlaubte Sonderzeichen", "RE$&%*+-/1", "RE$&%*+-/1"],
  ])("findet den Beleg trotz %s", async (_fall, number, field) => {
    await insert(number);
    expect(await bookings([field])).toEqual({ total: 1, unmatched: 0, withoutNumber: 0 });
  });

  it("nimmt die letzten 36 Zeichen erst nach dem Entfernen", async () => {
    const tail = "A".repeat(35);
    await insert(`VORSPANN.${tail}.1`);
    expect(await bookings([`${tail}1`])).toEqual({ total: 1, unmatched: 0, withoutNumber: 0 });
  });

  it("findet einen Beleg mit anderer Nummer nicht", async () => {
    await insert("RE.2025.0002");
    expect(await bookings(["RE20250001"])).toEqual({ total: 1, unmatched: 1, withoutNumber: 0 });
  });

  it("gilt nur für sevDesk", async () => {
    await insert("RE.2025.0003", "lexoffice");
    expect(await bookings(["RE20250003"])).toEqual({ total: 1, unmatched: 1, withoutNumber: 0 });
  });

  it("findet den Beleg auch in der Belegsuche", async () => {
    await insert("RE.2025.0004");
    expect(await lexoffice.findLegacyVouchers("RE20250004")).toHaveLength(1);
  });
});
