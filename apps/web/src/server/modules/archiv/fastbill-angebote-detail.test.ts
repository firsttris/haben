import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Detail und Abbruch #1524: Angebote aus FastBill, Feldformen wie fastbill-angebote.test.ts; Namen und Beträge erfunden
const API = "https://my.fastbill.com/api/1.0/api.php";
const PDF = new TextEncoder().encode("%PDF-1.4\n% Angebot\n%%EOF\n");
const base = {
  CUSTOMER_ID: "601",
  ORGANIZATION: "Muster GmbH",
  CURRENCY_CODE: "EUR",
  SUB_TOTAL: "1000.00",
  VAT_TOTAL: "190.00",
  TOTAL: "1190.00",
  STATE: "sent",
};
const angebot = (id: string, number: string, date: string) => ({
  ...base,
  ESTIMATE_ID: id,
  ESTIMATE_NUMBER: number,
  ESTIMATE_DATE: date,
  DOCUMENT_URL: `https://my.fastbill.com/download/angebot-${id}`,
});
const pdf = () => new Response(PDF, { headers: { "content-type": "application/pdf" } });

describe.skipIf(!testDatabaseUrl)("Detail und Abbruch #1524: Angebote aus FastBill (Postgres)", () => {
  let sql: postgres.Sql;
  let angebote: typeof import("./fastbill-angebote.ts");
  let importPkg: typeof import("@haben/import");
  let importId: string;
  const actor = "test-user";

  const run = async (estimates: unknown[], download: (url: string) => Response) => {
    const client = new importPkg.FastbillClient({
      email: "inhaber@example.de",
      apiKey: "0123456789abcdef0123456789abcdef",
      minIntervalMs: 0,
      maxRetries: 0,
      sleep: async () => {},
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url !== API) return download(url);
        const body = JSON.parse(String(init?.body)) as { SERVICE: string; OFFSET: number };
        const list = body.SERVICE === "estimate.get" && body.OFFSET === 0 ? estimates : [];
        return new Response(JSON.stringify({ RESPONSE: { ESTIMATES: list } }), { headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
    const progress = { failed: [] } as unknown as LexofficeImportProgress;
    await angebote.importFastbillEstimates(actor, importId, client, progress, new AbortController().signal);
    return progress;
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    angebote = await import("./fastbill-angebote.ts");
    importPkg = await import("@haben/import");
    await sql`select set_config('haben.actor', 'test', false)`;
    await sql`insert into contacts (name, is_customer, fastbill_id) values ('Muster GmbH', true, '601')`;
    const [row] = await sql`insert into lexoffice_imports (source, status, progress) values ('fastbill', 'fertig', '{}') returning id`;
    importId = row!.id as string;
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("nennt in der Detailansicht FastBill als Quelle, nicht sevDesk", async () => {
    await run([angebot("8800", "AN-2026-7", "2026-04-01")], pdf);
    const [row] = await sql`select id from legacy_order_documents where external_id = 'fastbill/estimate/8800'`;
    const { orderDocumentDetail } = await import("./orders.ts");
    const detail = await orderDocumentDetail(row!.id as string);
    expect(detail!.document.sourceName).toBe("FastBill");
  });

  it("zeigt die Positionen aus ITEMS und den Status lesbar", async () => {
    const items = [{ ESTIMATE_ITEM_ID: "1", DESCRIPTION: "Konzept", QUANTITY: "2.0000", UNIT_PRICE: "450.00", VAT_PERCENT: "19.00" }];
    await run([{ ...angebot("8803", "AN-2026-10", "2026-07-01"), ITEMS: items }], pdf);
    const [row] = await sql`select id from legacy_order_documents where external_id = 'fastbill/estimate/8803'`;
    const { orderDocumentDetail } = await import("./orders.ts");
    const { ORDER_STATUSES } = await import("../../../lib/auftraege.ts");
    const detail = await orderDocumentDetail(row!.id as string);
    expect(detail!.document.positions).toEqual([{ id: "1", name: "Konzept", quantity: "2.0000", price: "450.00", taxRate: "19.00", text: "" }]);
    expect(ORDER_STATUSES[detail!.document.status]).toBeDefined();
  });

  it("legt eine Antwort, die kein PDF ist, nicht als PDF ab", async () => {
    await run([angebot("8804", "AN-2026-11", "2026-08-01")], () => new Response("<html></html> kein PDF", { headers: { "content-type": "application/pdf" } }));
    const [row] = await sql`select count(f.id)::int as dateien from legacy_order_documents d left join legacy_order_files f on f.order_id = d.id
      where d.external_id = 'fastbill/estimate/8804' group by d.id`;
    expect(row).toEqual({ dateien: 0 });
  });

  it("bricht den ganzen Abruf nicht ab, wenn der Download-Link eines Angebots 401 liefert (wie bei Belegen, stopsRun)", async () => {
    const estimates = [angebot("8801", "AN-2026-8", "2026-05-04"), angebot("8802", "AN-2026-9", "2026-06-01")];
    const download = (url: string) => (url.endsWith("angebot-8801") ? new Response("", { status: 401 }) : pdf());
    await expect(run(estimates, download)).resolves.toBeDefined();
    // Das zweite Angebot kommt trotzdem ins Archiv
    const rows = await sql`select number from legacy_order_documents where source = 'fastbill' order by number`;
    expect(rows.map((r) => r.number)).toContain("AN-2026-9");
  });
});
