import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Vorlagen in der Form von recurring.get am echten Konto (Feldformen); Namen, Beträge und Bankdaten erfunden
const API = "https://my.fastbill.com/api/1.0/api.php";
const item = {
  ARTICLE_NUMBER: "W-1",
  DESCRIPTION: "Wartungspauschale",
  QUANTITY: 1,
  UNIT: "Monat",
  UNIT_PRICE: "120.00",
  VAT_PERCENT: "19.00",
  COMPLETE_NET: "120.00",
  COMPLETE_GROSS: "142.80",
  DISCOUNT_PERCENT: "",
  DISCOUNT_AMOUNT: "",
};
const base = {
  CUSTOMER_ID: "601",
  CURRENCY_CODE: "EUR",
  START_DATE: "2027-03-01",
  OCCURENCES: "0",
  IS_GROSS: "0",
  VAT_CASE: "0",
  PAYMENT_TYPE: "1",
  DISCOUNT_PERCENT: "",
  DISCOUNT_AMOUNT: "",
  BANK_IBAN: "DE02120300000000202051",
  BANK_ACCOUNT_OWNER: "Muster GmbH",
  ITEMS: [item],
};
const RECURRING = [
  { ...base, INVOICE_ID: "5001", INVOICE_TITLE: "Wartung Website", FREQUENCY: "monthly" },
  { ...base, INVOICE_ID: "5002", INVOICE_TITLE: "Wochenpflege", FREQUENCY: "weekly" },
  { ...base, INVOICE_ID: "5003", INVOICE_TITLE: "Unbekannter Kunde", FREQUENCY: "yearly", CUSTOMER_ID: "999" },
];

describe.skipIf(!testDatabaseUrl)("Wiederkehrende Rechnungen aus FastBill (Postgres)", () => {
  let sql: postgres.Sql;
  let vorlagen: typeof import("./fastbill-vorlagen.ts");
  let importPkg: typeof import("@haben/import");
  let importId: string;
  const actor = "test-user";

  const client = () =>
    new importPkg.FastbillClient({
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

  const run = async () => {
    const progress = { failed: [] } as unknown as LexofficeImportProgress;
    await vorlagen.importFastbillRecurring(actor, importId, client(), progress, new AbortController().signal);
    return progress;
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    vorlagen = await import("./fastbill-vorlagen.ts");
    importPkg = await import("@haben/import");
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
      'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 21)`;
    await sql`select set_config('haben.actor', 'test', false)`;
    await sql`insert into contacts (name, is_customer, fastbill_id) values ('Muster GmbH', true, '601')`;
    const [row] = await sql`insert into lexoffice_imports (source, status, progress) values ('fastbill', 'fertig', '{}') returning id`;
    importId = row!.id as string;
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("legt eine monatliche Vorlage pausiert als Entwurf ohne E-Mail an und nennt, was nicht geht", async () => {
    const progress = await run();
    expect(progress.fastbillRecurring).toEqual({ imported: 1, known: 0 });
    expect(progress.failed.map((f) => [f.number, f.message])).toEqual([
      ["Wochenpflege", expect.stringContaining("Turnus „weekly“")],
      ["Unbekannter Kunde", expect.stringContaining("Kunde der Vorlage ist nicht übernommen")],
    ]);
    const [recurring] = await sql`select r.name, r.active, r.mode, r.send_by_mail, r.interval_months, r.next_date::text as next_date,
      r.payment_term_days, r.lines, c.name as kunde from recurring_invoices r join contacts c on c.id = r.contact_id`;
    expect(recurring).toMatchObject({
      name: "Wartung Website",
      active: false,
      mode: "entwurf",
      send_by_mail: false,
      interval_months: 1,
      next_date: "2027-03-01",
      payment_term_days: 21,
      kunde: "Muster GmbH",
    });
    expect(recurring!.lines[0]).toMatchObject({ description: "Wartungspauschale", itemNumber: "W-1", unit: "Monat", unitPrice: 12_000, taxRate: 1900 });
  });

  it("legt beim zweiten Lauf nichts doppelt an, auch nicht nach dem Löschen in Haben", async () => {
    await sql`delete from recurring_invoices`;
    const progress = await run();
    expect(progress.fastbillRecurring).toEqual({ imported: 0, known: 1 });
    expect(await sql`select count(*)::int as n from recurring_invoices`).toEqual([{ n: 0 }]);
  });

  it("speichert die Antwort ohne Bankdaten und mit den Hinweisen zum Prüfen", async () => {
    const [row] = await sql`select raw, hints from fastbill_recurring_templates where fastbill_id = '5001'`;
    expect(row!.raw).not.toHaveProperty("BANK_IBAN");
    expect(row!.raw).not.toHaveProperty("BANK_ACCOUNT_OWNER");
    expect(row!.raw).toMatchObject({ INVOICE_TITLE: "Wartung Website", FREQUENCY: "monthly" });
    expect(row!.hints).toEqual(expect.arrayContaining([expect.stringContaining("Startdatum aus FastBill")]));
  });
});
