import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// TDD-Nachholen des PDFs eines archivierten FastBill-Angebots; Daten erfunden
const API = "https://my.fastbill.com/api/1.0/api.php";
const PDF = new TextEncoder().encode("%PDF-1.4\n% Angebot\n%%EOF\n");
const angebot = (id: string, total = { SUB_TOTAL: "100.00", VAT_TOTAL: "19.00", TOTAL: "119.00" }) => ({
  ESTIMATE_ID: id,
  ESTIMATE_NUMBER: `AN-2026-${id}`,
  ESTIMATE_DATE: "2026-09-01",
  STATE: "sent",
  CUSTOMER_ID: "601",
  ORGANIZATION: "Muster GmbH",
  CURRENCY_CODE: "EUR",
  ...total,
  DOCUMENT_URL: `https://my.fastbill.com/download/angebot-${id}`,
});

describe.skipIf(!testDatabaseUrl)("TDD-PDF eines FastBill-Angebots nachholen (Postgres)", () => {
  let sql: postgres.Sql;
  let angebote: typeof import("./fastbill-angebote.ts");
  let importPkg: typeof import("@haben/import");
  let importId: string;

  const run = async (list: Record<string, unknown>[], download: () => Response) => {
    const client = new importPkg.FastbillClient({
      email: "inhaber@example.de",
      apiKey: "0123456789abcdef0123456789abcdef",
      minIntervalMs: 0,
      maxRetries: 0,
      sleep: async () => {},
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== API) return download();
        const body = JSON.parse(String(init?.body)) as { SERVICE: string; OFFSET: number };
        const estimates = body.SERVICE === "estimate.get" && body.OFFSET === 0 ? list : [];
        return new Response(JSON.stringify({ RESPONSE: { ESTIMATES: estimates } }), { headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
    const progress = { failed: [] } as unknown as LexofficeImportProgress;
    await angebote.importFastbillEstimates("test-user", importId, client, progress, new AbortController().signal);
    return progress;
  };
  const html = () => new Response("", { headers: { "content-type": "text/html" } });
  const pdf = () => new Response(PDF, { headers: { "content-type": "application/pdf" } });
  const files = (id: string) =>
    sql`select f.filename, f.origin from legacy_order_files f join legacy_order_documents d on d.id = f.order_id where d.external_id = ${`fastbill/estimate/${id}`}`;

  beforeAll(async () => {
    sql = await setupTestDb();
    angebote = await import("./fastbill-angebote.ts");
    importPkg = await import("@haben/import");
    await sql`select set_config('haben.actor', 'test', false)`;
    const [row] = await sql`insert into lexoffice_imports (source, status, progress) values ('fastbill', 'fertig', '{}') returning id`;
    importId = row!.id as string;
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("hängt kein PDF an, wenn das Angebot in FastBill seit der Archivierung geändert wurde", async () => {
    await run([angebot("31")], html);
    // In FastBill überarbeitet: das PDF hinter dem Link zeigt jetzt 238,00 €, das Archiv 119,00 €
    const progress = await run([angebot("31", { SUB_TOTAL: "200.00", VAT_TOTAL: "38.00", TOTAL: "238.00" })], pdf);
    const [archiv] = await sql`select gross from legacy_order_documents where external_id = 'fastbill/estimate/31'`;
    expect(archiv!.gross).toBe(11900);
    expect(await files("31")).toEqual([]);
    expect(progress.fastbillEstimates).toMatchObject({ pdfNachgeholt: 0 });
  });

  it("benennt ein nachgeholtes PDF ohne Dateinamen wie beim ersten Abruf nach der Angebotsnummer", async () => {
    await run([angebot("32")], html);
    await run([angebot("32")], pdf);
    expect(await files("32")).toEqual([{ filename: "AN-2026-32.pdf", origin: "fastbill" }]);
  });

  it("meldet eine abgelehnte Anmeldung am Download-Link nur beim Angebot und läuft weiter", async () => {
    await run([angebot("33")], html);
    const progress = await run([angebot("33"), angebot("34")], () => new Response("nein", { status: 401 }));
    expect(progress.failed).toMatchObject([
      { lexofficeId: "fastbill/estimate/33", message: expect.stringContaining("PDF nicht nachgeholt") },
      { lexofficeId: "fastbill/estimate/34" },
    ]);
    expect(await files("33")).toEqual([]);
  });

  it("holt das PDF auch nach, wenn nur der Status in FastBill weiter ist", async () => {
    await run([angebot("35")], html);
    const progress = await run([{ ...angebot("35"), STATE: "accepted" }], pdf);
    expect(progress.fastbillEstimates).toMatchObject({ pdfNachgeholt: 1 });
  });
});
