import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Fehlendes PDF eines Angebots beim nächsten Abruf nachholen (#1541); Daten erfunden
const API = "https://my.fastbill.com/api/1.0/api.php";
const PDF = new TextEncoder().encode("%PDF-1.4\n% Angebot AN-2026-20\n%%EOF\n");
const ANGEBOT = {
  ESTIMATE_ID: "8900",
  ESTIMATE_NUMBER: "AN-2026-20",
  ESTIMATE_DATE: "2026-09-01",
  STATE: "sent",
  CUSTOMER_ID: "601",
  ORGANIZATION: "Muster GmbH",
  CURRENCY_CODE: "EUR",
  SUB_TOTAL: "100.00",
  VAT_TOTAL: "19.00",
  TOTAL: "119.00",
  DOCUMENT_URL: "https://my.fastbill.com/download/angebot-8900",
};

describe.skipIf(!testDatabaseUrl)("Fehlendes PDF eines FastBill-Angebots nachholen (Postgres)", () => {
  let sql: postgres.Sql;
  let angebote: typeof import("./fastbill-angebote.ts");
  let importPkg: typeof import("@haben/import");
  let importId: string;
  let downloads: string[];

  const run = async (download: () => Response) => {
    downloads = [];
    const client = new importPkg.FastbillClient({
      email: "inhaber@example.de",
      apiKey: "0123456789abcdef0123456789abcdef",
      minIntervalMs: 0,
      maxRetries: 0,
      sleep: async () => {},
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url !== API) {
          downloads.push(url);
          return download();
        }
        const body = JSON.parse(String(init?.body)) as { SERVICE: string; OFFSET: number };
        const list = body.SERVICE === "estimate.get" && body.OFFSET === 0 ? [ANGEBOT] : [];
        return new Response(JSON.stringify({ RESPONSE: { ESTIMATES: list } }), { headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
    const progress = { failed: [] } as unknown as LexofficeImportProgress;
    await angebote.importFastbillEstimates("test-user", importId, client, progress, new AbortController().signal);
    return progress;
  };
  const files = async () =>
    sql`select f.origin from legacy_order_files f join legacy_order_documents d on d.id = f.order_id where d.external_id = 'fastbill/estimate/8900'`;

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

  it("legt das Angebot ohne PDF an, wenn der Link keins liefert", async () => {
    const progress = await run(() => new Response("", { headers: { "content-type": "text/html" } }));
    expect(progress.fastbillEstimates).toMatchObject({ imported: 1, withoutPdf: 1 });
    expect(await files()).toEqual([]);
  });

  it("holt das PDF beim nächsten Abruf nach, wenn der Link jetzt eins liefert", async () => {
    const progress = await run(() => new Response(PDF, { headers: { "content-type": "application/pdf" } }));
    expect(progress.fastbillEstimates).toMatchObject({ imported: 0, known: 1, pdfNachgeholt: 1 });
    expect((await files()).map((f) => f.origin)).toEqual(["fastbill"]);
  });

  it("lädt ein Angebot mit PDF nicht noch einmal", async () => {
    const progress = await run(() => new Response(PDF, { headers: { "content-type": "application/pdf" } }));
    expect(progress.fastbillEstimates).toMatchObject({ known: 1, pdfNachgeholt: 0 });
    expect(downloads).toEqual([]);
    expect(await files()).toHaveLength(1);
  });
});
