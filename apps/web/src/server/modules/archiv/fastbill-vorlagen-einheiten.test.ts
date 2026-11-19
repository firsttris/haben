import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// eine Vorlage mit einer eigenen Einheit aus Einstellungen › Rechnungen › Einheiten (#748)
const API = "https://my.fastbill.com/api/1.0/api.php";
const RECURRING = [
  {
    INVOICE_ID: "5101",
    CUSTOMER_ID: "601",
    INVOICE_TITLE: "Lizenzen",
    CURRENCY_CODE: "EUR",
    FREQUENCY: "monthly",
    START_DATE: "2027-03-01",
    OCCURENCES: "0",
    IS_GROSS: "0",
    VAT_CASE: "0",
    PAYMENT_TYPE: "1",
    DISCOUNT_PERCENT: "",
    DISCOUNT_AMOUNT: "",
    ITEMS: [{ DESCRIPTION: "Software", QUANTITY: 5, UNIT: "Lizenz", UNIT_PRICE: "10.00", VAT_PERCENT: "19.00", DISCOUNT_PERCENT: "", DISCOUNT_AMOUNT: "" }],
  },
];

describe.skipIf(!testDatabaseUrl)("FastBill-Vorlagen mit eigener Einheit (Postgres)", () => {
  let sql: postgres.Sql;
  let vorlagen: typeof import("./fastbill-vorlagen.ts");
  let importPkg: typeof import("@haben/import");
  let importId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    vorlagen = await import("./fastbill-vorlagen.ts");
    importPkg = await import("@haben/import");
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
      'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 21)`;
    await sql`select set_config('haben.actor', 'test', false)`;
    await sql`insert into contacts (name, is_customer, fastbill_id) values ('Muster GmbH', true, '601')`;
    await sql`insert into units (label, code) values ('Lizenz', 'C62')`;
    const [row] = await sql`insert into lexoffice_imports (source, status, progress) values ('fastbill', 'fertig', '{}') returning id`;
    importId = row!.id as string;
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("behält eine Einheit, die in Haben als eigene Einheit angelegt ist", async () => {
    const client = new importPkg.FastbillClient({
      email: "inhaber@example.de",
      apiKey: "0123456789abcdef0123456789abcdef",
      minIntervalMs: 0,
      maxRetries: 0,
      sleep: async () => {},
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== API) throw new Error(`unerwartet: ${String(input)}`);
        const body = JSON.parse(String(init?.body)) as { SERVICE: string; OFFSET: number };
        const list = body.SERVICE === "recurring.get" && body.OFFSET === 0 ? RECURRING : [];
        return new Response(JSON.stringify({ RESPONSE: { INVOICES: list } }), { headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
    const progress = { failed: [] } as unknown as LexofficeImportProgress;
    await vorlagen.importFastbillRecurring("test-user", importId, client, progress, new AbortController().signal);
    expect(progress.fastbillRecurring).toEqual({ imported: 1, known: 0 });
    const [recurring] = await sql`select lines from recurring_invoices`;
    expect(recurring!.lines[0]).toMatchObject({ description: "Software", unit: "Lizenz" });
  });
});
