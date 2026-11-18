import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Bestätigungen beim BZSt im Jahresarchiv (#1385): `stammdaten/ustid-bestaetigungen.csv` nach dem Zeitpunkt der Anfrage in
 * deutscher Zeit, mit der Antwort unverändert als Nachweis; ohne Bestätigung im Jahr keine Datei.
 */

const text = (bytes: Uint8Array | undefined) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

async function archiv(exporter: typeof import("./export.ts"), year: number) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of exporter.exportYear(year, new Date(`${year + 1}-01-15T10:00:00Z`))) chunks.push(chunk);
  return unzipSync(Buffer.concat(chunks));
}

describe.skipIf(!testDatabaseUrl)("Jahresarchiv: Bestätigungen von USt-IdNrn. (Postgres)", () => {
  let exporter: typeof import("./export.ts");
  let sql: postgres.Sql;
  const antwort = '{"id":"779b5f65af22c988","anfrageZeitpunkt":"2027-01-01T00:30:00.1+01:00","status":"evatr-0000","ergOrt":"B"}';

  beforeAll(async () => {
    sql = await setupTestDb();
    exporter = await import("./export.ts");
    await sql`insert into company (id, name, ust_id) values (1, 'Testfirma', 'DE123456788') on conflict (id) do nothing`;
    const [kontakt] = await sql<{ id: string }[]>`
      insert into contacts (name, strasse, plz, ort, land, ust_id) values ('Musterhaus', 'Musterstrasse 22', '1010', 'Wien', 'AT', 'ATU12345678')
      returning id`;
    // 2026-12-31 23:30 UTC ist in Berlin schon der 1. Januar 2027
    await sql`
      insert into ustid_bestaetigungen (contact_id, art, anfragende_ustid, angefragte_ustid, status, anfrage_zeitpunkt, antwort, created_by)
      values (${kontakt!.id}, 'einfach', 'DE123456788', 'ATU12345678', 'evatr-2001', '2026-06-01T10:00:00+02:00',
        '{"status":"evatr-2001"}', 'test-user')`;
    await sql`
      insert into ustid_bestaetigungen (contact_id, art, anfragende_ustid, angefragte_ustid, firmenname, ort, status, anfrage_zeitpunkt,
        erg_ort, bzst_id, antwort, created_by)
      values (${kontakt!.id}, 'qualifiziert', 'DE123456788', 'ATU12345678', 'Musterhaus', 'Wien', 'evatr-0000',
        '2026-12-31T23:30:00.1Z', 'B', '779b5f65af22c988', ${antwort}, 'test-user')`;
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("ordnet nach dem Zeitpunkt in deutscher Zeit zu und gibt die Antwort unverändert mit", async () => {
    const zeilen2026 = text((await archiv(exporter, 2026))["stammdaten/ustid-bestaetigungen.csv"])
      .trim()
      .split("\r\n");
    expect(zeilen2026).toHaveLength(2);
    expect(zeilen2026[1]).toContain("2026-06-01T08:00:00.000Z;Musterhaus;einfach;ATU12345678;DE123456788;;;;;evatr-2001;Nicht vergeben;");

    const dateien2027 = await archiv(exporter, 2027);
    const zeilen2027 = text(dateien2027["stammdaten/ustid-bestaetigungen.csv"]).trim().split("\r\n");
    expect(zeilen2027[0]).toBe(
      "Zeitpunkt;Kontakt;Art;Angefragte USt-IdNr.;Eigene USt-IdNr.;Name gesendet;Straße gesendet;PLZ gesendet;Ort gesendet;Status;Meldung;Gültig ab;Gültig bis;Name;Straße;PLZ;Ort;BZSt-ID;Antwort;Angefragt von;Kontakt-ID;ID",
    );
    expect(zeilen2027).toHaveLength(2);
    expect(zeilen2027[1]).toContain(`;B;779b5f65af22c988;"${antwort.replaceAll('"', '""')}";test-user;`);
    // Die Prüfsoftware bekommt die Datei in index.xml beschrieben, die Prüfsummen decken sie ab
    expect(text(dateien2027["index.xml"])).toContain("stammdaten/ustid-bestaetigungen.csv");
    expect(text(dateien2027["pruefsummen.sha256"])).toContain("stammdaten/ustid-bestaetigungen.csv");
  });

  it("ohne Bestätigung im Jahr fehlt die Datei", async () => {
    expect((await archiv(exporter, 2025))["stammdaten/ustid-bestaetigungen.csv"]).toBeUndefined();
  });
});
