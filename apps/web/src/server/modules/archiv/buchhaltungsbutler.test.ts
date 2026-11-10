import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const BB_HEADERS = [
  "Datum",
  "Buchungstext",
  "Betrag",
  "Währung",
  "Sollkonto",
  "Habenkonto",
  "Steuerschlüssel",
  "Buchungsnummer",
  "Rechnungsnummern",
  "Gegenpartei",
  "Umsatzsteuer",
  "Zugewiesene Beträge",
  "Beleglinks",
  "Festschreibung",
  "Kommentar",
  "Leistungsdatum",
];
const DATEV_HEADERS = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Buchungstext",
  ...Array.from({ length: 16 }, (_, i) => `Beleginfo - ${i % 2 === 0 ? "Art" : "Inhalt"} ${Math.floor(i / 2) + 1}`),
];
const PDF = new TextEncoder().encode("%PDF-1.4\n%%EOF");

function csv(rows: string[][]): Uint8Array {
  return new TextEncoder().encode(rows.map((row) => row.map((field) => `"${field}"`).join(";")).join("\r\n"));
}

function parts() {
  const meta = Array.from({ length: 30 }, () => "");
  Object.assign(meta, {
    0: "EXTF",
    1: "700",
    2: "21",
    3: "Buchungsstapel",
    4: "12",
    12: "20230101",
    13: "4",
    14: "20230101",
    15: "20231231",
    21: "EUR",
    26: "03",
  });
  const info = [
    "Buchungsnummer",
    "127",
    "URL",
    "https://bb.example/202300327.pdf",
    "Gegenpartei",
    "Muster GmbH",
    "Rechnungsnummer",
    "202300327",
    "Betrag",
    "67,79",
    "Umsatzsteuer",
    "19",
    "Rechnungsdatum",
    "02.01.2023",
  ];
  return [
    {
      name: "EXTF_Buchungsstapel.csv",
      bytes: csv([meta, DATEV_HEADERS, ["67,79", "H", "EUR", "1203", "4964", "9", "0401", "202300327", "Muster GmbH", ...info]]),
    },
    {
      name: "BB_Buchungsstapel.csv",
      bytes: csv([
        BB_HEADERS,
        [
          "04.01.2023",
          "Muster GmbH",
          "67,79",
          "EUR",
          "4964",
          "1203",
          "9",
          "127",
          "202300327",
          "Muster GmbH",
          "19",
          "67,79",
          "https://bb.example/202300327.pdf",
          "1",
          "",
          "02.01.2023",
        ],
      ]),
    },
    { name: "Belege.zip", bytes: zipSync({ "Belege/127.pdf": PDF }) },
  ];
}

describe.skipIf(!testDatabaseUrl)("BuchhaltungsButler-Import (Postgres)", () => {
  let bb: typeof import("./buchhaltungsbutler.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    bb = await import("./buchhaltungsbutler.ts");
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
    await sql`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist', 'einzelunternehmen')`;
  });

  it("schreibt im Testlauf nichts und importiert danach Beleg, PDF und Originaldateien", async () => {
    await sql`insert into contacts (name) values ('Muster GmbH')`;
    const preview = await bb.previewBbExport(parts());
    expect(preview).toMatchObject({ year: 2023, bookings: 1, files: 1, withoutReceipt: 0 });
    expect(preview.vouchers[0]?.voucher).toMatchObject({ type: "purchaseinvoice", number: "202300327", net: 5697, tax: 1082, gross: 6779 });
    expect(await sql`select count(*)::int as n from lexoffice_vouchers`).toEqual([{ n: 0 }]);
    expect(await sql`select count(*)::int as n from archive_files`).toEqual([{ n: 0 }]);

    const result = await bb.startBuchhaltungsbutlerImport("test-user", parts());
    expect(result).toMatchObject({ year: 2023, bookings: 1, vouchers: 1, files: 1 });
    const [voucher] = await sql`select v.*, c.name as contact_name from lexoffice_vouchers v left join contacts c on c.id = v.contact_id`;
    expect(voucher).toMatchObject({
      lexoffice_id: "booking/2023/127",
      source: "buchhaltungsbutler",
      number: "202300327",
      status: "archiviert",
      contact_name: "Muster GmbH",
      net: 5697,
      tax: 1082,
      gross: 6779,
    });
    const [file] = await sql`select * from lexoffice_voucher_files`;
    expect(file).toMatchObject({ filename: "127.pdf", mime_type: "application/pdf", size: PDF.length });
    expect(await sql`select count(*)::int as n from datev_bookings`).toEqual([{ n: 1 }]);
    expect(await sql`select count(*)::int as n from archive_files`).toEqual([{ n: 3 }]);
    expect((await bb.latestBuchhaltungsbutlerImport())?.progress).toMatchObject({ imported: 1, skipped: 0, files: 1, contactsLinked: 1 });
  });

  it("überspringt beim erneuten Import Belege und Originalexporte", async () => {
    await bb.startBuchhaltungsbutlerImport("test-user", parts());
    await bb.startBuchhaltungsbutlerImport("test-user", parts());
    expect(await sql`select count(*)::int as n from lexoffice_vouchers`).toEqual([{ n: 1 }]);
    expect(await sql`select count(*)::int as n from lexoffice_voucher_files`).toEqual([{ n: 1 }]);
    expect(await sql`select count(*)::int as n from archive_files`).toEqual([{ n: 3 }]);
    expect((await bb.latestBuchhaltungsbutlerImport())?.progress).toMatchObject({ imported: 0, skipped: 1, files: 0 });
  });
});
