import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #1624, Punkte 1 und 2 aus der Beitragsprüfung:
 *
 * 1. Zwei Anhänge mit demselben Inhalt: Kam im ersten Lauf nur einer, fügte der zweite Lauf dieselbe sha256 noch einmal
 *    ein; der eindeutige Index `lexoffice_voucher_files_unique (voucher_id, sha256)` riss die Nachlade-Transaktion ab,
 *    und der Beleg blieb dauerhaft „Abruf fehlgeschlagen“. Das Einfügen ist jetzt idempotent, der Stand „nachgeladen“
 *    entsteht trotzdem.
 * 2. Ein fehlendes XML einer E-Rechnung ist wie bei sevDesk ein fehlender Anhang (`anhang_fehlt`, Rolle `xml`) und kein
 *    fehlgeschlagener Abruf: Es sperrt die Übernahme des offenen Postens, und ein späterer Lauf holt es nach.
 */

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../../../../../packages/import/test-fixtures/lexoffice/${name}`, import.meta.url), "utf8"));

const VOUCHER = fixture("voucher-gross.json");
/** Die Rechnung ist offen: nur dann steht sie als offener Posten in der Liste */
const RECHNUNG: Record<string, unknown> = { ...fixture("invoice-two-rates.json"), voucherStatus: "open" };
const ANHANG_A = "5a1d2b6e-3c4f-4e5a-9b8c-7d6e5f4a3b2c";
const ANHANG_B = "6b2e3c7f-4d5a-4f6b-8c9d-8e7f6a5b4c3d";
/** Beide Anhänge tragen denselben Inhalt: je Beleg hängt er nur einmal, der eindeutige Index lässt nichts anderes zu */
const GLEICHER_INHALT = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 7]);
const PDF = new TextEncoder().encode("%PDF-1.4\n% Rechnung RE1019\n%%EOF\n");
const XML = new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice><ID>RE1019</ID></Invoice>\n');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function page(content: unknown[]) {
  return { content, first: true, last: true, totalPages: 1, totalElements: content.length, number: 0, size: 250, numberOfElements: content.length };
}

const listItem = (id: string, voucherType: string, voucherStatus: string, voucherNumber: string) => ({
  id,
  voucherType,
  voucherStatus,
  voucherNumber,
  voucherDate: "2023-02-21T00:00:00.000+01:00",
  createdDate: "2023-02-21T14:43:28.000+01:00",
  updatedDate: "2023-02-21T14:45:01.000+01:00",
  contactName: "Berliner Kindl GmbH",
  totalAmount: 100,
  openAmount: 0,
  currency: "EUR",
  archived: false,
});

/** Steuert, ob der Abruf den zweiten Anhang herausgibt; der erste Lauf liefert nur den ersten */
let zweiterAnhang = false;

/** Nachgebaute Lexware-API: ein Ausgabebeleg mit zwei Anhängen gleichen Inhalts */
function fakeApiGleicherInhalt() {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    if (new Headers(init?.headers).get("authorization") !== "Bearer schluessel-1234567890-abcdefghij") return json({ message: "Unauthorized" }, 401);
    if (path === "/profile") return json(fixture("profile.json"));
    if (path === "/posting-categories") return json([]);
    if (path === "/contacts") return json(page([]));
    if (path === "/voucherlist") {
      if (url.searchParams.get("archived") === "true") return json(page([]));
      return json(page([listItem(String(VOUCHER.id), "purchaseinvoice", "paid", "2023-4711")]));
    }
    if (path === `/vouchers/${VOUCHER.id}`) return json({ ...VOUCHER, files: [ANHANG_A, ANHANG_B] });
    if (path === `/files/${ANHANG_A}` || (zweiterAnhang && path === `/files/${ANHANG_B}`))
      return new Response(GLEICHER_INHALT, { headers: { "content-type": "image/jpeg", "content-disposition": 'attachment; filename="Quittung.jpg"' } });
    if (path.startsWith("/files/")) return json({ message: "Datei nicht in der Sicherung" }, 500);
    if (path.startsWith("/payments/")) return json({ message: "not found" }, 404);
    return json({ message: `unbekannt ${path}` }, 404);
  }) as typeof fetch;
}

describe.skipIf(!testDatabaseUrl)("Lexoffice: gleicher Inhalt beim Nachladen (#1624)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  const actor = "test-user";
  let sql: postgres.Sql;
  let belegId = "";

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    const importPkg = await import("@haben/import");
    lexoffice.setLexofficeClientFactory(
      (o) => new importPkg.LexofficeClient({ ...o, fetch: fakeApiGleicherInhalt(), minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
    await lexoffice.saveApiKey(actor, "schluessel-1234567890-abcdefghij");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("legt den Beleg an und lässt den zweiten Anhang gleichen Inhalts offen", async () => {
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress).toMatchObject({ listed: 1, imported: 1, files: 1, failed: [] });

    const [beleg] = await sql`select id from lexoffice_vouchers where number = '2023-4711'`;
    belegId = String(beleg!.id);
    const staende = await sql`select state, role, source_file_id from legacy_file_states where voucher_id = ${beleg!.id}`;
    expect(staende.map((s) => [s.state, s.role, s.source_file_id])).toEqual([["abruf_fehlgeschlagen", "anhang", ANHANG_B]]);
  });

  it("holt den Anhang mit demselben Inhalt nach, ohne die Transaktion am eindeutigen Index zu verlieren", async () => {
    zweiterAnhang = true;
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    // Ohne den Fix bricht der zweite Lauf am Unique-Index (voucher_id, sha256) ab: „failed“ statt „nachgeladen“
    expect(run!.progress).toMatchObject({ nachgeladen: 1, failed: [] });

    // Derselbe Inhalt hängt je Beleg weiterhin nur einmal
    const dateien = await sql`select role, sha256 from lexoffice_voucher_files where voucher_id = ${belegId}`;
    expect(dateien).toHaveLength(1);
    expect(dateien[0]!.sha256).toHaveLength(64);

    // Der Stand „nachgeladen“ entsteht trotzdem: der Beleg bleibt nicht als offen hängen
    const [stand] =
      await sql`select state, role, source_file_id from legacy_file_states where voucher_id = ${belegId} order by created_at desc, id desc limit 1`;
    expect(stand).toMatchObject({ state: "nachgeladen", role: "anhang", source_file_id: ANHANG_B });
    const detail = await lexoffice.legacyVoucherDetail(belegId);
    expect(detail!.fileState.status).toBe("vollstaendig");
  });
});

/** Steuert, ob der Abruf das XML der E-Rechnung herausgibt */
let xmlKlappt = false;

/** Nachgebaute Lexware-API: eine offene Rechnung, deren XML nicht kommt */
function fakeApiErechnung() {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    const accept = new Headers(init?.headers).get("accept") ?? "";
    if (new Headers(init?.headers).get("authorization") !== "Bearer schluessel-1234567890-abcdefghij") return json({ message: "Unauthorized" }, 401);
    if (path === "/profile") return json(fixture("profile.json"));
    if (path === "/posting-categories") return json([]);
    if (path === "/contacts") return json(page([]));
    if (path === "/voucherlist") {
      if (url.searchParams.get("archived") === "true") return json(page([]));
      return json(page([listItem(String(RECHNUNG.id), "invoice", "open", "RE1019")]));
    }
    if (path === `/invoices/${RECHNUNG.id}`) return json(RECHNUNG);
    if (path === `/invoices/${RECHNUNG.id}/file`) {
      if (accept.includes("xml")) {
        if (!xmlKlappt) return json({ message: "Datei nicht in der Sicherung" }, 500);
        return new Response(XML, { headers: { "content-type": "application/xml", "content-disposition": 'attachment; filename="RE1019.xml"' } });
      }
      return new Response(PDF, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="RE1019.pdf"' } });
    }
    if (path.startsWith("/payments/")) return json({ message: "not found" }, 404);
    return json({ message: `unbekannt ${path}` }, 404);
  }) as typeof fetch;
}

describe.skipIf(!testDatabaseUrl)("Lexoffice: fehlendes XML einer E-Rechnung (#1624)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  const actor = "test-user";
  let sql: postgres.Sql;
  let rechnungId = "";

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    const importPkg = await import("@haben/import");
    lexoffice.setLexofficeClientFactory(
      (o) => new importPkg.LexofficeClient({ ...o, fetch: fakeApiErechnung(), minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
    await lexoffice.saveApiKey(actor, "schluessel-1234567890-abcdefghij");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("vermerkt das fehlende XML als fehlenden Anhang und sperrt die Übernahme", async () => {
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    // Das fehlende XML ist kein fehlgeschlagener Beleg; das PDF kam
    expect(run!.progress).toMatchObject({ listed: 1, imported: 1, files: 1, failed: [] });

    const [rechnung] = await sql`select id from lexoffice_vouchers where number = 'RE1019'`;
    rechnungId = String(rechnung!.id);
    const [stand] = await sql`select state, role, source_file_id, message from legacy_file_states where voucher_id = ${rechnung!.id}`;
    // Wie bei sevDesk: fehlender Anhang, nicht „Abruf fehlgeschlagen“
    expect(stand).toMatchObject({ state: "anhang_fehlt", role: "xml", source_file_id: null });
    expect(String(stand!.message)).toContain("XML");

    const detail = await lexoffice.legacyVoucherDetail(rechnungId);
    expect(detail!.fileState.status).toBe("anhang_fehlt");

    // Die Rechnung lässt sich so nicht als offener Posten übernehmen, obwohl das PDF da ist
    const items = await legacy.openLegacyItems("2023-12-31");
    expect(items.map((i) => [i.number, i.blocker])).toEqual([["RE1019", expect.stringMatching(/XML der E-Rechnung fehlt/)]]);
  });

  it("holt das XML aus einem späteren Lauf nach und gibt den Posten frei", async () => {
    xmlKlappt = true;
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress).toMatchObject({ nachgeladen: 1, failed: [] });

    const dateien = await sql`select role, mime_type from lexoffice_voucher_files where voucher_id = ${rechnungId} order by role`;
    expect(dateien.map((d) => [d.role, d.mime_type])).toEqual([
      ["pdf", "application/pdf"],
      ["xml", "application/xml"],
    ]);
    const [stand] = await sql`select state, role from legacy_file_states where voucher_id = ${rechnungId} order by created_at desc, id desc limit 1`;
    expect(stand).toMatchObject({ state: "nachgeladen", role: "xml" });

    const detail = await lexoffice.legacyVoucherDetail(rechnungId);
    expect(detail!.fileState.status).toBe("vollstaendig");
    const items = await legacy.openLegacyItems("2023-12-31");
    expect(items.map((i) => [i.number, i.blocker])).toEqual([["RE1019", null]]);
  });
});
