import { mapSevInvoice, type SevInvoice } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #1355: Trägt Belegfeld 1 ein Wort ohne eine einzige Ziffer, ist es keine Belegnummer, sondern etwa der Name eines
 * Zahlungsdienstleisters. Solche Zeilen sind kein offener Punkt, sondern zählen wie ein leeres Feld unter „ohne
 * Belegnummer“; ein Feld mit Ziffer gilt als Nummer und bleibt offen, wenn der Beleg fehlt. Namen und Nummern sind
 * erfunden.
 */

/** Eine Ausgabe: Soll Aufwand an Bank (SKR03 4930 an 1200), damit keine Ausnahme ohne Belegpflicht greift. */
const row = (field: string) => `1,00;"S";"EUR";;;;4930;1200;;0101;"${field}";;;"Bürobedarf"`;

const stapelRoh = (zeilen: string[]) =>
  [
    '"EXTF";700;21;"Buchungsstapel";13;;;"";"";"";0;0;20250101;4;20250101;20251231;"";"";;;0;"EUR";;"";;;"";;;"";',
    "Umsatz;Soll-/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basisumsatz;WKZ Basisumsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext",
    ...zeilen,
  ].join("\r\n");

const stapel = (fields: string[]) => stapelRoh(fields.map(row));

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
    return ladenMit(stapel(fields));
  }

  async function ladenMit(inhalt: string) {
    await archive.addArchiveFile("test-user", {
      bytes: new TextEncoder().encode(inhalt),
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

  it("zählt ein Belegfeld ohne Ziffer als Buchung ohne Belegnummer, nicht als offenen Punkt", async () => {
    const { jahr, liste } = await laden(["Beispielzahldienst"]);

    expect(jahr.bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 1 });
    expect(pruefung(jahr).detail).not.toContain("ohne passenden Beleg");
    expect(pruefung(jahr).detail).toContain("1 ohne Belegnummer");
    expect(pruefung(jahr).ok).toBe(true);
    // Die Buchung bleibt sichtbar, mit ihrem Feld, aber ohne eigenen Hinweis
    expect(liste.total).toBe(1);
    expect(liste.rows[0]).toMatchObject({ voucherField1: "Beispielzahldienst", matched: false });
    expect(liste.rows[0]).not.toHaveProperty("ohneNummer");
  });

  it("zeigt die Zeile nicht im Filter „Nur ohne passenden Beleg“", async () => {
    await laden(["Beispielzahldienst"]);
    const offen = await archive.listDatevBookings({ year: 2025, search: "", unmatched: true, page: 0 });
    expect(offen.total).toBe(0);
    expect(offen.rows).toHaveLength(0);
  });

  it("lässt die Zeile auch in der Zeitraumabfrage des Werkzeugs weg", async () => {
    // Dieselbe Einordnung für das Werkzeug `lexoffice_buchungen`: Es filtert offen, wenn `ohneBeleg` gesetzt ist
    await laden(["Beispielzahldienst"]);
    const zeitraum = await archive.datevBookingsForPeriod({ year: 2025, account: "", unmatched: true, limit: 50 });
    expect(zeitraum.total).toBe(0);
    expect(zeitraum.rows).toHaveLength(0);
  });

  it.each(["RE20250009", "Beleg 7", "16032026_19000"])("lässt eine Nummer mit Ziffer (%s) offen, wenn der Beleg fehlt", async (feld) => {
    const { jahr, liste } = await laden([feld]);

    expect(jahr.bookings).toEqual({ total: 1, unmatched: 1, withoutNumber: 0 });
    expect(pruefung(jahr).detail).toContain("1 ohne passenden Beleg");
    expect(pruefung(jahr).detail).not.toContain("ohne Belegnummer");
    expect(liste.rows[0]).toMatchObject({ matched: false });
    const offen = await archive.listDatevBookings({ year: 2025, search: "", unmatched: true, page: 0 });
    expect(offen.total).toBe(1);
  });

  it("Gegenprobe: eine gewöhnliche Ausgabe ohne Belegfeld bleibt offen wie bisher", async () => {
    const { jahr, liste } = await laden([""]);

    expect(jahr.bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 1 });
    expect(pruefung(jahr).detail).toContain("1 ohne Belegnummer");
    expect(liste.rows[0]).toMatchObject({ voucherField1: "", matched: false });
    const offen = await archive.listDatevBookings({ year: 2025, search: "", unmatched: true, page: 0 });
    expect(offen.total).toBe(1);
  });

  it("zählt im Abgleich so viele Buchungen ohne Belegnummer, wie die Liste zeigt", async () => {
    const { jahr, liste } = await laden(["Beispielzahldienst", "Beispielkuerzel", "", "RE20250009"]);
    const zahlen = jahr.bookings!;

    expect(zahlen).toEqual({ total: 4, unmatched: 1, withoutNumber: 3 });
    expect(pruefung(jahr).detail).toContain("1 ohne passenden Beleg");
    expect(pruefung(jahr).detail).toContain("3 ohne Belegnummer");
    // Dieselbe Zahl aus der Liste: leeres Feld oder ein Feld ohne eine einzige Ziffer
    const ohneNummer = liste.rows.filter((r) => r.voucherField1.trim() === "" || !/[0-9]/.test(r.voucherField1));
    expect(ohneNummer.map((r) => r.voucherField1)).toEqual(["Beispielzahldienst", "Beispielkuerzel", ""]);
    expect(ohneNummer).toHaveLength(zahlen.withoutNumber);
    // Und offen ist die Zeile mit einer Nummer
    const offen = await archive.listDatevBookings({ year: 2025, search: "", unmatched: true, page: 0 });
    expect(offen.rows.filter((r) => r.voucherField1 !== "")).toHaveLength(zahlen.unmatched);
  });

  it("SKR04: zählt nur die Zeile ohne Belegnummer, die einen Beleg braucht", async () => {
    // Die Bedingung hängt am Kontenrahmen: In SKR04 ist 2100 das Privatkonto, 1800 die Bank
    await sql`update company set kontenrahmen = 'SKR04'`;
    const { jahr, liste } = await ladenMit(
      stapelRoh([`1,00;"S";"EUR";;;;4930;1200;;0101;"Beispielzahldienst";;;"Bürobedarf"`, `1,00;"S";"EUR";;;;1200;2100;;0101;"Beispielzahldienst";;;"Privat"`]),
    );

    expect(jahr.bookings).toEqual({ total: 2, unmatched: 0, withoutNumber: 1 });
    expect(pruefung(jahr).detail).toContain("1 ohne Belegnummer");
    // Die Privatzeile braucht keinen Beleg und zählt deshalb auch nicht ohne Belegnummer
    expect(liste.rows.map((r) => r.account)).toEqual(["4930", "1200"]);
  });

  it("zählt ein Feld ohne Ziffer, das ein Beleg als Nummer trägt, nicht als Buchung ohne Belegnummer", async () => {
    await beleg("Beispielzahldienst");
    const { jahr, liste } = await laden(["Beispielzahldienst"]);

    expect(jahr.bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 0 });
    expect(pruefung(jahr).detail).toEqual("alle gefunden");
    expect(liste.rows[0]).toMatchObject({ matched: true });
  });
});
