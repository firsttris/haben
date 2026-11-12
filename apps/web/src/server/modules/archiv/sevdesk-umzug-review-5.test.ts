import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/* Stornopaare aus früheren Abrufen: Der Jahresexport darf für sie keinen Zahlungstag nennen (#472). */

type Row = { lexofficeId: string; type: string; number: string; date: string; gross: number; raw: Record<string, unknown> };

const oldPayment = (date: string, gross: number) => ({
  status: "balanced",
  openAmount: 0,
  paidDate: date,
  items: [{ type: "manualPayment", date, amount: Math.abs(gross) }],
});

const invoice: Row = {
  lexofficeId: "invoice/11",
  type: "invoice",
  number: "RE-2025-0001",
  date: "2025-04-08",
  gross: 11_900,
  raw: { id: "11", objectName: "Invoice", invoiceType: "RE", status: "1000", paidAmount: 0, payDate: null },
};

const storno: Row = {
  lexofficeId: "invoice/12",
  type: "creditnote",
  number: "RE-2025-0002",
  date: "2025-04-10",
  gross: -11_900,
  raw: { id: "12", objectName: "Invoice", invoiceType: "SR", status: "1000", paidAmount: 0, payDate: null, origin: { id: "11", objectName: "Invoice" } },
};

describe.skipIf(!testDatabaseUrl)("Jahresexport von sevDesk-Stornopaaren (Postgres)", () => {
  let exporter: typeof import("./export.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
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
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports,
      contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist', 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
  });

  async function insert(row: Row) {
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const tax = Math.round((row.gross * 19) / 119);
    const net = row.gross - tax;
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${row.lexofficeId}, 'sevdesk', ${importId}, ${row.type}, 'einnahme', ${row.number}, ${row.date}, 'paid', ${net}, ${tax}, ${row.gross},
        ${JSON.stringify([{ rate: 1900, net, tax }])}::jsonb, '[]'::jsonb, ${JSON.stringify(oldPayment(row.date, row.gross))}::jsonb, ${JSON.stringify(row.raw)}::jsonb)`;
  }

  async function bezahltAm() {
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2025)) chunks.push(chunk);
    const lines = new TextDecoder().decode(unzipSync(Buffer.concat(chunks))["lexoffice/belege.csv"]!).split(/\r?\n/);
    const separator = lines[0]!.includes(";") ? ";" : ",";
    const column = lines[0]!
      .replace(/^﻿/, "")
      .split(separator)
      .findIndex((c) => c.replaceAll('"', "") === "Bezahlt am");
    return (number: string) =>
      lines
        .find((l) => l.includes(number))!
        .split(separator)
        [column]!.replaceAll('"', "");
  }

  it("schreibt für eine stornierte Rechnung aus einem früheren Abruf kein „Bezahlt am“ in belege.csv", async () => {
    await insert(invoice);
    await insert(storno);
    const spalte = await bezahltAm();
    expect(spalte("RE-2025-0001")).toBe("");
    expect(spalte("RE-2025-0002")).toBe("");
  });

  it("behält den Zahlungstag einer Rechnung ohne Storno", async () => {
    await insert(invoice);
    expect((await bezahltAm())("RE-2025-0001")).toBe("2025-04-08");
  });
});
