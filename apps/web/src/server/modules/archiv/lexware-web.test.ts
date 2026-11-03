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

type Entry = { list: { entityId: string }; details: unknown; document?: unknown; capsa?: unknown };
const SALES = fixture("sales-invoice.json") as Entry;
const PURCHASE = fixture("purchase-gross.json") as Entry;
const CREDIT_NOTE = fixture("purchase-creditnote-net.json") as Entry;
const QUOTATION = fixture("list-quotation.json");
const CONTACTS = fixture("contacts.json") as unknown as { archived: boolean }[];
const PDF = new TextEncoder().encode("%PDF-1.4\n% Beleg\n%%EOF\n");
const XML = new TextEncoder().encode('<?xml version="1.0"?><rsm:CrossIndustryInvoice/>');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const binary = (bytes: Uint8Array<ArrayBuffer>, type: string, filename: string) =>
  new Response(bytes, { headers: { "content-type": type, "content-disposition": `inline; filename=${filename};` } });

/** Nachgebaute Web-Oberfläche; `fail` lässt die Rechnung beim Laden scheitern */
function fakeLexware(options: { fail?: boolean } = {}) {
  const byId = new Map([SALES, PURCHASE, CREDIT_NOTE].map((e) => [e.list.entityId, e]));
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
    if (url.pathname.startsWith("/grld-rest/voucherservice/1/v100/voucherDetails/")) return json(byId.get(id)!.details);
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

  it("das Skript lädt eine ZIP-Sicherung ohne Angebote herunter", async () => {
    const parts = await runScript(fakeLexware());
    expect(parts.map((p) => p.name)).toEqual([expect.stringMatching(/^lexware-sicherung-\d{4}-\d{2}-\d{2}-teil-01\.zip$/)]);
    const { unzipSync } = await import("fflate");
    const files = Object.keys(unzipSync(parts[0]!.bytes)).sort();
    expect(files).toEqual([
      "belege/10000000-0000-4000-8000-000000000001.json",
      "belege/20000000-0000-4000-8000-000000000001.json",
      "belege/20000000-0000-4000-8000-000000000002.json",
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
    expect(run!.progress).toMatchObject({ contacts: 2, listed: 3, imported: 2, files: 2 });
    expect(run!.progress.failed).toEqual([
      {
        lexofficeId: SALES.list.entityId,
        number: "RE0042",
        message: "In Lexware Office nicht geladen: HTTP 500 bei /papyrus-rest/vouchers/sales-voucher/10000000-0000-4000-8000-000000000001",
      },
    ]);

    const vouchers =
      await sql`select number, type, direction, status, net, tax, gross, contact_id, categories, raw->>'taxType' as tax_type from lexoffice_vouchers order by number`;
    expect(vouchers.map((v) => [v.number, v.type, v.status, v.gross, v.tax, v.tax_type])).toEqual([
      ["2025-4711", "purchaseinvoice", "overdue", 13090, 1978, "gross"],
      ["GS-17", "purchasecreditnote", "paidoff", -5950, -950, "net"],
    ]);
    expect(vouchers[0]!.contact_id).not.toBeNull();
    expect(vouchers[0]!.categories.map((c: { name: string }) => c.name)).toEqual(["Bürobedarf", "Fachliteratur"]);
    const files = await sql`select filename, mime_type, role from lexoffice_voucher_files order by filename`;
    expect(files.map((f) => [f.filename, f.mime_type, f.role])).toEqual([
      ["20000000-0000-4000-8000-000000000001.xml", "application/xml", "anhang"],
      ["2025-4711.pdf", "application/pdf", "anhang"],
    ]);

    // Die überfällige Ausgabe ist ein offener Posten, der sich übernehmen lässt
    const open = await legacyOpen.openLegacyItems();
    expect(open.map((o) => [o.number, o.open, o.blocker])).toEqual([["2025-4711", 13090, null]]);
  });

  it("ein zweiter Lauf holt den fehlgeschlagenen Beleg nach und überspringt den Rest", async () => {
    const parts = await runScript(fakeLexware());
    await lexoffice.startWebImport(actor, parts, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress).toMatchObject({ contacts: 0, imported: 1, skipped: 2, failed: [] });
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
