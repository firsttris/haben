import { mapSevInvoice, type SevInvoice } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #1369: Der Buchungstext „Aufladung Guthaben“ macht eine Zeile nur dann zur Aufladung ohne Bezug, wenn Belegfeld 1 leer
 * ist. Trägt die Zeile eine Belegnummer, ohne dass ein Beleg sie trägt, gehört sie unter „Nur ohne passenden Beleg“ wie
 * jede andere offene Buchung — sonst widersprechen sich Liste und Abgleich. Findet sie ihren Beleg, ist sie erledigt und
 * steht nicht mehr als „Aufladung ohne Bezug“. Konten, Nummern und Namen sind erfunden.
 */

/** Eine Aufladung: Soll Aufwand an Bank (SKR03 4900 an 1200), Buchungstext wie Haben ihn schreibt. */
const row = (field: string, text = "Aufladung Guthaben: Sonstiger Aufwand · Beispiel Funk") => `1,00;"S";"EUR";;;;4900;1200;;0101;"${field}";;;"${text}"`;

const stapel = (zeilen: string[]) =>
  [
    '"EXTF";700;21;"Buchungsstapel";13;;;"";"";"";0;0;20250101;4;20250101;20251231;"";"";;;0;"EUR";;"";;;"";;;"";',
    "Umsatz;Soll-/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basisumsatz;WKZ Basisumsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext",
    ...zeilen,
  ].join("\r\n");

describe.skipIf(!testDatabaseUrl)("Aufladung und Belegfeld 1 im DATEV-Abgleich (Postgres)", () => {
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

  /** Ein Beleg, dessen Nummer genau dem Belegfeld entspricht; die Nummer ist erfunden. */
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

  async function laden(zeilen: string[]) {
    await archive.addArchiveFile("test-user", {
      bytes: new TextEncoder().encode(stapel(zeilen)),
      filename: "EXTF_Buchungsstapel_2025.csv",
      kind: "datev",
      year: null,
    });
    const jahr = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
    const liste = await archive.listDatevBookings({ year: 2025, search: "", unmatched: false, page: 0 });
    const offen = await archive.listDatevBookings({ year: 2025, search: "", unmatched: true, page: 0 });
    const gruppe = await archive.listDatevBookings({ year: 2025, search: "", unmatched: false, aufladung: true, page: 0 });
    return { jahr, liste, offen, gruppe };
  }

  const pruefung = (jahr: { checks: { label: string; detail: string; ok: boolean }[] }) =>
    jahr.checks.find((c) => c.label === "Jede Buchung mit Belegnummer findet ihren Beleg")!;

  it("eine Aufladung mit Belegnummer ohne Beleg steht unter „Nur ohne passenden Beleg“", async () => {
    const { jahr, offen, gruppe } = await laden([row("RE-4711")]);

    expect(offen.rows.map((r) => r.voucherField1)).toEqual(["RE-4711"]);
    expect(offen.total).toBe(1);
    // Dieselbe Zeile ist keine Aufladung ohne Bezug: Sie hat einen Bezug, nur fehlt der Beleg noch
    expect(gruppe.total).toBe(0);
    // Und der Abgleich zählt sie genauso als offen
    expect(jahr.bookings).toEqual({ total: 1, unmatched: 1, withoutNumber: 0 });
    expect(pruefung(jahr).detail).toContain("1 ohne passenden Beleg");
  });

  it("eine Aufladung mit leerem Belegfeld bleibt in der eigenen Gruppe", async () => {
    const { jahr, offen, gruppe } = await laden([row("")]);

    expect(gruppe.total).toBe(1);
    expect(gruppe.rows.every((r) => r.aufladung && !r.matched)).toBe(true);
    expect(offen.total).toBe(0);
    expect(jahr.bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 1 });
  });

  it("eine Aufladung mit gefundenem Beleg ist erledigt und nicht „Aufladung ohne Bezug“", async () => {
    await beleg("RE-4711");
    const { jahr, liste, offen, gruppe } = await laden([row("RE-4711")]);

    expect(liste.rows[0]).toMatchObject({ voucherField1: "RE-4711", matched: true, aufladung: false });
    expect(offen.total).toBe(0);
    expect(gruppe.total).toBe(0);
    expect(jahr.bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 0 });
  });

  it("Gegenprobe: eine gewöhnliche Ausgabe mit Belegnummer bleibt offen", async () => {
    const { offen, gruppe } = await laden([row("RE-4711", "Bürobedarf")]);

    expect(offen.rows.map((r) => r.voucherField1)).toEqual(["RE-4711"]);
    expect(gruppe.total).toBe(0);
  });
});
