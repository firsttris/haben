import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Der ganze Weg ohne Public API: Das echte Skript aus apps/web/public läuft gegen nachgebaute Endpunkte
 * der Web-Oberfläche, seine ZIP-Teile gehen durch startWebImport in die Datenbank.
 */

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../../../../../packages/import/test-fixtures/lexoffice-web/${name}`, import.meta.url), "utf8"));
const SCRIPT = readFileSync(new URL("../../../../public/lexware-sicherung.js", import.meta.url), "utf8");

type Entry = {
  list: { entityId: string };
  details: unknown;
  document?: unknown;
  capsa?: unknown;
  financial?: { payments: { paymentId: string }[]; transactions: { financialTransactionId: string }[] };
};
const SALES = fixture("sales-invoice.json") as Entry;
const PURCHASE = fixture("purchase-gross.json") as Entry;
const CREDIT_NOTE = fixture("purchase-creditnote-net.json") as Entry;
const QUOTATION = fixture("list-quotation.json");
const FINANCIAL = fixture("financial-purchase.json") as Entry;
const FINANCIAL_PRIVATE = fixture("financial-private.json") as Entry;
/** Ein Bankumsatz, der schon zur Ausgabe 2025-4711 gehört; das Skript fragt ihn nicht nach */
const ASSIGNED_TRANSACTION = { financialTransactionId: "t-beleg", transactionDate: "2025-10-20T00:00:00.000+00:00", amount: -130.9, numberOfVouchers: 1 };
const CONTACTS = fixture("contacts.json") as unknown as { archived: boolean }[];
const PDF = new TextEncoder().encode("%PDF-1.4\n% Beleg\n%%EOF\n");
const XML = new TextEncoder().encode('<?xml version="1.0"?><rsm:CrossIndustryInvoice/>');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const binary = (bytes: Uint8Array<ArrayBuffer>, type: string, filename: string) =>
  new Response(bytes, { headers: { "content-type": type, "content-disposition": `inline; filename=${filename};` } });

/** Nachgebaute Web-Oberfläche; `fail` lässt die Rechnung beim Laden scheitern, `asked` sammelt die nachgefragten Bankumsätze */
function fakeLexware(options: { fail?: boolean; asked?: string[] } = {}) {
  const byId = new Map([SALES, PURCHASE, CREDIT_NOTE, FINANCIAL, FINANCIAL_PRIVATE].map((e) => [e.list.entityId, e]));
  const withoutReceipt = [FINANCIAL, FINANCIAL_PRIVATE];
  const asked = options.asked ?? [];
  return async (path: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(path, "https://app.lexware.de");
    const id = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (url.pathname === "/desmos-rest/contacts/v1/search") {
      const { archived } = JSON.parse(String(init?.body)) as { archived: boolean };
      return json({ totalResults: 1, elements: CONTACTS.filter((c) => c.archived === archived) });
    }
    if (url.pathname === "/grld-rest/voucherservice/1/v200/vouchers") {
      const content = url.searchParams.get("archived") === "true" ? [CREDIT_NOTE.list] : [SALES.list, PURCHASE.list, QUOTATION];
      return json({ numFound: content.length, content });
    }
    if (url.pathname.startsWith("/grld-rest/voucherservice/1/v100/voucherDetails/")) {
      const details = byId.get(id)!.details as object;
      // Die Ausgabe ist per Bank bezahlt: ihr Bankumsatz steht in den Zahlungen
      if (id !== PURCHASE.list.entityId) return json(details);
      return json({
        ...details,
        paymentListItems: [
          { paymentItemType: "openExpense", amount: 130.9 },
          { referenceType: "FinancialTransaction", referenceId: "t-beleg" },
        ],
      });
    }
    if (url.pathname === "/fis/finance-rest/financialtransactionservice/v3/financialTransactions") {
      const content = [ASSIGNED_TRANSACTION, ...withoutReceipt.flatMap((e) => e.financial!.transactions)];
      return json({ totalElements: content.length, totalPages: 1, size: 500, number: 0, content });
    }
    if (url.pathname.startsWith("/fis/finance-rest/voucherpaymentintegrationservice/v100/voucherPayments/financialTransaction/")) {
      asked.push(id);
      return json({ voucherPayments: withoutReceipt.flatMap((e) => e.financial!.payments.filter((p) => p.paymentId === id)) });
    }
    if (url.pathname.startsWith("/grld-rest/financialvoucherservice/v100/financialVoucher/")) return json(byId.get(id)!.details);
    if (url.pathname.startsWith("/papyrus-rest/vouchers/sales-voucher/")) {
      return options.fail ? json({ message: "kaputt" }, 500) : json(SALES.document, 423);
    }
    if (url.pathname.startsWith("/salesdocgen/")) return binary(PDF, "application/pdf", "Rechnung_RE0042.pdf");
    if (url.pathname.startsWith("/capsa/capsa-rest/vouchers/v1/vouchers/")) return json(byId.get(id)!.capsa);
    if (url.pathname.startsWith("/grld-rest/printservice/")) {
      const fileId = url.pathname.split("/").filter(Boolean).at(-1);
      return fileId === PURCHASE.list.entityId ? binary(PDF, "application/pdf", "2025-4711.pdf") : json({}, 400);
    }
    if (url.pathname.endsWith("/einvoice")) return binary(XML, "application/xml;charset=UTF-8", `${PURCHASE.list.entityId}.xml`);
    return json({ message: `unbekannt ${url.pathname}` }, 404);
  };
}

/** Führt das Skript aus wie in der Konsole und gibt die heruntergeladenen ZIP-Teile zurück */
async function runScript(fetchFn: ReturnType<typeof fakeLexware>) {
  const blobs = new Map<string, Blob>();
  const downloads: { name: string; bytes: Uint8Array }[] = [];
  const document = {
    body: { appendChild: () => {} },
    createElement: () => ({
      href: "",
      download: "",
      remove: () => {},
      click() {
        downloads.push({ name: this.download, bytes: new Uint8Array() });
        void blobs
          .get(this.href)!
          .arrayBuffer()
          .then((b) => (downloads.find((d) => d.name === this.download)!.bytes = new Uint8Array(b)));
      },
    }),
  };
  const url = {
    createObjectURL: (blob: Blob) => {
      const key = `blob:${blobs.size}`;
      blobs.set(key, blob);
      return key;
    },
    revokeObjectURL: () => {},
  };
  const body = SCRIPT.slice(SCRIPT.indexOf("(async () =>"));
  const run = new Function("location", "fetch", "document", "URL", "console", "setTimeout", `return ${body}`) as (...args: unknown[]) => Promise<void>;
  const quiet = { log: () => {} };
  await run({ hostname: "app.lexware.de", origin: "https://app.lexware.de" }, fetchFn, document, url, quiet, (fn: () => void) => setImmediate(fn));
  await new Promise((resolve) => setImmediate(resolve));
  return downloads;
}

describe.skipIf(!testDatabaseUrl)("Umzug über die Web-Oberfläche (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let legacyOpen: typeof import("./legacy-open.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    legacyOpen = await import("./legacy-open.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("das Skript lädt eine ZIP-Sicherung ohne Angebote herunter, mit den Buchungen ohne Beleg", async () => {
    const asked: string[] = [];
    const parts = await runScript(fakeLexware({ asked }));
    // Nur Bankumsätze ohne Beleg aus der Liste werden nachgefragt
    expect(asked.sort()).toEqual(["t0000000-0000-4000-8000-000000000001", "t0000000-0000-4000-8000-000000000002"]);
    expect(parts.map((p) => p.name)).toEqual([expect.stringMatching(/^lexware-sicherung-\d{4}-\d{2}-\d{2}-teil-01\.zip$/)]);
    const { unzipSync } = await import("fflate");
    const files = Object.keys(unzipSync(parts[0]!.bytes)).sort();
    expect(files).toEqual([
      "belege/10000000-0000-4000-8000-000000000001.json",
      "belege/20000000-0000-4000-8000-000000000001.json",
      "belege/20000000-0000-4000-8000-000000000002.json",
      "belege/30000000-0000-4000-8000-000000000001.json",
      "belege/30000000-0000-4000-8000-000000000002.json",
      "dateien/10000000-0000-4000-8000-000000000001/1-Rechnung_RE0042.pdf",
      "dateien/20000000-0000-4000-8000-000000000001/1-2025-4711.pdf",
      "dateien/20000000-0000-4000-8000-000000000001/2-20000000-0000-4000-8000-000000000001.xml",
      "kontakte.json",
      "manifest.json",
    ]);
  });

  it("übernimmt Kontakte, Rechnungen und Belege mit Dateien und Zahlungen; ein fehlgeschlagener Beleg steht in der Liste", async () => {
    const parts = await runScript(fakeLexware({ fail: true }));
    const id = await lexoffice.startWebImport(actor, parts, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run).toMatchObject({ id, status: "fertig" });
    expect(run!.progress).toMatchObject({ contacts: 2, listed: 5, imported: 4, files: 2 });
    expect(run!.progress.failed).toEqual([
      {
        lexofficeId: SALES.list.entityId,
        number: "RE0042",
        message: "In Lexware Office nicht geladen: HTTP 500 bei /papyrus-rest/vouchers/sales-voucher/10000000-0000-4000-8000-000000000001",
      },
    ]);

    const vouchers =
      await sql`select number, type, direction, status, net, tax, gross, contact_id, categories, raw->>'taxType' as tax_type from lexoffice_vouchers order by number, type`;
    expect(vouchers.map((v) => [v.number, v.type, v.status, v.gross, v.tax, v.tax_type])).toEqual([
      ["", "purchaseinvoice", "paid", 25000, 3992, "gross"],
      ["", "salesinvoice", "paid", 25000, 0, "gross"],
      ["2025-4711", "purchaseinvoice", "overdue", 13090, 1978, "gross"],
      ["GS-17", "purchasecreditnote", "paidoff", -5950, -950, "net"],
    ]);
    expect(vouchers[2]!.contact_id).not.toBeNull();
    expect(vouchers[2]!.categories.map((c: { name: string }) => c.name)).toEqual(["Bürobedarf", "Fachliteratur"]);
    const files = await sql`select filename, mime_type, role from lexoffice_voucher_files order by filename`;
    expect(files.map((f) => [f.filename, f.mime_type, f.role])).toEqual([
      ["20000000-0000-4000-8000-000000000001.xml", "application/xml", "anhang"],
      ["2025-4711.pdf", "application/pdf", "anhang"],
    ]);

    // Die überfällige Ausgabe ist ein offener Posten, der sich übernehmen lässt
    const open = await legacyOpen.openLegacyItems();
    expect(open.map((o) => [o.number, o.open, o.blocker])).toEqual([["2025-4711", 13090, null]]);
  });

  it("Abgleich: Buchungen ohne Beleg zählen in der Vorsteuer, brauchen keine Datei; Privateinlagen zählen nicht", async () => {
    const { years } = await lexoffice.reconciliation();
    const year = years.find((y) => y.year === 2026)!;
    expect(year.ausgaben).toMatchObject({ count: 1, net: 21008, tax: 3992 });
    expect(year.einnahmen).toMatchObject({ count: 0, net: 0 });
    expect(year.withoutFile).toBe(0);
    expect(year.checks[0]).toMatchObject({ ok: true, detail: "0 Belege, 2 Buchungen ohne Beleg" });
    expect(year.vat.map((m) => [m.month, m.kz66, m.otherBase])).toEqual([["2026-06", 3992, 0]]);
    const { vouchers } = await lexoffice.legacyVouchersForPeriod({ period: "2026", direction: "alle", search: "", withPayments: true, limit: 50 });
    expect(vouchers.map((v) => [v.date, v.tax, v.contactName])).toEqual([["2026-06-28", 3992, "Autohaus Beispiel"]]);
    // Die Privateinlage fehlt nicht still, sie steht als nicht betrieblich daneben
    expect(year.neutral).toEqual([{ kind: "privat", label: "Privat und Geldtransit", count: 1, zufluss: expect.any(Number), abfluss: 0 }]);
  });

  it("GmbH: dieselbe Privateinlage ist eine Einlage des Gesellschafters (Verrechnungskonto)", async () => {
    await sql`update company set rechtsform = 'gmbh'`;
    try {
      const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2026)!;
      expect(year.ausgaben).toMatchObject({ count: 1, net: 21008, tax: 3992 });
      expect(year.neutral.map((n) => [n.kind, n.count])).toEqual([["gesellschafter", 1]]);
    } finally {
      await sql`update company set rechtsform = 'einzelunternehmen'`;
    }
  });

  it("ein zweiter Lauf holt den fehlgeschlagenen Beleg nach und überspringt den Rest", async () => {
    const parts = await runScript(fakeLexware());
    await lexoffice.startWebImport(actor, parts, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress).toMatchObject({ contacts: 0, imported: 1, skipped: 4, failed: [] });
    const [invoice] =
      await sql`select gross, tax, status, payment, raw->'taxConditions'->>'taxType' as tax_type, raw->'address'->>'city' as city from lexoffice_vouchers where number = 'RE0042'`;
    expect(invoice).toMatchObject({ gross: 62475, tax: 9975, status: "paid", tax_type: "net", city: "Berlin" });
    expect(invoice!.payment).toMatchObject({
      status: "balanced",
      paidDate: "2025-12-01",
      items: [
        { type: "partPaymentFinancialTransaction", amount: 60000 },
        { type: "manualPayment", amount: 2475 },
      ],
    });
    const [pdf] =
      await sql`select f.filename, f.role from lexoffice_voucher_files f join lexoffice_vouchers v on v.id = f.voucher_id where v.number = 'RE0042'`;
    expect(pdf).toMatchObject({ filename: "Rechnung_RE0042.pdf", role: "pdf" });
  });

  it("lehnt eine fremde Datei ab, ohne einen Lauf zu starten", async () => {
    const before = await lexoffice.latestImport();
    await expect(lexoffice.startWebImport(actor, [{ name: "foto.zip", bytes: new TextEncoder().encode("kein zip") }])).rejects.toThrow(
      "foto.zip: keine gültige ZIP-Datei.",
    );
    expect((await lexoffice.latestImport())?.id).toBe(before?.id);
  });
});
