import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Review #585: freie Buchungen gegen Privat auf Konten, die der EÜR-Abgleich nur aus Zahlungen (sourceType allocation)
 * liest. Die Gegenprobe aus den Nebenbüchern zählt die freie Buchung (mitFreienBuchungen), das Journal im Abgleich nicht.
 */
const KONTEN = {
  SKR03: { einlage: "1890", gewst: "4320", zinsen: "2110", zuschlag: "2107", ustVorjahr: "1790" },
  SKR04: { einlage: "2180", gewst: "7610", zinsen: "7310", zuschlag: "7305", ustVorjahr: "3841" },
} as const;

describe.skipIf(!testDatabaseUrl)("Review #585: EÜR-Abgleich mit freien Buchungen gegen Privat (Postgres)", () => {
  let sql: postgres.Sql;
  let manual: typeof import("./manual.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  const today = "2026-10-04";

  beforeAll(async () => {
    sql = await setupTestDb();
    manual = await import("./manual.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  for (const kr of ["SKR03", "SKR04"] as const) {
    for (const art of ["gewst", "zinsen", "zuschlag", "ustVorjahr"] as const) {
      it(`${art} privat bezahlt: keine Abweichung im EÜR-Abgleich (${kr})`, async () => {
        await sql`truncate vat_return_submissions, vat_returns, annual_submissions, journal_lines, journal_entries, company cascade`;
        await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform, kleinunternehmer, journal_ab)
          values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${kr}, 'ist', 'einzelunternehmen', false, 2026)`;
        await manual.createManualEntry(
          "test-user",
          {
            date: "2026-05-10",
            description: "Privat bezahlt",
            lines: [
              { account: KONTEN[kr][art], debit: 5_000, credit: 0 },
              { account: KONTEN[kr].einlage, debit: 0, credit: 5_000 },
            ],
          },
          today,
        );
        expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
      }, 60_000);
    }
    it(`Aufwand privat bezahlt: Integrität ohne Befund (${kr})`, async () => {
      await sql`truncate vat_return_submissions, vat_returns, annual_submissions, journal_lines, journal_entries, company cascade`;
      await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform, kleinunternehmer, journal_ab)
        values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${kr}, 'ist', 'einzelunternehmen', false, 2026)`;
      const id = await manual.createManualEntry(
        "test-user",
        {
          date: "2026-05-10",
          description: "Privat bezahlt",
          lines: [
            { account: KONTEN[kr].gewst, debit: 5_000, credit: 0 },
            { account: KONTEN[kr].einlage, debit: 0, credit: 5_000 },
          ],
        },
        today,
      );
      const storno = await manual.reverseManualEntry("test-user", id, undefined, today);
      expect(await sql`select art, befund from haben_integrity_problems(100) where zeile in (${id}, ${storno})`).toEqual([]);
      expect(storno).toBeTruthy();
    }, 60_000);
  }
});
