import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Belegende Tests aus dem zweiten TDD-Review zu #503 (#472). Zum Ausführen nach
 * apps/web/src/server/modules/archiv/review2-472.test.ts kopieren.
 */

const stack = (rows: string[]) => {
  const header = `"EXTF";700;21;"Buchungsstapel";13;20260102120000000;;"SD";"";"";1001;12345;20250101;4;20250101;20251231;"sevDesk";"";1;0;0;"EUR";;"";;;"03";;;"";""`;
  const columns = `Umsatz;Soll-/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basisumsatz;WKZ Basisumsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext`;
  return new TextEncoder().encode([header, columns, ...rows].join("\r\n"));
};

const UUID_NUMBER = "1f2e3d4c-5b6a-4789-8abc-0123456789ab";
const BALANCED = { status: "balanced", openAmount: 0, paidDate: null, items: [] };

type Row = {
  lexofficeId: string;
  type: string;
  direction: "einnahme" | "ausgabe";
  number: string;
  date: string;
  gross: number;
  status: string;
  payment: Record<string, unknown>;
  raw: Record<string, unknown>;
};

describe.skipIf(!testDatabaseUrl)("Zweites Review #472", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  let archive: typeof import("./archive.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
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
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports,
      contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist', 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
  });

  async function insert(row: Row) {
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const tax = Math.round((row.gross * 19) / 119);
    const [created] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${row.lexofficeId}, 'sevdesk', ${importId}, ${row.type}, ${row.direction}, ${row.number}, ${row.date}, ${row.status}, ${row.gross - tax}, ${tax}, ${row.gross},
        ${JSON.stringify([{ rate: 1900, net: row.gross - tax, tax }])}::jsonb, '[]'::jsonb, ${JSON.stringify(row.payment)}::jsonb, ${JSON.stringify(row.raw)}::jsonb)
      returning id`;
    return created!.id as string;
  }

  const invoiceRow = (id: string, number: string, date: string, gross: number, raw: Record<string, unknown>, type = "invoice"): Row => ({
    lexofficeId: `invoice/${id}`,
    type,
    direction: "einnahme",
    number,
    date,
    gross,
    status: "paid",
    payment: BALANCED,
    raw: { id, objectName: "Invoice", status: "1000", paidAmount: 0, payDate: null, ...raw },
  });

  const voucherRow = (id: string, number: string, creditDebit: "C" | "D", values: Partial<Row> = {}): Row => ({
    lexofficeId: `voucher/${id}`,
    type: creditDebit === "C" ? "salesinvoice" : "purchaseinvoice",
    direction: creditDebit === "C" ? "einnahme" : "ausgabe",
    number,
    date: "2025-03-10",
    gross: 11_900,
    status: "open",
    payment: { status: "open", openAmount: 11_900, paidDate: null, items: [] },
    ...values,
    raw: { id, objectName: "Voucher", creditDebit, status: "100", ...values.raw },
  });

  const year2025 = async () => (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;

  // Verdacht 1: Die Stornorechnung trägt laut Fixture buchhaltung-1.0/storno-paar.json eine Nummer aus demselben Kreis (RE-2024-0002)
  it("nennt die Stornorechnung als letzte Rechnungsnummer, weil sie denselben Nummernkreis belegt", async () => {
    await insert(invoiceRow("11", "RE-2025-0001", "2025-04-08", 11_900, { invoiceType: "RE" }));
    await insert(invoiceRow("12", "RE-2025-0002", "2025-04-10", -11_900, { invoiceType: "SR", origin: { id: "11", objectName: "Invoice" } }, "creditnote"));
    expect((await year2025()).lastInvoiceNumber).toBe("RE-2025-0002");
  });

  // Verdacht 2: Der Abgleich findet UUID-förmige Belegnummern, die Suche nimmt sie nur als Kennung
  it("findet einen Beleg, dessen Belegnummer wie eine UUID aussieht", async () => {
    await insert(voucherRow("501", UUID_NUMBER, "C"));
    const found = await lexoffice.findLegacyVouchers(UUID_NUMBER);
    expect(found.map((f) => f.voucher.number)).toEqual([UUID_NUMBER]);
  });

  it("findet einen Beleg, dessen gekürzte Nummer wie eine UUID aussieht, so wie der Abgleich", async () => {
    const number = `EBA-${UUID_NUMBER}`;
    await insert(voucherRow("501", number, "C"));
    await archive.addArchiveFile("test-user", {
      bytes: stack([`1,00;"H";"EUR";;;;70001;4390;"9";0101;"${UUID_NUMBER}";"";;"gekürzt"`]),
      filename: "EXTF_Buchungsstapel_2025.csv",
      kind: "datev",
      year: null,
    });
    expect((await year2025()).bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 0 });
    const found = await lexoffice.findLegacyVouchers(UUID_NUMBER);
    expect(found.map((f) => f.voucher.number)).toEqual([number]);
  });

  // Verdacht 3: Die Zeitraumabfrage sperrt auch wegen Ausgaben, der Abgleich nur wegen Einnahmen
  it("sperrt die zahlungsbezogene Zeitraumabfrage nicht wegen eines bezahlten Ausgabebelegs, wenn der Abgleich frei ist", async () => {
    await insert(
      voucherRow("501", "B-1", "C", {
        status: "paid",
        payment: BALANCED,
        raw: { paidAmount: 11_900, payDate: "2025-03-12T00:00:00+01:00" },
      }),
    );
    expect((await year2025()).vatIssue).toBeNull();
    const period = await lexoffice.legacyVouchersForPeriod({ period: "2025", direction: "alle", search: "", withPayments: true, limit: 10 });
    expect(period.vouchers.map((v) => [v.number, v.direction])).toEqual([["B-1", "ausgabe"]]);
  });

  // Gegenproben
  it("Probe: ein früher übernommener Beleg mit Storno nach dem Stichtag bleibt übernommen", async () => {
    const id = await insert(invoiceRow("11", "RE-1", "2025-04-08", 11_900, { invoiceType: "RE" }));
    await insert(invoiceRow("12", "RE-2", "2025-05-10", -11_900, { invoiceType: "SR", origin: { id: "11", objectName: "Invoice" } }, "creditnote"));
    await sql`insert into documents (sha256, filename, mime_type, size, status, supplier_name, invoice_number, document_date, net, tax, gross, lexoffice_voucher_id)
      values (${"c".repeat(64)}, 'c.pdf', 'application/pdf', 4, 'gebucht', 'Kunde', 'RE-1', '2025-04-08', 10000, 1900, 11900, ${id})`;
    const [item] = await legacy.openLegacyItems("2025-04-30");
    expect(item).toMatchObject({ number: "RE-1", takenOver: { kind: "document" } });
    await expect(legacy.takeOverLegacyItem("test-user", id, "2025-04-30")).rejects.toThrow(/Schon übernommen/);
  });

  it("Probe: Kleinschreibung von creditDebit und paidAmount als Text", async () => {
    await insert(voucherRow("601", "B-D", "D", { raw: { creditDebit: "d" } }));
    await insert(invoiceRow("11", "RE-1", "2025-04-08", 11_900, { invoiceType: "RE", paidAmount: "0.00" }));
    await insert(
      invoiceRow("12", "RE-2", "2025-04-10", -11_900, { invoiceType: "sr", paidAmount: "0,00", origin: { id: 11, objectName: "Invoice" } }, "creditnote"),
    );
    const year = await year2025();
    expect(year.einnahmen).toMatchObject({ count: 3, gross: 11_900 });
    expect(year.vatIssue).toBeNull();
  });

  it("Probe: eine leere Belegnummer in Stapel und Beleg zählt weiter als ohne Belegnummer", async () => {
    await insert(voucherRow("501", "", "C"));
    await archive.addArchiveFile("test-user", {
      bytes: stack([`1,00;"H";"EUR";;;;70001;4390;"9";0101;"";"";;"ohne"`]),
      filename: "EXTF_Buchungsstapel_2025.csv",
      kind: "datev",
      year: null,
    });
    expect((await year2025()).bookings).toEqual({ total: 1, unmatched: 0, withoutNumber: 1 });
  });
});
