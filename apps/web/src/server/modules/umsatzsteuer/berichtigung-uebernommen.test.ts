import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Berichtigung in einem beim Update übernommenen Jahr (#1200): Für März 2026 wurden 1.000 € in Kz 81 gesendet, aus dem
 * Journal kämen 0 €, weil einer Zahlung von vor v0.7.0 die Bemessungsgrundlage fehlt. Die Abweichung wurde beim Update auf
 * das Journal übernommen (HABEN_ABWEICHUNG_UEBERNEHMEN=2026). Eine Berichtigung aus dem Journal würde sie still mitberichtigen;
 * sie beginnt deshalb mit den gesendeten Werten im Modus „manuell“.
 */
describe.skipIf(!testDatabaseUrl)("Berichtigung in einem beim Update übernommenen Jahr (Postgres)", () => {
  let vat: typeof import("./vat.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const maerz = { year: 2026, month: 3 };

  beforeAll(async () => {
    sql = await setupTestDb();
    vat = await import("./vat.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04", uebernommen: number[]) {
    await leeren(sql)`truncate journal_umstellung, vat_return_submissions, vat_returns, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen})`;
    await sql`insert into journal_umstellung (stichjahr_vorher, ergebnis, befunde) values (null, 'offen', '[]'::jsonb)`;
    if (uebernommen.length > 0) {
      const befunde = uebernommen.map((jahr) => ({ jahr, text: `${jahr}-03 Voranmeldung (gesendet), Kz 81: im Journal 0,00 €, gesendet 1.000,00 €` }));
      await sql`insert into journal_umstellung (stichjahr_vorher, ergebnis, befunde) values (2027, 'uebernommen', ${JSON.stringify(befunde)}::jsonb)`;
    }
    // Wie vor dem Update gesendet: aus den Buchungen berechnet, mit 1.000 € in Kz 81
    const computed = { kz81: 100_000, kz83: 19_000 };
    await sql`insert into vat_returns (year, month, kz81, kz83, status, source, computed, sent_at, locked_at, transfer_ticket)
      values (2026, 3, 100_000, 19_000, 'sent', 'berechnet', ${JSON.stringify(computed)}::jsonb, '2026-04-10T10:00:00Z', '2026-04-10T10:00:00Z', 'ABC123456789')`;
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`übernommenes Jahr: Entwurf mit den gesendeten Werten, manuell, Begründung vorbelegt (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen, [2026]);
        const correction = await vat.createCorrection(actor, maerz);
        expect(correction).toMatchObject({ berichtigt: true, kz81: 100_000, kz83: 19_000, source: "manuell" });
        expect(correction.overrideReason).toContain("2026 beim Update auf das Journal übernommen");
        // Daneben die Rechnung aus dem Journal, damit die Seite je Kennzahl die Differenz zeigen kann
        expect(correction.computed).toMatchObject({ kz81: 0, kz83: 0 });
      });

      it(`nicht übernommenes Jahr: Berichtigung wie bisher aus den Buchungen (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen, [2025]);
        const correction = await vat.createCorrection(actor, maerz);
        expect(correction).toMatchObject({ berichtigt: true, kz81: 100_000, source: "berechnet", overrideReason: null });
      });
    }
  }

  it("Begründung bleibt änderbar: Speichern mit eigener Begründung behält die gesendeten Werte", async () => {
    await reset("ist", "SKR03", [2026]);
    await vat.createCorrection(actor, maerz);
    const saved = await vat.saveDraft(actor, maerz, { mode: "manuell", kz81: 120_000, kz86: 0, kz66: 0, reason: "Rechnung über 200 € fehlte im März." });
    expect(saved).toMatchObject({ kz81: 120_000, source: "manuell", overrideReason: "Rechnung über 200 € fehlte im März." });
  });
});
