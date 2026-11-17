import { mapSevInvoice, type SevInvoice } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #1355: Trägt Belegfeld 1 ein Wort ohne eine einzige Ziffer, ist es keine Belegnummer, sondern etwa der Name eines
 * Zahlungsdienstleisters. Solche Zeilen sind kein offener Punkt, sondern ein Hinweis; ein leeres Feld bleibt offen wie
 * bisher, ein Feld mit Ziffer bleibt offen, wenn der Beleg fehlt. Namen und Nummern sind erfunden.
 */

/** Eine Ausgabe: Soll Aufwand an Bank (SKR03 4930 an 1200), damit keine Ausnahme ohne Belegpflicht greift. */
const row = (field: string) => `1,00;"S";"EUR";;;;4930;1200;;0101;"${field}";;;"Bürobedarf"`;

const stapel = (fields: string[]) =>
  [
    '"EXTF";700;21;"Buchungsstapel";13;;;"";"";"";0;0;20250101;4;20250101;20251231;"";"";;;0;"EUR";;"";;;"";;;"";',
    "Umsatz;Soll-/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basisumsatz;WKZ Basisumsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext",
    ...fields.map(row),
  ].join("\r\n");

describe.skipIf(!testDatabaseUrl)("Belegfeld 1 ohne Nummer im DATEV-Abgleich (Postgres)", () => {
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
    await leeren(sql)`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'soll', 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk')`;
  });

  /** Ein Beleg, dessen Nummer genau dem Belegfeld entspricht; im Zweifel mit einer echten Nummer. */
  async function beleg(number: string) {
    const raw = {
      id: number,
      invoiceDate: "2025-03-10",
      invoiceNumber: number,
      invoiceType: "RE",
      status: "1000",
      paidAmount: 0,
      payDate: null,
      sumNet: "100",
      sumTax: "19",
      sumGross: "119",
    };
    const { voucher: v, payment } = mapSevInvoice(raw as unknown as SevInvoice, []);
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${v.lexofficeId}, 'sevdesk', ${importId}, ${v.type}, ${v.direction}, ${number}, ${v.date}, ${v.status}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(payment)}::jsonb, ${JSON.stringify(raw)}::jsonb)`;
  }

  async function laden(fields: string[]) {
    await archive.addArchiveFile("test-user", {
      bytes: new TextEncoder().encode(stapel(fields)),
      filename: "EXTF_Buchungsstapel_2025.csv",
      kind: "datev",
      year: null,
    });
    const jahr = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
    const liste = await archive.listDatevBookings({ year: 2025, search: "", unmatched: false, page: 0 });
    return { jahr, liste };
  }

  const pruefung = (jahr: { checks: { label: string; detail: string; ok: boolean }[] }) =>
    jahr.checks.find((c) => c.label === "Jede Buchung mit Belegnummer findet ihren Beleg")!;

  it("führt ein Belegfeld ohne Ziffer als Hinweis und nicht als offenen Punkt", async () => {
    const { jahr, liste } = await laden(["Beispielzahldienst"]);

    expect(jahr.bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 0 });
    expect(pruefung(jahr).detail).toContain("1 Belegfeld ohne Nummer");
    // Die Buchung bleibt sichtbar, aber als Hinweis statt als offener Punkt
    expect(liste.total).toBe(1);
    expect(liste.rows[0]).toMatchObject({ voucherField1: "Beispielzahldienst", matched: false, ohneNummer: true });
    expect(pruefung(jahr).ok).toBe(true);
  });

  it("zeigt die Zeile nicht mehr im Filter „Nur ohne passenden Beleg“", async () => {
    await laden(["Beispielzahldienst"]);
    const offen = await archive.listDatevBookings({ year: 2025, search: "", unmatched: true, page: 0 });
    expect(offen.total).toBe(0);
    expect(offen.rows).toHaveLength(0);
  });

  it.each(["RE20250009", "Beleg 7", "16032026_19000"])("lässt eine Nummer mit Ziffer (%s) offen, wenn der Beleg fehlt", async (feld) => {
    const { jahr, liste } = await laden([feld]);

    expect(jahr.bookings).toEqual({ total: 1, unmatched: 1, withoutNumber: 0 });
    expect(pruefung(jahr).detail).not.toContain("Belegfeld ohne Nummer");
    expect(liste.rows[0]).toMatchObject({ matched: false, ohneNummer: false });
    const offen = await archive.listDatevBookings({ year: 2025, search: "", unmatched: true, page: 0 });
    expect(offen.total).toBe(1);
  });

  it("Gegenprobe: eine gewöhnliche Ausgabe ohne Belegfeld bleibt offen wie bisher", async () => {
    const { jahr, liste } = await laden([""]);

    expect(jahr.bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 1 });
    expect(pruefung(jahr).detail).not.toContain("Belegfeld ohne Nummer");
    expect(liste.rows[0]).toMatchObject({ matched: false, ohneNummer: false });
    const offen = await archive.listDatevBookings({ year: 2025, search: "", unmatched: true, page: 0 });
    expect(offen.total).toBe(1);
  });

  it("zählt im Abgleich so viele Belegfelder ohne Nummer, wie die Liste zeigt", async () => {
    const { jahr, liste } = await laden(["Beispielzahldienst", "Beispielkuerzel", "", "RE20250009"]);

    expect(jahr.bookings).toEqual({ total: 4, unmatched: 1, withoutNumber: 1 });
    expect(pruefung(jahr).detail).toContain("2 Belegfelder ohne Nummer");
    expect(pruefung(jahr).detail).toContain("1 ohne Belegnummer");
    const hinweis = liste.rows.filter((r) => r.ohneNummer);
    expect(hinweis).toHaveLength(2);
    expect(hinweis.map((r) => r.voucherField1)).toEqual(["Beispielzahldienst", "Beispielkuerzel"]);
    const offen = await archive.listDatevBookings({ year: 2025, search: "", unmatched: true, page: 0 });
    expect(offen.total).toBe(2);
  });

  it("zählt ein Feld ohne Ziffer, das ein Beleg als Nummer trägt, nicht als Hinweis", async () => {
    await beleg("Beispielzahldienst");
    const { jahr, liste } = await laden(["Beispielzahldienst"]);

    expect(jahr.bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 0 });
    expect(pruefung(jahr).detail).not.toContain("Belegfeld ohne Nummer");
    expect(liste.rows[0]).toMatchObject({ matched: true, ohneNummer: false });
  });
});
