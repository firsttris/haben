import {
  mapSevCreditNote,
  mapSevInvoice,
  mapSevPaymentLogs,
  mapSevVoucher,
  type SevCheckAccountTransactionLog,
  type SevCreditNote,
  type SevInvoice,
  type SevVoucher,
} from "@haben/import";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import belege from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/belege-credit-debit.json";
import stornoV1 from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/storno-paar.json";
import belegeV2 from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/belege-credit-debit.json";
import gutschriftV2 from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/gutschrift.json";
import rechnungenSteuerV2 from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/rechnungen-steuerregel.json";
import stornoFolgejahrV2 from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/storno-paar-folgejahr.json";
import stornoV2 from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/storno-paar.json";
import zahlungenV2 from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/zahlungen.json";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/* Abgleich und offene Posten mit anonymisierten echten Antworten je Buchhaltungsversion (#472). */

const extfV2 = new URL("../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/extf-buchungsstapel.csv", import.meta.url);

describe.skipIf(!testDatabaseUrl)("sevDesk-Antworten je Buchhaltungsversion (Postgres)", () => {
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
    await sql`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist', 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk')`;
  });

  async function insert(mapped: ReturnType<typeof mapSevInvoice>, raw: object, number = mapped.voucher.number) {
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const v = mapped.voucher;
    const [row] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${v.lexofficeId}, 'sevdesk', ${importId}, ${v.type}, ${v.direction}, ${number}, ${v.date}, ${v.status}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(mapped.payment)}::jsonb, ${JSON.stringify(raw)}::jsonb)
      returning id`;
    return row!.id as string;
  }

  const insertInvoice = (part: { invoice: unknown; positions: unknown[] }) =>
    insert(mapSevInvoice(part.invoice as SevInvoice, part.positions as never[]), { ...(part.invoice as object), positions: part.positions });

  const insertVoucher = (beleg: { voucher: unknown; positions: unknown[] }) =>
    insert(mapSevVoucher(beleg.voucher as SevVoucher, beleg.positions as never[]), { ...(beleg.voucher as object), positions: beleg.positions });

  /** Wie importSevdeskPayments: je Zuordnung eine Zeile, der Beleg kommt aus dem Test. */
  async function pay(voucherId: string, log: unknown) {
    const typed = log as SevCheckAccountTransactionLog;
    const [item] = [...mapSevPaymentLogs([typed]).values()].flat();
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    await sql`insert into legacy_voucher_payments (voucher_id, import_id, source, external_id, transaction_id, account_id, account_name, date, amount, raw)
      values (${voucherId}, ${importId}, 'sevdesk', ${item!.sourceId}, ${item!.transactionId}, ${item!.accountId}, 'Konto', ${item!.date}, ${item!.amount}, ${JSON.stringify(log)}::jsonb)`;
  }

  describe.each([
    ["1.0", stornoV1],
    ["2.0", stornoV2],
    ["2.0, Storno in einem späteren Jahr", stornoFolgejahrV2],
  ])("Buchhaltungsversion %s", (_version, paar) => {
    it("hebt Rechnung und Storno auf: nichts offen, keine Sperre", async () => {
      const ids = [await insertInvoice(paar.original_storniert), await insertInvoice(paar.stornorechnung)];
      const { years } = await lexoffice.reconciliation();
      expect(years.every((y) => y.vatIssue === null)).toBe(true);
      expect(await legacy.openLegacyItems()).toEqual([]);
      for (const id of ids) {
        const detail = await lexoffice.legacyVoucherDetail(id);
        expect(detail!.voucher.paymentHistoryIssue).toBeNull();
        expect(detail!.voucher.payment).toMatchObject({ status: "cancelled", openAmount: 0 });
      }
    });
  });

  it("rechnet Belege aus Version 1.0 nach ihrem Buchungskonto", async () => {
    for (const beleg of belege)
      await insert(mapSevVoucher(beleg.voucher as SevVoucher, beleg.positions as never[]), { ...beleg.voucher, positions: beleg.positions });
    const { years } = await lexoffice.reconciliation();
    const count = (side: "einnahmen" | "ausgaben") => years.reduce((sum, y) => sum + y[side].count, 0);
    expect(count("ausgaben")).toBe(3);
    expect(count("einnahmen")).toBe(1);
  });

  it("rechnet Belege aus Version 2.0 nach creditDebit", async () => {
    for (const beleg of belegeV2) await insertVoucher(beleg);
    const { years } = await lexoffice.reconciliation();
    const count = (side: "einnahmen" | "ausgaben") => years.reduce((sum, y) => sum + y[side].count, 0);
    expect(count("ausgaben")).toBe(belegeV2.filter((b) => b.voucher.creditDebit === "C").length);
    expect(count("einnahmen")).toBe(belegeV2.filter((b) => b.voucher.creditDebit === "D").length);
  });

  it("führt Rechnung und Storno aus Version 2.0 jeweils im eigenen Jahr", async () => {
    const { original_storniert: original, stornorechnung: storno } = stornoFolgejahrV2;
    await insertInvoice(original);
    await insertInvoice(storno);
    const { years } = await lexoffice.reconciliation();
    const einnahmen = (jahr: string) => years.find((y) => y.year === Number(jahr.slice(0, 4)))?.einnahmen.count;
    expect(einnahmen(original.invoice.invoiceDate)).toBe(1);
    expect(einnahmen(storno.invoice.invoiceDate)).toBe(1);
  });

  it("gleicht einen Ausgabebeleg aus Version 2.0 mit negativem Zahlungsbetrag aus", async () => {
    // Log und Beleg stammen aus getrennten Läufen der Anonymisierung; verbunden werden sie erst hier.
    const beleg = belegeV2.find((b) => b.voucher.creditDebit === "C" && b.voucher.status === "1000")!;
    const id = await insertVoucher(beleg);
    await pay(id, zahlungenV2.ausgabebelege[0]);
    const detail = await lexoffice.legacyVoucherDetail(id);
    expect(detail!.voucher.paymentHistoryIssue).toBeNull();
    expect(detail!.voucher.payment).toMatchObject({ status: "balanced", openAmount: 0, items: [{ amount: -10000 }] });
    expect(await legacy.openLegacyItems()).toEqual([]);
  });

  it("gleicht eine Rechnung aus Version 2.0 mit ihrer Zahlung aus", async () => {
    const { invoice, logs } = zahlungenV2.bezahlte_rechnung;
    const id = await insertInvoice({ invoice, positions: [] });
    await pay(id, logs[0]);
    const detail = await lexoffice.legacyVoucherDetail(id);
    expect(detail!.voucher.paymentHistoryIssue).toBeNull();
    expect(detail!.voucher.payment).toMatchObject({ status: "balanced", openAmount: 0, items: [{ amount: 10000 }] });
  });

  it("meldet bei einer Gutschrift aus Version 2.0 ohne Zuordnung die fehlende Zahlungshistorie", async () => {
    const gutschrift = gutschriftV2.objects[0] as unknown as SevCreditNote;
    const id = await insert(mapSevCreditNote(gutschrift, []), gutschrift);
    const detail = await lexoffice.legacyVoucherDetail(id);
    expect(detail!.voucher.gross).toBe(-10000);
    expect(detail!.voucher.paymentHistoryIssue).toMatch(/nicht belegt/);
  });

  it("liest die Steuerart der Einnahmen aus taxRule und taxType von Version 2.0", async () => {
    for (const rechnung of rechnungenSteuerV2) await insertInvoice(rechnung);
    for (const beleg of belegeV2) await insertVoucher(beleg);
    const { years } = await lexoffice.reconciliation();
    const counts: Record<string, number> = {};
    for (const { taxTypes } of years) for (const { taxType, count } of taxTypes) counts[taxType] = (counts[taxType] ?? 0) + count;
    expect(counts).toEqual({ net: 3, vatfree: 2, "sevdesk:noteu": 1 });
  });

  it("findet den Beleg zum gekürzten Belegfeld aus dem Export von Version 2.0 und zählt die UUID nicht", async () => {
    const paar = stornoV2.original_storniert;
    await insert(mapSevInvoice(paar.invoice as SevInvoice, []), paar.invoice, "EBA-BG-EUR-xx-xxxxx-xxxxxxx-xxxxx-xxxxx");
    await archive.addArchiveFile("test-user", {
      bytes: new Uint8Array(readFileSync(extfV2)),
      filename: "EXTF_Buchungsstapel_2024.csv",
      kind: "datev",
      year: null,
    });
    const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2024);
    expect(year!.bookings).toEqual({ total: 2, unmatched: 0, withoutNumber: 1 });
  });
});
