import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const HEADER = `"EXTF";700;21;"Buchungsstapel";13;20240102120000000;;"LO";"";"";1001;12345;20230101;4;20230101;20231231;"Lexoffice Export";"";1;0;0;"EUR";;"";;;"03";;;"";""`;
const COLUMNS = `Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext`;
const stack = (rows: string[]) => new TextEncoder().encode([HEADER, COLUMNS, ...rows].join("\r\n"));

describe.skipIf(!testDatabaseUrl)("Archiv (Review)", () => {
  let archive: typeof import("./archive.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    archive = await import("./archive.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("übernimmt von zwei gleichzeitig hochgeladenen, sich überschneidenden DATEV-Stapeln nur einen", async () => {
    // Zwei verschiedene Exporte desselben Zeitraums (z. B. zweimal im Upload-Dialog gewählt)
    const a = stack([`1172,50;"S";"EUR";;;;1200;8400;"";2802;"RE1019";"";;"Zahlung RE1019"`]);
    const b = stack([`1172,50;"S";"EUR";;;;1200;8400;"";2802;"RE1019";"";;"Zahlung RE1019 (2)"`]);
    const results = await Promise.allSettled([
      archive.addArchiveFile(actor, { bytes: a, filename: "DATEV_a.csv", kind: "datev", year: null }),
      archive.addArchiveFile(actor, { bytes: b, filename: "DATEV_b.csv", kind: "datev", year: null }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [row] = await sql`select count(*)::int as n from datev_bookings`;
    // Sonst zählen die Buchungen doppelt (Kontensummen, Abgleich mit Lexoffice)
    expect(row!.n).toBe(1);
  });
});
