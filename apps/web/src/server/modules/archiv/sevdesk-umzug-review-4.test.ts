import type postgres from "postgres";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

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

describe.skipIf(!testDatabaseUrl)("Viertes Review #472", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let exporter: typeof import("./export.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    exporter = await import("./export.ts");
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
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'soll', 'einzelunternehmen')`;
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

  const year2025 = async () => (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;

  // Verdacht: Die Abschlagsrechnung belegt denselben Nummernkreis wie die Stornorechnung, zählt aber nicht als letzte Nummer
  it("nennt eine sevDesk-Abschlagsrechnung als letzte Rechnungsnummer, wenn sie die zuletzt vergebene Nummer trägt", async () => {
    await insert(invoiceRow("11", "RE-2025-0001", "2025-04-08", 11_900, { invoiceType: "RE" }));
    await insert(invoiceRow("12", "RE-2025-0002", "2025-05-10", 5_950, { invoiceType: "AR" }, "downpaymentinvoice"));
    expect((await year2025()).lastInvoiceNumber).toBe("RE-2025-0002");
  });

  // Gegenproben
  it("Probe: Detail und Suche zeigen das Storno-Paar als storniert, ohne Hinweis auf fehlende Zahlungen", async () => {
    await insert(invoiceRow("11", "RE-2025-0001", "2025-04-08", 11_900, { invoiceType: "RE" }));
    await insert(invoiceRow("12", "RE-2025-0002", "2025-04-10", -11_900, { invoiceType: "SR", origin: { id: "11", objectName: "Invoice" } }, "creditnote"));
    const [found] = await lexoffice.findLegacyVouchers("RE-2025-0001");
    expect(found!.voucher.payment).toMatchObject({ status: "cancelled", openAmount: 0, items: [], history: "storno", cancelledOn: "2025-04-10" });
    expect(found!.voucher.paymentHistoryIssue).toBeNull();
  });

  it("Probe: Der Jahresexport schreibt früher falsch gespeicherte C-Belege als Ausgabe und läuft mit Storno-Paar", async () => {
    await insert({
      lexofficeId: "voucher/501",
      type: "salesinvoice",
      direction: "einnahme",
      number: "B-1",
      date: "2025-03-10",
      gross: 11_900,
      status: "open",
      payment: { status: "open", openAmount: 11_900, paidDate: null, items: [] },
      raw: { id: "501", objectName: "Voucher", creditDebit: "C" },
    });
    await insert(invoiceRow("11", "RE-2025-0001", "2025-04-08", 11_900, { invoiceType: "RE" }));
    await insert(invoiceRow("12", "RE-2025-0002", "2025-04-10", -11_900, { invoiceType: "SR", origin: { id: "11", objectName: "Invoice" } }, "creditnote"));
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2025)) chunks.push(chunk);
    const csv = new TextDecoder().decode(unzipSync(Buffer.concat(chunks))["lexoffice/belege.csv"]!);
    const line = csv.split(/\r?\n/).find((l) => l.includes("B-1"))!;
    expect(line).toContain("Ausgabe");
    expect(line).not.toContain("Einnahme");
  });

  it("Probe: Ein Paar über den Jahreswechsel hebt sich im Soll je Jahr nach Belegdatum auf", async () => {
    await insert(invoiceRow("11", "RE-2024-0001", "2024-12-20", 11_900, { invoiceType: "RE" }));
    await insert(invoiceRow("12", "RE-2025-0001", "2025-01-10", -11_900, { invoiceType: "SR", origin: { id: "11", objectName: "Invoice" } }, "creditnote"));
    const { years } = await lexoffice.reconciliation();
    expect(years.find((y) => y.year === 2024)!.einnahmen.gross).toBe(11_900);
    expect(years.find((y) => y.year === 2025)!.einnahmen.gross).toBe(-11_900);
    expect(years.flatMap((y) => y.checks).some((c) => c.label === "Zahlungshistorie vollständig")).toBe(false);
  });
});
