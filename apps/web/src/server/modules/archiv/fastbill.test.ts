import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Antworten in der Form eines echten Kontos (November 2026, anonymisiert): Beträge als Zahl, IDs und Schalter als Text,
// leere Daten als "0000-00-00 00:00:00", Zahlungen mit Datum TT.MM.JJJJ, VAT_CASE als "0"/"1". Namen und Beträge erfunden.
const API = "https://my.fastbill.com/api/1.0/api.php";
const KEY = "0123456789abcdef0123456789abcdef";
const PDF = new TextEncoder().encode("%PDF-1.4\n% Rechnung 2024-7\n%%EOF\n");
const RECEIPT = new TextEncoder().encode("%PDF-1.4\n% Beleg Bürobedarf\n%%EOF\n");

const CUSTOMERS = [
  {
    CUSTOMER_ID: "501",
    CUSTOMER_NUMBER: "1001",
    CUSTOMER_TYPE: "business",
    ORGANIZATION: "Muster GmbH",
    ADDRESS: "Hauptstr. 1",
    ZIPCODE: "10115",
    CITY: "Berlin",
    COUNTRY_CODE: "DE",
    EMAIL: "",
    VAT_ID: "",
  },
  { CUSTOMER_ID: "502", CUSTOMER_NUMBER: "1002", CUSTOMER_TYPE: "consumer", ORGANIZATION: "", FIRST_NAME: "Erika", LAST_NAME: "Beispiel", COUNTRY_CODE: "DE" },
];

const base = {
  SUBTYPE: "standard",
  IS_CANCELED: "0",
  CURRENCY_CODE: "EUR",
  VAT_CASE: "0",
  PAID_DATE: "0000-00-00 00:00:00",
  SERVICE_PERIOD_START: "0000-00-00 00:00:00",
  SERVICE_PERIOD_END: "0000-00-00 00:00:00",
  DELIVERY_DATE: "0000-00-00 00:00:00",
  PAYMENTS: [],
};

const OUTGOING = [
  {
    ...base,
    INVOICE_ID: "7001",
    TYPE: "outgoing",
    STATE: "paid",
    INVOICE_NUMBER: "2024-7",
    CUSTOMER_ID: "501",
    ORGANIZATION: "Muster GmbH",
    INVOICE_DATE: "2024-03-05",
    DUE_DATE: "2024-03-19",
    PAID_DATE: "2024-03-20 00:00:00",
    SUB_TOTAL: 100,
    VAT_TOTAL: 19,
    TOTAL: 119,
    VAT_ITEMS: [{ VAT_PERCENT: 19, COMPLETE_NET: 100, VAT_VALUE: 19 }],
    PAYMENTS: [{ PAYMENT_ID: "9001", DATE: "20.03.2024", AMOUNT: "119.00", CURRENCY_CODE: "EUR", NOTE: "", TYPE: "Bank" }],
    DOCUMENT_URL: "https://my.fastbill.com/download/rechnung-7001",
  },
  {
    ...base,
    INVOICE_ID: "7002",
    TYPE: "outgoing",
    STATE: "canceled",
    IS_CANCELED: "1",
    INVOICE_NUMBER: "2024-8",
    CUSTOMER_ID: "502",
    FIRST_NAME: "Erika",
    LAST_NAME: "Beispiel",
    INVOICE_DATE: "2024-04-02",
    SUB_TOTAL: 50,
    VAT_TOTAL: 9.5,
    TOTAL: 59.5,
    VAT_ITEMS: [{ VAT_PERCENT: 19, COMPLETE_NET: 50, VAT_VALUE: 9.5 }],
    DOCUMENT_URL: "https://my.fastbill.com/download/rechnung-7002",
  },
  {
    ...base,
    INVOICE_ID: "7004",
    TYPE: "outgoing",
    STATE: "unpaid",
    VAT_CASE: "1",
    INVOICE_NUMBER: "2024-10",
    CUSTOMER_ID: "501",
    ORGANIZATION: "Muster GmbH",
    INVOICE_DATE: "2024-05-10",
    DUE_DATE: "2024-05-24",
    SUB_TOTAL: 300,
    VAT_TOTAL: 0,
    TOTAL: 300,
    VAT_ITEMS: [{ VAT_PERCENT: 0, COMPLETE_NET: 300, VAT_VALUE: 0 }],
    PAYMENTS: [{ PAYMENT_ID: "9002", DATE: "30.05.2024", AMOUNT: "100.00", CURRENCY_CODE: "EUR", NOTE: "", TYPE: "Bank" }],
    DOCUMENT_URL: "https://my.fastbill.com/download/rechnung-7004",
  },
];

const CREDITS = [
  {
    ...base,
    INVOICE_ID: "7003",
    TYPE: "credit",
    STATE: "issued",
    INVOICE_NUMBER: "2024-9",
    CUSTOMER_ID: "502",
    REFERENCED_INVOICE_ID: "7002",
    INVOICE_DATE: "2024-04-03",
    SUB_TOTAL: -50,
    VAT_TOTAL: -9.5,
    TOTAL: -59.5,
    VAT_ITEMS: [{ VAT_PERCENT: 19, COMPLETE_NET: -50, VAT_VALUE: -9.5 }],
    DOCUMENT_URL: "https://my.fastbill.com/download/rechnung-7003",
  },
];

const EXPENSES = [
  {
    INVOICE_ID: "8001",
    ORGANIZATION: "Bürobedarf Beispiel",
    CATEGORY: [],
    INVOICE_NUMBER: "L-881",
    INVOICE_DATE: "2024-02-10",
    PAID_DATE: "2024-02-12 00:00:00",
    CURRENCY_CODE: "EUR",
    SUB_TOTAL: 50,
    VAT_TOTAL: 9.5,
    TOTAL: 59.5,
    VAT_ITEMS: [{ VAT_PERCENT: 19, COMPLETE_NET: 50, VAT_VALUE: 9.5 }],
    VAT_CASE: null,
    DOCUMENT_URL: "https://my.fastbill.com/download/beleg-8001",
  },
  {
    INVOICE_ID: "8002",
    ORGANIZATION: "Software Beispiel",
    CATEGORY: [],
    INVOICE_NUMBER: "",
    INVOICE_DATE: "2024-02-15",
    PAID_DATE: "2024-02-15 00:00:00",
    CURRENCY_CODE: "EUR",
    SUB_TOTAL: 5,
    VAT_TOTAL: 0.95,
    TOTAL: 5.95,
    VAT_ITEMS: [{ VAT_PERCENT: 19, COMPLETE_NET: 5, VAT_VALUE: 0.95 }],
    VAT_CASE: null,
    // Beleg nur im angemeldeten Browser: FastBill antwortet der API mit leerem HTML
    DOCUMENT_URL: "https://my.fastbill.com/download/beleg-8002",
  },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=UTF-8" } });
}

interface Server {
  calls: { service: string; filter: Record<string, string>; auth: string | null }[];
  documents: { url: string; auth: string | null }[];
  /** wird vor jeder Antwort auf einen Dienst aufgerufen, etwa um den Lauf abzubrechen */
  onService?: (service: string) => Promise<void> | void;
}

function fakeFastbill(server: Server): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    if (url !== API) {
      server.documents.push({ url, auth });
      if (url.endsWith("rechnung-7001") || url.endsWith("rechnung-7002") || url.endsWith("rechnung-7003") || url.endsWith("rechnung-7004"))
        return new Response(PDF, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="Rechnung.pdf"' } });
      if (url.endsWith("beleg-8001")) return new Response(RECEIPT, { headers: { "content-type": "application/pdf" } });
      return new Response("", { headers: { "content-type": "text/html; charset=UTF-8" } });
    }
    const body = JSON.parse(String(init?.body)) as { SERVICE: string; FILTER: Record<string, string>; OFFSET: number };
    server.calls.push({ service: body.SERVICE, filter: body.FILTER, auth });
    await server.onService?.(body.SERVICE);
    if (auth !== `Basic ${Buffer.from(`inhaber@example.de:${KEY}`).toString("base64")}`)
      return json({ REQUEST: body, RESPONSE: { ERRORS: ["Login Error: Wrong API KEY or user credentials."] } }, 401);
    const page = (key: string, items: unknown[]) => json({ REQUEST: body, RESPONSE: { [key]: body.OFFSET === 0 ? items : [] } });
    if (body.SERVICE === "customer.get") return page("CUSTOMERS", CUSTOMERS);
    if (body.SERVICE === "expense.get") return page("EXPENSES", EXPENSES);
    if (body.SERVICE === "invoice.get") {
      if (body.FILTER.TYPE === "outgoing") return page("INVOICES", OUTGOING);
      if (body.FILTER.TYPE === "credit") return page("INVOICES", CREDITS);
      if (body.FILTER.STATE === "canceled") return page("INVOICES", [OUTGOING[1]]);
    }
    return json({ REQUEST: body, RESPONSE: { ERRORS: ["Unknown service"] } });
  }) as typeof fetch;
}

describe.skipIf(!testDatabaseUrl)("Umzug aus FastBill (Postgres)", () => {
  let fastbill: typeof import("./fastbill.ts");
  let lexoffice: typeof import("./lexoffice.ts");
  let importPkg: typeof import("@haben/import");
  let sql: postgres.Sql;
  let server: Server;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    fastbill = await import("./fastbill.ts");
    lexoffice = await import("./lexoffice.ts");
    importPkg = await import("@haben/import");
  }, 30_000);

  beforeEach(() => {
    server = { calls: [], documents: [] };
    fastbill.setFastbillClientFactory(
      (o) => new importPkg.FastbillClient({ ...o, fetch: fakeFastbill(server), minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("lehnt falsche Zugangsdaten ab und speichert nichts", async () => {
    await expect(fastbill.saveFastbillKey(actor, { email: "falsch@example.de", apiKey: KEY, callsPerHour: 50 })).rejects.toThrow(
      "FastBill lehnt die Anmeldung ab: Login-E-Mail oder API-Schlüssel falsch",
    );
    expect(await fastbill.fastbillConnectionStatus()).toBeNull();
  });

  it("speichert den Schlüssel verschlüsselt und übernimmt Kunden, Rechnungen, Storno und Ausgaben mit PDFs", async () => {
    expect(await fastbill.saveFastbillKey(actor, { email: " inhaber@example.de ", apiKey: KEY, callsPerHour: 50 })).toEqual({ email: "inhaber@example.de" });
    const [conn] = await sql`select email, ciphertext, calls_per_hour from fastbill_connection`;
    expect(conn).toMatchObject({ email: "inhaber@example.de", calls_per_hour: 50 });
    expect(Buffer.from(conn!.ciphertext as Uint8Array).toString("utf8")).not.toContain(KEY);

    await fastbill.startFastbillImport(actor, { wait: true });
    const run = await fastbill.latestFastbillImport();
    expect(run).toMatchObject({ status: "fertig", source: "fastbill" });
    // Die Ausgabe 8002 wartet auf ihren Beleg, statt ohne Datei ins Archiv zu kommen
    expect(run!.progress).toMatchObject({ contacts: 2, listed: 6, imported: 5, skipped: 0, files: 5, failed: [], fastbillWaiting: 1 });
    // Kunden, drei Durchläufe Rechnungen, Ausgaben; die Prüfung beim Speichern hat einen eigenen Client, PDFs zählen nicht
    expect(run!.progress.fastbillCalls).toHaveLength(5);
    // Entwürfe werden gar nicht abgefragt
    expect(server.calls.filter((c) => c.service === "invoice.get").map((c) => c.filter)).toEqual([
      { TYPE: "outgoing" },
      { TYPE: "credit" },
      { STATE: "canceled" },
    ]);
    // PDFs ohne Zugangsdaten
    expect(server.documents).toHaveLength(6);
    expect(server.documents.every((d) => d.auth === null)).toBe(true);

    const contacts =
      await sql`select fastbill_id, name, is_customer, is_supplier, kundennummer from contacts where fastbill_id is not null order by fastbill_id`;
    expect(contacts).toEqual([
      { fastbill_id: "501", name: "Muster GmbH", is_customer: true, is_supplier: false, kundennummer: "1001" },
      { fastbill_id: "502", name: "Erika Beispiel", is_customer: true, is_supplier: false, kundennummer: "1002" },
    ]);

    const vouchers = await sql`
      select v.lexoffice_id, v.type, v.direction, v.number, v.status, v.gross, v.payment, c.fastbill_id as contact,
        (select count(*)::int from lexoffice_voucher_files f where f.voucher_id = v.id) as files
      from lexoffice_vouchers v left join contacts c on c.id = v.contact_id
      where v.source = 'fastbill' order by v.lexoffice_id`;
    expect(vouchers.map((v) => [v.lexoffice_id, v.type, v.status, v.gross, v.contact, v.files])).toEqual([
      ["fastbill/expense/8001", "purchaseinvoice", "paid", 5950, null, 1],
      ["fastbill/invoice/7001", "invoice", "paid", 11_900, "501", 1],
      ["fastbill/invoice/7002", "invoice", "voided", 5950, "502", 1],
      ["fastbill/invoice/7003", "creditnote", "voided", -5950, "502", 1],
      ["fastbill/invoice/7004", "invoice", "unpaid", 30_000, "501", 1],
    ]);
    const byId = new Map(vouchers.map((v) => [v.lexoffice_id as string, v]));
    expect(byId.get("fastbill/invoice/7001")!.payment).toEqual({
      status: "balanced",
      openAmount: 0,
      paidDate: "2024-03-20",
      items: [{ type: "payment", date: "2024-03-20", amount: 11_900, account: "Bank" }],
    });
    expect(byId.get("fastbill/invoice/7003")!.payment).toMatchObject({ status: "balanced", openAmount: 0 });
    expect(byId.get("fastbill/invoice/7004")!.payment).toMatchObject({ status: "partlyPaid", openAmount: 20_000 });
    expect(await sql`select expense_id, status, number, date, supplier, gross, document_url from fastbill_receipts`).toEqual([
      {
        expense_id: "8002",
        status: "wartet",
        number: "",
        date: "2024-02-15",
        supplier: "Software Beispiel",
        gross: 595,
        document_url: "https://my.fastbill.com/download/beleg-8002",
      },
    ]);
  });

  it("übernimmt die wartende Ausgabe mit dem Beleg aus dem Browser-Skript", async () => {
    expect(await fastbill.fastbillReceiptScriptList()).toEqual([{ id: "8002", url: "https://my.fastbill.com/download/beleg-8002" }]);
    const manifest = new TextEncoder().encode(JSON.stringify({ format: "haben-fastbill-belege", version: 1 }));
    await expect(fastbill.uploadFastbillReceipts(actor, new TextEncoder().encode("kein zip"))).rejects.toThrow("kein lesbares ZIP");
    await expect(fastbill.uploadFastbillReceipts(actor, zipSync({ "belege/8002.pdf": RECEIPT }))).rejects.toThrow("manifest.json");
    // Kein PDF und kein Bild: abgelehnt, die Ausgabe wartet weiter
    expect(await fastbill.uploadFastbillReceipts(actor, zipSync({ "manifest.json": manifest, "belege/8002.pdf": new TextEncoder().encode("hallo") }))).toEqual({
      accepted: 0,
      unknown: 0,
      invalid: ["belege/8002.pdf"],
    });
    // Wie an echten Belegen: das PDF samt Hülle des Formular-Uploads, mit dem es einmal in FastBill kam
    const boundary = "-------------------------------11112222333344";
    const wrapped = new Uint8Array([
      ...new TextEncoder().encode(
        `${boundary}\r\nContent-Disposition: form-data; name="beleg.pdf"; filename="beleg.pdf"\r\nContent-Type: application/x-gzip\r\n\r\n`,
      ),
      ...RECEIPT,
      ...new TextEncoder().encode(`\r\n${boundary}--\r\n`),
    ]);
    expect(
      await fastbill.uploadFastbillReceipts(actor, zipSync({ "manifest.json": manifest, "belege/8002.pdf": wrapped, "belege/9999.pdf": RECEIPT })),
    ).toEqual({
      accepted: 1,
      unknown: 1,
      invalid: [],
    });
    expect((await fastbill.fastbillReceiptsOverview()).map((r) => [r.expenseId, r.status, r.filename])).toEqual([["8002", "datei", "8002.pdf"]]);
    // Gespeichert ist das PDF selbst, Byte für Byte, ohne Hülle
    const [ready] = await sql`select sha256, size from fastbill_receipts where expense_id = '8002'`;
    expect(ready).toEqual({ sha256: createHash("sha256").update(RECEIPT).digest("hex"), size: RECEIPT.byteLength });

    await fastbill.startFastbillImport(actor, { wait: true });
    const run = await fastbill.latestFastbillImport();
    expect(run!.progress).toMatchObject({ imported: 1, skipped: 5, files: 1, fastbillWaiting: 0, failed: [] });
    const [voucher] = await sql`
      select v.type, (select count(*)::int from lexoffice_voucher_files f where f.voucher_id = v.id and f.role = 'anhang') as files
      from lexoffice_vouchers v where v.lexoffice_id = 'fastbill/expense/8002'`;
    expect(voucher).toEqual({ type: "purchaseinvoice", files: 1 });
    expect(await sql`select * from fastbill_receipts`).toEqual([]);
  });

  it("ändert das Zwischenlager nicht, solange ein Abruf aus FastBill läuft", async () => {
    const [run] = await sql`insert into lexoffice_imports (source, status, progress)
      values ('fastbill', 'laeuft', '{"phase":"belege","contacts":0,"contactsLinked":0,"listed":0,"imported":0,"skipped":0,"files":0,"failed":[]}'::jsonb)
      returning id`;
    try {
      const manifest = new TextEncoder().encode(JSON.stringify({ format: "haben-fastbill-belege", version: 1 }));
      await expect(fastbill.uploadFastbillReceipts(actor, zipSync({ "manifest.json": manifest }))).rejects.toThrow("Während eines Abrufs aus FastBill");
      await expect(fastbill.markFastbillWithoutReceipt(actor)).rejects.toThrow("Während eines Abrufs aus FastBill");
    } finally {
      await sql`update lexoffice_imports set status = 'abgebrochen', finished_at = now() where id = ${run!.id}`;
    }
  });

  it("übernimmt eine wartende Ausgabe ohne Beleg erst nach ausdrücklicher Entscheidung", async () => {
    EXPENSES.push({ ...EXPENSES[1]!, INVOICE_ID: "8003", INVOICE_NUMBER: "S-3", DOCUMENT_URL: "https://my.fastbill.com/download/beleg-8003" });
    try {
      await fastbill.startFastbillImport(actor, { wait: true });
      expect((await fastbill.latestFastbillImport())!.progress).toMatchObject({ imported: 0, fastbillWaiting: 1 });
      expect(await fastbill.markFastbillWithoutReceipt(actor)).toBe(1);
      expect(await fastbill.markFastbillWithoutReceipt(actor)).toBe(0);
      await fastbill.startFastbillImport(actor, { wait: true });
      expect((await fastbill.latestFastbillImport())!.progress).toMatchObject({ imported: 1, fastbillWaiting: 0 });
      const [voucher] = await sql`
        select (select count(*)::int from lexoffice_voucher_files f where f.voucher_id = v.id) as files
        from lexoffice_vouchers v where v.lexoffice_id = 'fastbill/expense/8003'`;
      expect(voucher).toEqual({ files: 0 });
      expect(await sql`select * from fastbill_receipts`).toEqual([]);
    } finally {
      EXPENSES.pop();
    }
  });

  it("überspringt beim zweiten Lauf, was schon im Archiv liegt, und rechnet die Aufrufe des ersten an", async () => {
    const before = (await fastbill.latestFastbillImport())!.progress.fastbillCalls!;
    expect(before.length).toBeGreaterThan(0);
    await fastbill.startFastbillImport(actor, { wait: true });
    const run = await fastbill.latestFastbillImport();
    expect(run!.progress).toMatchObject({ contacts: 0, imported: 0, skipped: 6, failed: [], fastbillWaiting: 0 });
    expect(run!.progress.fastbillCalls!.length).toBe(before.length + 5);
    const [count] = await sql`select count(*)::int as n from lexoffice_vouchers where source = 'fastbill'`;
    expect(count!.n).toBe(7);
  });

  it("ordnet die Steuerart nach VAT_CASE ein: 0 regulär, 1 unbekannt (Lieferung oder sonstige Leistung)", async () => {
    const check = await lexoffice.reconciliation();
    const year = check.years.find((y: { year: number }) => y.year === 2024) as { taxTypes: { taxType: string; count: number }[] } | undefined;
    expect(year?.taxTypes).toEqual(
      expect.arrayContaining([
        { taxType: "net", count: 3 },
        { taxType: "fastbill:eu", count: 1 },
      ]),
    );
  });

  it("ein Abbruch endet als abgebrochen, nicht als Fehler", async () => {
    // Archivierte Belege sind gesperrt; der Abbruch fällt deshalb schon in die Liste, bevor ein Beleg drankommt
    server.onService = async (service) => {
      if (service !== "expense.get") return;
      const [run] = await sql`select id from lexoffice_imports where status = 'laeuft'`;
      expect(fastbill.cancelFastbillImport(run!.id as string)).toBe(true);
    };
    await fastbill.startFastbillImport(actor, { wait: true });
    const run = await fastbill.latestFastbillImport();
    expect({ status: run!.status, failed: run!.progress.failed.length, imported: run!.progress.imported }).toEqual({
      status: "abgebrochen",
      failed: 0,
      imported: 0,
    });
  });

  it("bricht bei abgelaufenem Schlüssel mit Fehler ab", async () => {
    await sql`update fastbill_connection set email = 'anders@example.de'`;
    await fastbill.startFastbillImport(actor, { wait: true });
    const run = await fastbill.latestFastbillImport();
    expect(run).toMatchObject({ status: "fehler", error: "Login-E-Mail oder API-Schlüssel falsch" });
  });

  it("legt die DOCUMENT_URL (Link mit eigenem Schlüssel) nicht ins unveränderliche Archiv", async () => {
    const rows = await sql`select lexoffice_id from lexoffice_vouchers where source = 'fastbill' and raw ? 'DOCUMENT_URL' order by lexoffice_id`;
    expect(rows.map((r) => r.lexoffice_id)).toEqual([]);
  });

  it("ein verwaister FastBill-Lauf blockiert den Abruf aus Lexware Office nicht", async () => {
    const { encrypt } = await import("../../crypto.ts");
    await sql`insert into lexoffice_imports (source, status, progress, updated_at, started_at)
      values ('fastbill', 'laeuft', '{"phase":"belege","contacts":0,"contactsLinked":0,"listed":0,"imported":0,"skipped":0,"files":0,"failed":[]}'::jsonb,
        now() - interval '1 hour', now())`;
    await sql`insert into lexoffice_connection (id, ciphertext) values (1, ${encrypt(Buffer.from("x".repeat(32)))})`;
    lexoffice.setLexofficeClientFactory(() => ({}) as never);
    try {
      await expect(lexoffice.startImport(actor, { wait: true })).resolves.toBeTypeOf("string");
    } finally {
      await sql`delete from lexoffice_connection`;
    }
  });
});
