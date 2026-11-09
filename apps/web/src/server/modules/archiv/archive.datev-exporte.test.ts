import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// EXTF_GP_Stamm_*.csv aus dem sevDesk-Export, anonymisiert: Formatkategorie 16 „Debitoren/Kreditoren“
const gpStamm = new Uint8Array(
  readFileSync(new URL("../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/extf-gp-stamm.csv", import.meta.url)),
);
const STACK_HEADER = `"EXTF";700;21;"Buchungsstapel";13;20240102120000000;;"LO";"";"";1001;12345;20230101;4;20230101;20231231;"Export";"";1;0;0;"EUR";;"";;;"03";;;"";""`;
const STACK_COLUMNS = `Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Buchungstext`;
const encode = (...lines: string[]) => new TextEncoder().encode(lines.join("\r\n"));

describe.skipIf(!testDatabaseUrl)("Archiv: DATEV-Exporte außer dem Buchungsstapel", () => {
  let archive: typeof import("./archive.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    archive = await import("./archive.ts");
  }, 30_000);

  beforeEach(async () => {
    await leeren(sql)`truncate archive_files cascade`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("legt den GP-Stamm als Sonstiges ab, ohne Buchungen zu übernehmen", async () => {
    const result = await archive.addArchiveFile(actor, { bytes: gpStamm, filename: "EXTF_GP_Stamm_2024.csv", kind: "sonstiges", year: 2024 });
    expect(result).toMatchObject({ bookings: 0, warnings: [] });
    const [file] = await sql`select kind, year, meta from archive_files`;
    expect(file).toMatchObject({ kind: "sonstiges", year: 2024, meta: null });
    const [row] = await sql`select count(*)::int as n from datev_bookings`;
    expect(row!.n).toBe(0);
  });

  it("behält eine andere gewählte Art", async () => {
    const result = await archive.addArchiveFile(actor, { bytes: gpStamm, filename: "EXTF_GP_Stamm_2024.csv", kind: "idea", year: 2024 });
    expect(result.warnings).toEqual([]);
    const [file] = await sql`select kind from archive_files`;
    expect(file!.kind).toBe("idea");
  });

  it("legt die Datei als Sonstiges ab und sagt es, wenn DATEV-Buchungsstapel gewählt ist", async () => {
    const result = await archive.addArchiveFile(actor, { bytes: gpStamm, filename: "EXTF_GP_Stamm_2024.csv", kind: "datev", year: 2024 });
    expect(result.bookings).toBe(0);
    expect(result.warnings).toEqual(["Das ist ein DATEV-Export „Debitoren/Kreditoren“, kein Buchungsstapel. Abgelegt als Sonstiges."]);
    const [file] = await sql`select kind from archive_files`;
    expect(file!.kind).toBe("sonstiges");
  });

  it("verlangt für einen anderen DATEV-Export das Geschäftsjahr", async () => {
    await expect(archive.addArchiveFile(actor, { bytes: gpStamm, filename: "EXTF_GP_Stamm_2024.csv", kind: "datev", year: null })).rejects.toThrow(
      /Geschäftsjahr/,
    );
    const [row] = await sql`select count(*)::int as n from archive_files`;
    expect(row!.n).toBe(0);
  });

  it("übernimmt einen Buchungsstapel weiter, auch wenn Sonstiges gewählt ist", async () => {
    const bytes = encode(STACK_HEADER, STACK_COLUMNS, `10,00;"S";1200;8400;"";2802;"Zahlung"`);
    const result = await archive.addArchiveFile(actor, { bytes, filename: "EXTF_Buchungsstapel_2023.csv", kind: "sonstiges", year: null });
    expect(result.bookings).toBe(1);
    const [file] = await sql`select kind, year from archive_files`;
    expect(file).toMatchObject({ kind: "datev", year: 2023 });
  });

  it.each([
    ["ohne Spaltenzeile", encode(STACK_HEADER), /Spaltenüberschriften fehlen/],
    ["mit fehlender Pflichtspalte", encode(STACK_HEADER, "Konto;Belegdatum", "1200;0101"), /Spalte „Umsatz/],
    ["mit ungültiger Zeile", encode(STACK_HEADER, STACK_COLUMNS, `10,00;"X";1200;8400;"";2802;"Zahlung"`), /weder S noch H/],
    ["mit unlesbarer Formatkategorie", encode(STACK_HEADER.replace(`700;21;`, `700;x;`), STACK_COLUMNS), /Formatkategorie/],
    ["ohne Buchungen", encode(STACK_HEADER, STACK_COLUMNS), /keine Buchungen/],
  ])("lehnt einen beschädigten Buchungsstapel %s ab, gleich welche Art gewählt ist", async (_name, bytes, message) => {
    await expect(archive.addArchiveFile(actor, { bytes, filename: "kaputt.csv", kind: "datev", year: 2023 })).rejects.toThrow(message);
    await expect(archive.addArchiveFile(actor, { bytes, filename: "kaputt.csv", kind: "sonstiges", year: 2023 })).rejects.toThrow(message);
    const [row] = await sql`select count(*)::int as n from archive_files`;
    expect(row!.n).toBe(0);
  });
});
