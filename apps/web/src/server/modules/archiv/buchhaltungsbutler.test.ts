import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

/** Belegkennung aus dem Stapel; unterscheidet die Zeilen dieses Testfalls von fremden Importen in derselben Datenbank */
const BELEG = "booking/2023/127";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

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
  /** Bytes genau dieses Testfalls; ihre Prüfsummen kennzeichnen die eigenen Zeilen in archive_files */
  let teile: ReturnType<typeof parts>;
  let eigenePruefsummen: string[];
  /** Importläufe dieses Testfalls, damit vor dem nächsten Fall nur die eigenen Zeilen weichen */
  let eigeneLaeufe: string[] = [];

  beforeAll(async () => {
    sql = await setupTestDb();
    bb = await import("./buchhaltungsbutler.ts");
    teile = parts();
    eigenePruefsummen = teile.map((teil) => sha256(teil.bytes));
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      if (eigeneLaeufe.length > 0) {
        await tx`delete from lexoffice_voucher_files where voucher_id in (select id from lexoffice_vouchers where import_id in ${tx(eigeneLaeufe)})`;
        await tx`delete from lexoffice_vouchers where import_id in ${tx(eigeneLaeufe)}`;
        await tx`delete from lexoffice_imports where id in ${tx(eigeneLaeufe)}`;
      }
      await tx`delete from datev_bookings where file_id in (select id from archive_files where sha256 in ${tx(eigenePruefsummen)})`;
      await tx`delete from archive_files where sha256 in ${tx(eigenePruefsummen)}`;
    });
    eigeneLaeufe = [];
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist', 'einzelunternehmen')
      on conflict (id) do update set name = excluded.name, strasse = excluded.strasse, plz = excluded.plz, ort = excluded.ort,
        email = excluded.email, steuernummer = excluded.steuernummer, bundesland = excluded.bundesland,
        kontenrahmen = excluded.kontenrahmen, versteuerung = excluded.versteuerung, rechtsform = excluded.rechtsform`;
  });

  it("schreibt im Testlauf nichts und importiert danach Beleg, PDF und Originaldateien", async () => {
    await sql`insert into contacts (name) select 'Muster GmbH' where not exists (select 1 from contacts where name = 'Muster GmbH')`;
    const preview = await bb.previewBbExport(teile);
    expect(preview).toMatchObject({ year: 2023, bookings: 1, files: 1, withoutReceipt: 0 });
    expect(preview.vouchers[0]?.voucher).toMatchObject({ type: "purchaseinvoice", number: "202300327", net: 5697, tax: 1082, gross: 6779 });
    expect(await sql`select count(*)::int as n from lexoffice_vouchers where lexoffice_id = ${BELEG}`).toEqual([{ n: 0 }]);
    expect(await sql`select count(*)::int as n from archive_files where sha256 in ${sql(eigenePruefsummen)}`).toEqual([{ n: 0 }]);

    const lauf = await bb.startBuchhaltungsbutlerImport("test-user", teile);
    eigeneLaeufe.push(lauf.id);
    expect(lauf).toMatchObject({ year: 2023, bookings: 1, vouchers: 1, files: 1 });
    const [voucher] = await sql`select v.*, c.name as contact_name from lexoffice_vouchers v left join contacts c on c.id = v.contact_id
      where v.lexoffice_id = ${BELEG}`;
    expect(voucher).toMatchObject({
      lexoffice_id: BELEG,
      source: "buchhaltungsbutler",
      number: "202300327",
      status: "archiviert",
      contact_name: "Muster GmbH",
      net: 5697,
      tax: 1082,
      gross: 6779,
    });
    const [file] = await sql`select f.* from lexoffice_voucher_files f join lexoffice_vouchers v on v.id = f.voucher_id
      where v.lexoffice_id = ${BELEG}`;
    expect(file).toMatchObject({ filename: "127.pdf", mime_type: "application/pdf", size: PDF.length });
    expect(
      await sql`select count(*)::int as n from datev_bookings where file_id = (select id from archive_files where sha256 = ${eigenePruefsummen[0]!})`,
    ).toEqual([{ n: 1 }]);
    expect(await sql`select count(*)::int as n from archive_files where sha256 in ${sql(eigenePruefsummen)}`).toEqual([{ n: 3 }]);
    const [eigenerLauf] = await sql`select progress from lexoffice_imports where id = ${lauf.id}`;
    expect(eigenerLauf?.progress).toMatchObject({ imported: 1, skipped: 0, files: 1, contactsLinked: 1 });
  });

  it("überspringt beim erneuten Import Belege und Originalexporte", async () => {
    const erster = await bb.startBuchhaltungsbutlerImport("test-user", teile);
    eigeneLaeufe.push(erster.id);
    const zweiter = await bb.startBuchhaltungsbutlerImport("test-user", teile);
    eigeneLaeufe.push(zweiter.id);
    expect(await sql`select count(*)::int as n from lexoffice_vouchers where lexoffice_id = ${BELEG}`).toEqual([{ n: 1 }]);
    expect(
      await sql`select count(*)::int as n from lexoffice_voucher_files f join lexoffice_vouchers v on v.id = f.voucher_id
        where v.lexoffice_id = ${BELEG}`,
    ).toEqual([{ n: 1 }]);
    expect(await sql`select count(*)::int as n from archive_files where sha256 in ${sql(eigenePruefsummen)}`).toEqual([{ n: 3 }]);
    const [eigenerLauf] = await sql`select progress from lexoffice_imports where id = ${zweiter.id}`;
    expect(eigenerLauf?.progress).toMatchObject({ imported: 0, skipped: 1, files: 0 });
  });
});
