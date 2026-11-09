import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Belegende Tests aus dem dritten TDD-Review zu #503 (#472). Zum Ausführen nach
 * apps/web/src/server/modules/archiv/review3-472.test.ts kopieren.
 *
 * Quelle der Testdaten: die Beispielzeile aus #472 und packages/import/test-fixtures/sevdesk/buchhaltung-2.0/extf-buchungsstapel.csv.
 * Buchungstext „EBA-BG-EUR-xx-xxxxx-xxxxx xx-xxxxx-xxxxx“, Belegfeld 1 „-BG-EUR-xx-xxxxx-xxxxxxx-xxxxx-xxxxx“: Das Feld
 * enthält kein Leerzeichen und ist 36 Zeichen lang, also die letzten 36 Zeichen der Nummer ohne Leerzeichen (39 Zeichen,
 * wie der Melder schreibt).
 */

const stack = (rows: string[]) => {
  const header = `"EXTF";700;21;"Buchungsstapel";13;20260102120000000;;"SD";"";"";1001;12345;20250101;4;20250101;20251231;"sevDesk";"";1;0;0;"EUR";;"";;;"03";;;"";""`;
  const columns = `Umsatz;Soll-/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basisumsatz;WKZ Basisumsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext`;
  return new TextEncoder().encode([header, columns, ...rows].join("\r\n"));
};

// Aufbau wie in #472: Nummer mit Leerzeichen, im Feld ohne Leerzeichen und von links gekürzt
const NUMBER_WITH_SPACE = "EBA-BG-EUR-24-10001-20001 01-30001-40001";
const FIELD = "-BG-EUR-24-10001-2000101-30001-40001";

describe.skipIf(!testDatabaseUrl)("Drittes Review #472", () => {
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
    await sql`truncate journal_lines, journal_entries, document_amounts, documents, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist', 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
  });

  async function voucher(id: string, number: string) {
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${`voucher/${id}`}, 'sevdesk', ${importId}, 'purchaseinvoice', 'ausgabe', ${number}, '2025-01-01', 'open', 100, 19, 119,
        ${JSON.stringify([{ rate: 1900, net: 100, tax: 19 }])}::jsonb, '[]'::jsonb, ${JSON.stringify({ status: "open", openAmount: 119, paidDate: null, items: [] })}::jsonb,
        ${JSON.stringify({ id, objectName: "Voucher", creditDebit: "C" })}::jsonb)`;
  }

  const upload = (rows: string[]) =>
    archive.addArchiveFile("test-user", { bytes: stack(rows), filename: "EXTF_Buchungsstapel_2025.csv", kind: "datev", year: null });

  it("Vorbedingung: Das Feld sind die letzten 36 Zeichen der Nummer ohne Leerzeichen", () => {
    expect(NUMBER_WITH_SPACE.replace(/\s+/g, "").length).toBe(39);
    expect(NUMBER_WITH_SPACE.replace(/\s+/g, "").slice(-36)).toBe(FIELD);
    expect(FIELD).toHaveLength(36);
  });

  it("findet den Beleg, wenn sevDesk das Leerzeichen der Nummer vor dem Kürzen entfernt (Beispiel aus #472)", async () => {
    await voucher("501", NUMBER_WITH_SPACE);
    await upload([`1,00;"H";"EUR";;;;70001;4390;"9";0101;"${FIELD}";"010125";;"Lieferant GmbH, ${NUMBER_WITH_SPACE}"`]);
    const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
    expect(year.bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 0 });
  });

  it("zeigt die Buchung mit dieser gekürzten Nummer in der Buchungsliste als gefunden", async () => {
    await voucher("501", NUMBER_WITH_SPACE);
    await upload([`1,00;"H";"EUR";;;;70001;4390;"9";0101;"${FIELD}";"010125";;"Lieferant GmbH, ${NUMBER_WITH_SPACE}"`]);
    const { rows } = await archive.listDatevBookings({ year: 2025, search: "", unmatched: false, page: 0 });
    expect(rows.map((r) => r.matched)).toEqual([true]);
  });

  it("findet den Beleg über dieses gekürzte Belegfeld auch in der Suche", async () => {
    await voucher("501", NUMBER_WITH_SPACE);
    const found = await lexoffice.findLegacyVouchers(FIELD);
    expect(found.map((f) => f.voucher.number)).toEqual([NUMBER_WITH_SPACE]);
  });
});
