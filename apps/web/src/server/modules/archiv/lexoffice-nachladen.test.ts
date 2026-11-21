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

/** Antwortet die Quelle ohne Fehler, dass es keine E-Rechnung gibt (406), statt mit einem Fehler (500)? */
let ohneErechnung = false;

/** Nachgebaute Lexware-API: eine offene Rechnung, deren XML es nicht gibt */
function fakeApiOhneErechnung() {
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
        if (ohneErechnung) return json({ message: "Für diesen Beleg gibt es keine E-Rechnung" }, 406);
        return json({ message: "Datei nicht in der Sicherung" }, 500);
      }
      return new Response(PDF, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="RE1019.pdf"' } });
    }
    if (path.startsWith("/payments/")) return json({ message: "not found" }, 404);
    return json({ message: `unbekannt ${path}` }, 404);
  }) as typeof fetch;
}

/*
 * Die zweite Form aus der Nachprüfung: Erst scheitert der XML-Abruf (500), dann antwortet die Quelle ohne Fehler „keine
 * E-Rechnung“ (406). Ohne den Stand `kein_anhang` bliebe die Rechnung für immer gesperrt, weil jeder weitere Lauf
 * dasselbe „kein XML“ hört und nie eine Datei ankommt.
 */
describe.skipIf(!testDatabaseUrl)("Lexoffice: keine E-Rechnung, kein offener Punkt (#1624)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  const actor = "test-user";
  let sql: postgres.Sql;
  let rechnungId = "";

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    const importPkg = await import("@haben/import");
    lexoffice.setLexofficeClientFactory(
      (o) => new importPkg.LexofficeClient({ ...o, fetch: fakeApiOhneErechnung(), minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
    await lexoffice.saveApiKey(actor, "schluessel-1234567890-abcdefghij");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("hält die Rechnung nach einem fehlgeschlagenen XML-Abruf offen", async () => {
    await lexoffice.startImport(actor, { wait: true });
    const [rechnung] = await sql`select id from lexoffice_vouchers where number = 'RE1019'`;
    rechnungId = String(rechnung!.id);
    const [stand] = await sql`select state, role from legacy_file_states where voucher_id = ${rechnung!.id}`;
    expect(stand).toMatchObject({ state: "anhang_fehlt", role: "xml" });
    const detail = await lexoffice.legacyVoucherDetail(rechnungId);
    expect(detail!.fileState.status).toBe("anhang_fehlt");
  });

  it("gibt die Rechnung frei, wenn die Quelle ohne Fehler kein XML nennt", async () => {
    ohneErechnung = true;
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    // Nichts kam an, also nichts nachgeladen; der Beleg ist trotzdem nicht mehr offen
    expect(run!.progress.failed).toEqual([]);
    expect(run!.progress.nachgeladen ?? 0).toBe(0);

    const [stand] = await sql`select state, role from legacy_file_states where voucher_id = ${rechnungId} order by created_at desc, id desc limit 1`;
    expect(stand).toMatchObject({ state: "kein_anhang", role: "xml" });

    // N1b: Belegstand und Stand der XML-Datei sagen dasselbe
    const detail = await lexoffice.legacyVoucherDetail(rechnungId);
    expect(detail!.fileState.status).toBe("vollstaendig");
    expect(detail!.fileState.status).not.toBe("anhang_fehlt");

    // Und ein dritter Lauf fragt nichts mehr an: der Stand ist zu
    await lexoffice.startImport(actor, { wait: true });
    const [danach] = await sql`select count(*)::int as n from legacy_file_states where voucher_id = ${rechnungId}`;
    expect(danach!.n).toBe(2);
  });
});

/** Der erste Lauf bringt keine der beiden Dateien; ab dem zweiten liegt das PDF in der Sicherung, ein XML nennt die Quelle nie */
let pdfKommt = false;
/** Zählt die Abrufe der Rechnungsdatei, damit „ein späterer Lauf fragt nichts mehr an“ belegt ist */
let dateiAbrufe = 0;
/** Antwortet die Quelle inzwischen ohne Fehler, dass es keine E-Rechnung gibt, statt mit einem Fehler? */
let xmlNenntKeins = false;

/** Nachgebaute Lexware-API: eine offene Rechnung ohne E-Rechnung, deren PDF erst im zweiten Lauf in der Sicherung liegt */
function fakeApiOhnePdf() {
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
      dateiAbrufe += 1;
      if (accept.includes("xml")) {
        // Erst ein Fehler, später die Auskunft „keine E-Rechnung“: ohne Fehler, also kein Grund für einen weiteren Versuch
        if (!xmlNenntKeins) return json({ message: "Datei nicht in der Sicherung" }, 500);
        return json({ message: "Für diesen Beleg gibt es keine E-Rechnung" }, 406);
      }
      if (!pdfKommt) return json({ message: "Datei nicht in der Sicherung" }, 500);
      return new Response(PDF, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="RE1019.pdf"' } });
    }
    if (path.startsWith("/payments/")) return json({ message: "not found" }, 404);
    return json({ message: `unbekannt ${path}` }, 404);
  }) as typeof fetch;
}

/*
 * Die zweite Form aus der Nachprüfung: Fehlen PDF und XML in einem Lauf, und bringt der nächste Lauf nur das PDF, muss der
 * Beleg `vollstaendig` werden. Ohne den Stand `kein_anhang` bliebe der Stand des XML auf `anhang_fehlt`: jeder weitere
 * Lauf fragte das XML erneut an, und ein einzelner späterer 500 sperrte die Rechnung wieder.
 */
describe.skipIf(!testDatabaseUrl)("Lexoffice: nur das PDF kommt nach, das XML nennt die Quelle nicht (#1624)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  const actor = "test-user";
  let sql: postgres.Sql;
  let rechnungId = "";

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    const importPkg = await import("@haben/import");
    lexoffice.setLexofficeClientFactory(
      (o) => new importPkg.LexofficeClient({ ...o, fetch: fakeApiOhnePdf(), minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
    await lexoffice.saveApiKey(actor, "schluessel-1234567890-abcdefghij");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("vermerkt PDF und XML als offen, wenn der erste Lauf keine der beiden Dateien bringt", async () => {
    pdfKommt = false;
    xmlNenntKeins = false;
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress).toMatchObject({ listed: 1, imported: 1, failed: [] });

    const [rechnung] = await sql`select id from lexoffice_vouchers where number = 'RE1019'`;
    rechnungId = String(rechnung!.id);
    const staende = await sql`select state, role from legacy_file_states where voucher_id = ${rechnung!.id} order by role`;
    expect(staende.map((s) => [s.role, s.state])).toEqual([
      ["pdf", "abruf_fehlgeschlagen"],
      ["xml", "anhang_fehlt"],
    ]);
    const detail = await lexoffice.legacyVoucherDetail(rechnungId);
    // Beide Stände sind offen; welcher als jüngster gilt, entscheidet bei gleichem Zeitstempel die id, deshalb nur „offen“
    expect(["anhang_fehlt", "abruf_fehlgeschlagen"]).toContain(detail!.fileState.status);
  });

  it("wird vollständig, wenn nur das PDF kommt und die Quelle kein XML nennt", async () => {
    pdfKommt = true;
    xmlNenntKeins = true;
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress).toMatchObject({ nachgeladen: 1, failed: [] });

    const [pdf] = await sql`select state from legacy_file_states where voucher_id = ${rechnungId} and role = 'pdf' order by created_at desc, id desc limit 1`;
    expect(pdf).toMatchObject({ state: "nachgeladen" });
    const [xml] = await sql`select state from legacy_file_states where voucher_id = ${rechnungId} and role = 'xml' order by created_at desc, id desc limit 1`;
    expect(xml).toMatchObject({ state: "kein_anhang" });
    const detail = await lexoffice.legacyVoucherDetail(rechnungId);
    expect(detail!.fileState.status).toBe("vollstaendig");

    // Und ein dritter Lauf fragt keine Datei dieses Belegs mehr an: der Stand ist zu
    const vorher = dateiAbrufe;
    await lexoffice.startImport(actor, { wait: true });
    expect(dateiAbrufe).toBe(vorher);
  });
});
