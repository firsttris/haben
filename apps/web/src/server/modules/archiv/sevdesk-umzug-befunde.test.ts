import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Befunde aus #472. Die Rohdaten folgen echten Antworten von sevDesk (Buchhaltungsversion 1.0, Beträge erfunden).
 * Die Zeilen werden wie von einem früheren Abruf eingefügt: Das Archiv ist nur anhängbar, die Korrektur muss beim Lesen greifen.
 */

type Row = {
  lexofficeId: string;
  type: string;
  direction: "einnahme" | "ausgabe";
  number: string;
  date: string;
  gross: number;
  status: string;
  payment: { status: string; openAmount: number; paidDate: string | null; items: unknown[] };
  raw: Record<string, unknown>;
  source?: "sevdesk" | "lexoffice";
};

const BALANCED = { status: "balanced", openAmount: 0, paidDate: null, items: [] };

const invoice = (id: string, values: Partial<Row> & { number: string; date: string; gross: number; raw?: Record<string, unknown> }): Row => ({
  lexofficeId: `invoice/${id}`,
  type: "invoice",
  direction: "einnahme",
  status: "paid",
  payment: BALANCED,
  ...values,
  raw: { id, objectName: "Invoice", invoiceType: "RE", status: "1000", paidAmount: 0, payDate: null, ...values.raw },
});

/** Das Paar aus #472: Schlussrechnung und ihre Stornorechnung, beide „bezahlt“ ohne Zahlung */
const original = invoice("11", {
  number: "RE-2025-0001",
  date: "2025-04-08",
  gross: 11_900,
  raw: { invoiceType: "ER", origin: { id: "99", objectName: "Order" } },
});
const storno = (date = "2025-04-10", gross = -11_900) =>
  invoice("12", {
    type: "creditnote",
    number: "RE-2025-0002",
    date,
    gross,
    raw: { invoiceType: "SR", origin: { id: "11", objectName: "Invoice" } },
  });

const stack = (rows: string[]) => {
  const header = `"EXTF";700;21;"Buchungsstapel";13;20260102120000000;;"SD";"";"";1001;12345;20250101;4;20250101;20251231;"sevDesk";"";1;0;0;"EUR";;"";;;"03";;;"";""`;
  const columns = `Umsatz;Soll-/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basisumsatz;WKZ Basisumsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext`;
  return new TextEncoder().encode([header, columns, ...rows].join("\r\n"));
};

const INTERNAL_ID = "1f2e3d4c-5b6a-4789-8abc-0123456789ab";

describe.skipIf(!testDatabaseUrl)("sevDesk-Umzug: Befunde aus #472 (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  let archive: typeof import("./archive.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    archive = await import("./archive.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: "SKR03" | "SKR04" = "SKR03", versteuerung: "ist" | "soll" = "ist") {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await sql`truncate journal_lines, journal_entries, document_amounts, documents, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
  }

  async function insert(row: Row) {
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const tax = Math.round((row.gross * 19) / 119);
    const [created] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${row.lexofficeId}, ${row.source ?? "sevdesk"}, ${importId}, ${row.type}, ${row.direction}, ${row.number}, ${row.date}, ${row.status}, ${row.gross - tax}, ${tax}, ${row.gross},
        ${JSON.stringify([{ rate: 1900, net: row.gross - tax, tax }])}::jsonb, '[]'::jsonb, ${JSON.stringify(row.payment)}::jsonb, ${JSON.stringify(row.raw)}::jsonb)
      returning id`;
    return created!.id as string;
  }

  /** Beleg eines früheren Abrufs: C wurde als Einnahme gespeichert, D als Ausgabe */
  const oldVoucher = (id: string, creditDebit: "C" | "D", values: Partial<Row> & { date: string; gross: number; number: string }): Row => ({
    lexofficeId: `voucher/${id}`,
    type: creditDebit === "C" ? "salesinvoice" : "purchaseinvoice",
    direction: creditDebit === "C" ? "einnahme" : "ausgabe",
    status: "open",
    payment: { status: "open", openAmount: values.gross, paidDate: null, items: [] },
    ...values,
    raw: { id, objectName: "Voucher", creditDebit, status: "100", ...values.raw },
  });

  describe.each([
    ["SKR03", "ist"],
    ["SKR03", "soll"],
    ["SKR04", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s, %s", (kontenrahmen, versteuerung) => {
    beforeEach(() => setup(kontenrahmen, versteuerung));

    it("rechnet Belege mit creditDebit C als Ausgabe und D als Einnahme, auch aus früheren Abrufen", async () => {
      await insert(oldVoucher("501", "C", { number: "B-1", date: "2025-03-10", gross: 11_900 }));
      await insert(oldVoucher("502", "D", { number: "B-2", date: "2025-03-11", gross: 5_950 }));
      const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
      expect(year.ausgaben).toMatchObject({ count: 1, net: 10_000, tax: 1_900 });
      expect(year.einnahmen).toMatchObject({ count: 1, net: 5_000, tax: 950 });
    });

    it("übernimmt einen offenen Ausgabebeleg eines früheren Abrufs als Verbindlichkeit", async () => {
      const id = await insert(oldVoucher("501", "C", { number: "B-1", date: "2025-03-10", gross: 11_900 }));
      await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size) values (${id}, 'anhang', 'b.pdf', 'application/pdf', ${"a".repeat(64)}, 4)`;
      const items = await legacy.openLegacyItems();
      expect(items.map((i) => [i.number, i.direction, i.type, i.open, i.blocker])).toEqual([["B-1", "ausgabe", "purchaseinvoice", 11_900, null]]);
      expect(await legacy.takeOverLegacyItem(actor, id)).toMatchObject({ kind: "document" });
      const lines =
        await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_type = 'document' order by l.debit desc`;
      expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
        ["9000", 11_900, 0],
        [kontenrahmen === "SKR03" ? "1600" : "3300", 0, 11_900],
      ]);
    });

    it("erkennt die Stornorechnung: kein offener Posten, keine Sperre, Umsatz hebt sich auf", async () => {
      const id = await insert(original);
      const stornoId = await insert(storno());
      const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
      expect(year.vatIssue).toBeNull();
      expect(year.checks.map((c) => c.label)).not.toContain("Zahlungshistorie vollständig");
      expect(year.einnahmen).toMatchObject({ count: 2, net: 0, tax: 0, gross: 0 });
      expect(await legacy.openLegacyItems()).toEqual([]);
      for (const voucherId of [id, stornoId]) {
        const detail = await lexoffice.legacyVoucherDetail(voucherId);
        expect(detail!.voucher.paymentHistoryIssue).toBeNull();
        expect(detail!.voucher.payment).toMatchObject({ status: "cancelled", openAmount: 0, items: [] });
      }
    });
  });

  describe("Grenzen der Storno-Erkennung", () => {
    beforeEach(() => setup());

    it("sperrt die Übernahme, wenn erst nach dem Stichtag storniert wurde", async () => {
      await insert(original);
      await insert(storno("2025-05-10"));
      const [item] = await legacy.openLegacyItems("2025-04-30");
      expect(item).toMatchObject({ number: "RE-2025-0001", open: 11_900, openKnown: false, blocker: expect.stringContaining("Storno nach dem Stichtag") });
    });

    it("lässt eine bezahlte Rechnung mit Storno unklar: die Zahlung ist nicht erklärt", async () => {
      const id = await insert({ ...original, raw: { ...original.raw, paidAmount: 50 } });
      await insert(storno());
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher.paymentHistoryIssue).toMatch(/Zahlungshistorie unvollständig/);
    });

    it("erkennt keine Teilstornierung als Storno der ganzen Rechnung", async () => {
      const id = await insert(original);
      await insert(storno("2025-04-10", -5_950));
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher.paymentHistoryIssue).toMatch(/Zahlungshistorie unvollständig/);
    });
  });

  describe("Belegnummern aus dem DATEV-Export", () => {
    beforeEach(() => setup());

    const LONG = "EBA-BG-EUR-24-10001-2000001-30001-40001";
    const bookings = () =>
      archive.addArchiveFile(actor, {
        bytes: stack([
          `1,00;"H";"EUR";;;;70001;4390;"9";0101;"${LONG.slice(-36)}";"";;"gekürzt"`,
          `1,00;"H";"EUR";;;;1201;70001;;0102;"${INTERNAL_ID}";"";;"Zahlung"`,
          `1,00;"H";"EUR";;;;1201;4390;"9";0103;"X-404";"";;"Unbekannt"`,
        ]),
        filename: "EXTF_Buchungsstapel_2025.csv",
        kind: "datev",
        year: null,
      });

    it("findet von sevDesk gekürzte Nummern und zählt interne Kennungen nicht als Belegnummer", async () => {
      await insert(oldVoucher("501", "C", { number: LONG, date: "2025-01-01", gross: 119 }));
      await bookings();
      const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
      expect(year.bookings).toEqual({ total: 3, unmatched: 1, withoutNumber: 1 });
      const list = await archive.listDatevBookings({ year: 2025, search: "", unmatched: true, page: 0 });
      expect(list.rows.map((r) => r.voucherField1)).toEqual(["X-404"]);
    });

    it("verlangt bei der Kürzung die vollen 36 Zeichen", async () => {
      await insert(oldVoucher("501", "C", { number: LONG, date: "2025-01-01", gross: 119 }));
      await archive.addArchiveFile(actor, {
        bytes: stack([`1,00;"H";"EUR";;;;70001;4390;"9";0101;"${LONG.slice(-20)}";"";;"Teil"`]),
        filename: "EXTF_Buchungsstapel_2025.csv",
        kind: "datev",
        year: null,
      });
      expect((await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!.bookings).toEqual({ total: 1, unmatched: 1, withoutNumber: 0 });
    });

    it("lässt Lexoffice-Bestände unverändert", async () => {
      await insert({
        ...invoice("7", { number: LONG, date: "2025-01-01", gross: 119 }),
        lexofficeId: "lex-7",
        source: "lexoffice",
        status: "open",
        payment: { status: "open", openAmount: 119, paidDate: null, items: [] },
      });
      await bookings();
      expect((await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!.bookings).toEqual({ total: 3, unmatched: 3, withoutNumber: 0 });
    });
  });
});
