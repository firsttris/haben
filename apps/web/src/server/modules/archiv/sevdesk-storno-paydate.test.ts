import { mapSevInvoice, type SevInvoice } from "@haben/import";
import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import paar from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/storno-paar.json";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #472, Bericht aus Buchhaltungsversion 2.0: Bei einem Storno von 2020 trägt die Stornorechnung `payDate` (Tag des Stornos),
 * aber `paidAmount` 0; sevDesk hat sie beim Stornieren als bezahlt markiert, ohne dass Geld floss. Entscheidung im Issue:
 * Bei einer SR mit `origin` und `paidAmount` 0 gilt das `payDate` nicht als Zahlung. Nachgestellt mit dem Aufbau der
 * anonymisierten Antwort aus `buchhaltung-2.0/storno-paar.json`, Zahlungstag erfunden.
 */

const PAY_DATE = "2025-04-10T15:42:00+02:00";

describe.skipIf(!testDatabaseUrl)("sevDesk-Stornorechnung mit Zahlungstag ohne Zahlung (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  let exporter: typeof import("./export.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    exporter = await import("./export.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: string, versteuerung: string) {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await leeren(sql)`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk')`;
  }

  beforeEach(() => reset("SKR03", "ist"));

  async function insert(part: { invoice: unknown; positions: unknown[] }, change: Record<string, unknown> = {}) {
    const raw = { ...(part.invoice as Record<string, unknown>), ...change };
    const { voucher: v, payment } = mapSevInvoice(raw as unknown as SevInvoice, part.positions as never[]);
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const [row] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${v.lexofficeId}, 'sevdesk', ${importId}, ${v.type}, ${v.direction}, ${v.number}, ${v.date}, ${v.status}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(payment)}::jsonb, ${JSON.stringify({ ...raw, positions: part.positions })}::jsonb)
      returning id`;
    return row!.id as string;
  }

  const insertPair = async (storno: Record<string, unknown> = { payDate: PAY_DATE }) => ({
    original: await insert(paar.original_storniert),
    storno: await insert(paar.stornorechnung, storno),
  });

  const status = async (id: string) => (await lexoffice.legacyVoucherDetail(id))!.voucher.payment?.status;

  it("geht von einer Antwort aus, deren Stornorechnung paidAmount 0 und origin trägt", () => {
    expect(paar.stornorechnung.invoice).toMatchObject({ invoiceType: "SR", paidAmount: "0.00", origin: { id: paar.original_storniert.invoice.id } });
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR03", "soll"],
    ["SKR04", "ist"],
    ["SKR04", "soll"],
  ])("wertet das Paar bei %s und %s als storniert, ohne Sperre", async (kontenrahmen, versteuerung) => {
    await reset(kontenrahmen, versteuerung);
    const { original, storno } = await insertPair();
    expect(await status(original)).toBe("cancelled");
    expect(await status(storno)).toBe("cancelled");
    const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
    expect(year.vatIssue).toBeNull();
    expect(year.vat.every((m) => m.kz81 === 0 && m.tax81 === 0)).toBe(true);
  });

  it("lässt keinen offenen Posten", async () => {
    await insertPair();
    expect(await legacy.openLegacyItems("2025-12-31")).toEqual([]);
  });

  it("nennt im Jahresexport keinen Zahlungstag", async () => {
    await insertPair();
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2025)) chunks.push(chunk);
    const lines = new TextDecoder().decode(unzipSync(Buffer.concat(chunks))["lexoffice/belege.csv"]!).split(/\r?\n/);
    const separator = lines[0]!.includes(";") ? ";" : ",";
    const header = lines[0]!
      .replace(/^﻿/, "")
      .split(separator)
      .map((c) => c.replaceAll('"', ""));
    const column = header.indexOf("Bezahlt am");
    const number = String(paar.stornorechnung.invoice.invoiceNumber);
    const row = lines
      .find((l) => l.includes(number))!
      .split(separator)
      .map((c) => c.replaceAll('"', ""));
    expect(row[column]).toBe("");
  });

  it("bleibt unklar, wenn die Stornorechnung einen Betrag als bezahlt führt", async () => {
    const { original } = await insertPair({ payDate: PAY_DATE, paidAmount: "10.00" });
    expect(await status(original)).not.toBe("cancelled");
  });

  it("bleibt unklar, wenn die Stornorechnung paidAmount gar nicht nennt", async () => {
    const { original } = await insertPair({ payDate: PAY_DATE, paidAmount: null });
    expect(await status(original)).not.toBe("cancelled");
  });

  it("bleibt unklar, wenn die stornierte Rechnung einen Zahlungstag trägt", async () => {
    const original = await insert(paar.original_storniert, { payDate: PAY_DATE });
    await insert(paar.stornorechnung, { payDate: PAY_DATE });
    expect(await status(original)).not.toBe("cancelled");
  });
});
