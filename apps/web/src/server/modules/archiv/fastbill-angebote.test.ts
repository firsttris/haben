import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Angebote in der Form von estimate.get am echten Konto (Feldformen); Namen, Beträge und Adressen erfunden
const API = "https://my.fastbill.com/api/1.0/api.php";
const PDF = new TextEncoder().encode("%PDF-1.4\n% Angebot AN-2026-4\n%%EOF\n");
const base = { CUSTOMER_ID: "601", ORGANIZATION: "Muster GmbH", CURRENCY_CODE: "EUR", SUB_TOTAL: "1000.00", VAT_TOTAL: "190.00", TOTAL: "1190.00" };
const ESTIMATES = [
  {
    ...base,
    ESTIMATE_ID: "7701",
    ESTIMATE_NUMBER: "AN-2026-4",
    ESTIMATE_DATE: "2026-05-04",
    STATE: "sent",
    DOCUMENT_URL: "https://my.fastbill.com/download/angebot-7701",
  },
  {
    ...base,
    ESTIMATE_ID: "7702",
    ESTIMATE_NUMBER: "AN-2026-5",
    ESTIMATE_DATE: "2026-06-01",
    STATE: "created",
    DOCUMENT_URL: "https://my.fastbill.com/download/angebot-7702",
  },
];

describe.skipIf(!testDatabaseUrl)("Angebote aus FastBill ins Archiv (Postgres)", () => {
  let sql: postgres.Sql;
  let angebote: typeof import("./fastbill-angebote.ts");
  let importPkg: typeof import("@haben/import");
  let importId: string;
  let documents: string[];
  const actor = "test-user";

  const client = () =>
    new importPkg.FastbillClient({
      email: "inhaber@example.de",
      apiKey: "0123456789abcdef0123456789abcdef",
      minIntervalMs: 0,
      maxRetries: 0,
      sleep: async () => {},
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url !== API) {
          documents.push(url);
          // 7701 liefert ein PDF, 7702 nur eine leere Seite
          if (url.endsWith("angebot-7701")) return new Response(PDF, { headers: { "content-type": "application/pdf" } });
          return new Response("", { headers: { "content-type": "text/html" } });
        }
        const body = JSON.parse(String(init?.body)) as { SERVICE: string; OFFSET: number };
        const list = body.SERVICE === "estimate.get" && body.OFFSET === 0 ? ESTIMATES : [];
        return new Response(JSON.stringify({ RESPONSE: { ESTIMATES: list } }), { headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });

  const run = async () => {
    documents = [];
    const progress = { failed: [] } as unknown as LexofficeImportProgress;
    await angebote.importFastbillEstimates(actor, importId, client(), progress, new AbortController().signal);
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

  it("legt Angebote als Auftragsdokumente mit Kontakt und PDF ab, ohne PDF zum Nachreichen", async () => {
    const progress = await run();
    expect(progress.fastbillEstimates).toEqual({ imported: 2, known: 0, withoutPdf: 1, pdfNachgeholt: 0 });
    expect(progress.failed).toEqual([]);
    const rows = await sql`select d.external_id, d.source, d.kind, d.number, d.date::text as date, d.status, d.gross, c.name as kontakt,
      (select count(*)::int from legacy_order_files f where f.order_id = d.id) as dateien,
      (select string_agg(f.origin, ',') from legacy_order_files f where f.order_id = d.id) as herkunft
      from legacy_order_documents d left join contacts c on c.id = d.contact_id order by d.number`;
    expect(rows.map((r) => ({ ...r }))).toEqual([
      {
        external_id: "fastbill/estimate/7701",
        source: "fastbill",
        kind: "AN",
        number: "AN-2026-4",
        date: "2026-05-04",
        status: "sent",
        gross: 119_000,
        kontakt: "Muster GmbH",
        dateien: 1,
        herkunft: "fastbill",
      },
      {
        external_id: "fastbill/estimate/7702",
        source: "fastbill",
        kind: "AN",
        number: "AN-2026-5",
        date: "2026-06-01",
        status: "created",
        gross: 119_000,
        kontakt: "Muster GmbH",
        dateien: 0,
        herkunft: null,
      },
    ]);
  });

  it("speichert die Antwort ohne Download-Adresse", async () => {
    const [row] = await sql`select raw from legacy_order_documents where external_id = 'fastbill/estimate/7701'`;
    expect(row!.raw).not.toHaveProperty("DOCUMENT_URL");
    expect(row!.raw).toMatchObject({ ESTIMATE_NUMBER: "AN-2026-4", STATE: "sent" });
  });

  it("legt sie im Jahresexport unter fastbill/auftraege ab und meldet das fehlende PDF als FastBill-Angebot", async () => {
    const { orderFiles } = await import("./export-legacy.ts");
    const problems: string[] = [];
    const paths: string[] = [];
    for await (const file of orderFiles(2026, problems)) paths.push(file.path);
    expect(paths.every((p) => p.startsWith("fastbill/"))).toBe(true);
    expect(paths).toContain("fastbill/auftraege.csv");
    expect(paths.some((p) => /^fastbill\/auftraege\/2026-05-04_AN-2026-4_[0-9a-f]{8}\/[0-9a-f]{8}_.+\.pdf$/.test(p))).toBe(true);
    expect(problems).toEqual(["FastBill-Angebot AN-2026-5: PDF fehlt."]);
  });

  it("überspringt beim zweiten Lauf, was schon im Archiv liegt, und lädt nur das fehlende PDF noch einmal (#1541)", async () => {
    const progress = await run();
    expect(progress.fastbillEstimates).toEqual({ imported: 0, known: 2, withoutPdf: 0, pdfNachgeholt: 0 });
    // 7701 hat sein PDF, 7702 liefert weiter keins
    expect(documents).toEqual(["https://my.fastbill.com/download/angebot-7702"]);
    expect(await sql`select count(*)::int as n from legacy_order_documents`).toEqual([{ n: 2 }]);
  });
});
