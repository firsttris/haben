import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const HEADER =
  "Buchungsnummer;Teilbuchung;Zahlungsdatum;Wertstellungsdatum;Buchungstext;Konto;Kontobezeichnung;Gegenkonto;Gegenkontobezeichnung;Soll;Haben;Steuerschluessel;Steuersatz;Steuerschluesselbezeichnung;Belegnummer;Buchungsdatum;UStID;Umsatzart";

function wisoBytes(lines: string[]): Uint8Array {
  return new TextEncoder().encode([HEADER, ...lines].join("\r\n"));
}

describe.skipIf(!testDatabaseUrl)("WISO-Import (Postgres)", () => {
  let wiso: typeof import("./wiso.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    wiso = await import("./wiso.ts");
  }, 90_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from archive_files`;
    });
    await leeren(sql)`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist', 'einzelunternehmen')`;
  });

  it("schreibt im Testlauf nichts, archiviert CSV und Buchungen und bleibt beim zweiten Lauf idempotent", async () => {
    const bytes = wisoBytes([
      "6;1;01.01.2026;01.01.2026;Werbung;4600;Werbekosten;1200;Bank;67,92;0,00;VSt 19 %;19,00;Vorsteuer 19 %;n4;**.**.**26;;0",
      "10;1;05.01.2026;05.01.2026;Honorar;8400;Erlöse 19 % USt;1200;Bank;0,00;200,00;USt 19 %;19,00;Umsatzsteuer 19 %;R8;**.**.**26;;0",
    ]);

    const preview = await wiso.previewWisoCsv(bytes);
    expect(preview).toMatchObject({ years: [2026], bookings: 2, rows: 2 });
    expect(await sql`select count(*)::int as n from lexoffice_vouchers`).toEqual([{ n: 0 }]);
    expect(await sql`select count(*)::int as n from archive_files`).toEqual([{ n: 0 }]);

    const first = await wiso.startWisoImport("test-user", bytes, "wiso-buchungen-2026.csv");
    expect(first).toMatchObject({ years: [2026], bookings: 2, rows: 2, imported: 2, skipped: 0 });

    const vouchers =
      await sql`select lexoffice_id, source, direction, number, net, tax, gross, raw->>'ohneBeleg' as ohne_beleg from lexoffice_vouchers order by lexoffice_id`;
    expect(vouchers).toEqual([
      { lexoffice_id: "wiso/2026/10", source: "wiso", direction: "einnahme", number: "R8", net: 16807, tax: 3193, gross: 20000, ohne_beleg: "true" },
      { lexoffice_id: "wiso/2026/6", source: "wiso", direction: "ausgabe", number: "n4", net: 5708, tax: 1084, gross: 6792, ohne_beleg: "true" },
    ]);

    const files = await sql`select kind, year, filename, note from archive_files`;
    expect(files).toEqual([{ kind: "sonstiges", year: 2026, filename: "wiso-buchungen-2026.csv", note: wiso.WISO_ORIGINAL_NOTE }]);

    const second = await wiso.startWisoImport("test-user", bytes, "wiso-buchungen-2026.csv");
    expect(second).toMatchObject({ imported: 0, skipped: 2 });
    expect(await sql`select count(*)::int as n from archive_files`).toEqual([{ n: 1 }]);
  });

  it("liest im SKR04 Erlös- und Aufwandskonten korrekt", async () => {
    await sql`update company set kontenrahmen = 'SKR04'`;
    const bytes = wisoBytes([
      "1;1;15.03.2026;15.03.2026;Beratung;4400;Erlöse 19 % USt;1800;Bank;0,00;119,00;USt 19 %;19,00;USt 19 %;R1;15.03.2026;;0",
      "2;1;16.03.2026;16.03.2026;Büro;6815;Bürobedarf;1800;Bank;23,80;0,00;VSt 19 %;19,00;VSt 19 %;E1;16.03.2026;;0",
    ]);

    const result = await wiso.startWisoImport("test-user", bytes, "wiso-skr04.csv");
    expect(result).toMatchObject({ imported: 2, skipped: 0 });
    const rows = await sql`select lexoffice_id, direction, gross from lexoffice_vouchers order by lexoffice_id`;
    expect(rows).toEqual([
      { lexoffice_id: "wiso/2026/1", direction: "einnahme", gross: 11900 },
      { lexoffice_id: "wiso/2026/2", direction: "ausgabe", gross: 2380 },
    ]);
  });

  // WISO EÜR rechnet nach Zahlung: Die Spalte „Zahlungsdatum“ ist der Zufluss. Bei Ist-Versteuerung zählt die Umsatzsteuer
  // im Abgleich nach Zahlungen (legacyVatByMonth, § 13 Abs. 1 Nr. 1 Buchst. b UStG); ohne sie fehlte die Einnahme in Kz 81,
  // während die Vorsteuer in Kz 66 steht
  it("zählt Einnahmen bei Ist-Versteuerung im Abgleich im Monat des Zahlungsdatums", async () => {
    const bytes = wisoBytes([
      "6;1;12.01.2026;12.01.2026;Werbung;4600;Werbekosten;1200;Bank;67,92;0,00;VSt 19 %;19,00;Vorsteuer 19 %;n4;12.01.2026;;0",
      "10;1;15.01.2026;15.01.2026;Honorar;8400;Erlöse 19 % USt;1200;Bank;0,00;200,00;USt 19 %;19,00;Umsatzsteuer 19 %;R8;15.01.2026;;0",
    ]);
    await wiso.startWisoImport("test-user", bytes, "wiso-ist.csv");

    const { reconciliation } = await import("./lexoffice.ts");
    const jahr = (await reconciliation()).years.find((y) => y.year === 2026)!;
    const januar = jahr.vat.find((m) => m.month === "2026-01")!;
    expect({ kz81: januar.kz81, tax81: januar.tax81, kz66: januar.kz66 }).toEqual({ kz81: 16807, tax81: 3193, kz66: 1084 });
  });
});
