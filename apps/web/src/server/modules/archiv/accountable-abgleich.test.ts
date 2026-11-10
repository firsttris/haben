import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Abgleich „Jede Buchung mit Belegnummer findet ihren Beleg“ nach dem Accountable-Umzug (Review #579). Konten ohne Beleg
 * (Privat, Geldtransit) hängen am Kontenrahmen: SKR03 Privat 1800–1899 und Geldtransit 1360, SKR04 Privat 2100–2199
 * und Geldtransit 1460, dort ist 1800 die Bank (Kontenrahmen in packages/core/src/posting.ts).
 */

const COLUMNS =
  "Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext";

/** Kopf eines Buchungsstapels für 2023; `skr` ist das Feld Sachkontenrahmen ("03" oder "04") */
const header = (skr: "03" | "04", system = "Lexoffice Export") =>
  `"EXTF";700;21;"Buchungsstapel";13;20240102120000000;;"LO";"";"";1001;12345;20230101;4;20230101;20231231;"${system}";"";1;0;0;"EUR";;"";;;"${skr}";;;"";""`;

describe.skipIf(!testDatabaseUrl)("Abgleich der DATEV-Buchungen nach Kontenrahmen (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let archive: typeof import("./archive.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    archive = await import("./archive.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function company(kontenrahmen: "SKR03" | "SKR04") {
    for (const table of ["datev_bookings", "archive_files", "lexoffice_vouchers", "company"]) {
      await sql.unsafe(`alter table ${table} disable trigger user`);
      await sql.unsafe(`delete from ${table}`);
      await sql.unsafe(`alter table ${table} enable trigger user`);
    }
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', ${kontenrahmen})`;
  }

  async function unmatched(skr: "03" | "04", rows: string[]) {
    const bytes = new TextEncoder().encode([header(skr), COLUMNS, ...rows].join("\r\n"));
    await archive.addArchiveFile(actor, { bytes, filename: `EXTF_Buchungsstapel_2023_${skr}.csv`, kind: "datev", year: null });
    const { years } = await lexoffice.reconciliation();
    return years.find((y) => y.year === 2023)!.bookings!.unmatched;
  }

  beforeEach(async () => {
    await company("SKR03");
  });

  it("SKR03 aus Lexoffice: eine Erlösbuchung, deren Rechnung im Archiv fehlt, bleibt offen", async () => {
    // Bisher meldete der Abgleich diese Zeile; dass Accountable keine Rechnungen exportiert, ändert nichts an Lexoffice
    expect(await unmatched("03", [`1190,00;"S";"EUR";;;;1200;8400;"";1503;"RE-FEHLT";"";;"Zahlung RE-FEHLT"`])).toBe(1);
  });

  it("SKR04: eine Buchung gegen die Bank 1800 mit unbekannter Belegnummer bleibt offen", async () => {
    await company("SKR04");
    // In SKR04 ist 1800 die Bank, kein Privatkonto
    expect(await unmatched("04", [`119,00;"H";"EUR";;;;6815;1800;"9";1503;"B-404";"";;"Bürobedarf"`])).toBe(1);
  });

  it("SKR04: Privatentnahme 2100 und Geldtransit 1460 haben keinen Beleg und bleiben nicht offen", async () => {
    await company("SKR04");
    expect(
      await unmatched("04", [
        `271,40;"H";"EUR";;;;1800;2100;"";1903;"19032023_27140";"";;"Privatentnahme"`,
        `50,00;"H";"EUR";;;;1800;1460;"";2003;"20032023_5000";"";;"Umbuchung"`,
      ]),
    ).toBe(0);
  });

  it("die Liste „ohne passenden Beleg“ zeigt dieselben Buchungen, die der Abgleich zählt (Review #579, Runde 2)", async () => {
    // Der Abgleich verlinkt bei unmatched > 0 auf diese Liste; Privatzeilen zählt er nicht, also darf die Liste sie nicht zeigen
    const offen = await unmatched("03", [
      `271,40;"H";"EUR";;;;1200;1801;"";1903;"19032023_27140";"";;"Privatentnahme"`,
      `119,00;"H";"EUR";;;;1200;4930;"9";1503;"B-404";"";;"Bürobedarf"`,
    ]);
    expect(offen).toBe(1);
    const list = await archive.listDatevBookings({ year: 2023, search: "", unmatched: true, page: 0 });
    expect(list.rows.map((r) => r.voucherField1)).toEqual(["B-404"]);
    expect(list.total).toBe(offen);
  });
  it("auch die Buchungen ohne Beleg je Zeitraum (MCP) zählen wie der Abgleich (Review #579, Runde 3)", async () => {
    const offen = await unmatched("03", [
      `271,40;"H";"EUR";;;;1200;1801;"";1903;"19032023_27140";"";;"Privatentnahme"`,
      `119,00;"H";"EUR";;;;1200;4930;"9";1503;"B-404";"";;"Bürobedarf"`,
    ]);
    const period = await archive.datevBookingsForPeriod({ year: 2023, account: "", unmatched: true, limit: 50 });
    expect(period.rows.map((r) => r.voucherField1)).toEqual(["B-404"]);
    expect(period.total).toBe(offen);
  });
});
