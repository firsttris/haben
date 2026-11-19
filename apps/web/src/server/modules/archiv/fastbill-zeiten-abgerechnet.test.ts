import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// offene Zeiten aus FastBill, die in Haben schon auf einer Rechnung stehen. Alle Daten erfunden.
const API = "https://my.fastbill.com/api/1.0/api.php";
const KEY = "0123456789abcdef0123456789abcdef";
const zeit = (id: string, fields: Record<string, unknown> = {}) => ({
  TIME_ID: id,
  CUSTOMER_ID: "601",
  PROJECT_ID: "0",
  DATE: "2026-03-10 09:00:00",
  MINUTES: "90",
  BILLABLE_MINUTES: "90",
  COMMENT: "Konzept",
  ...fields,
});

describe.skipIf(!testDatabaseUrl)("Offene Zeiten aus FastBill, in Haben schon abgerechnet", () => {
  let sql: postgres.Sql;
  let zeiten: typeof import("./fastbill-zeiten.ts");
  let abrechnen: typeof import("../leistungen/abrechnen.ts");
  let times: unknown[];
  let kunde: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    zeiten = await import("./fastbill-zeiten.ts");
    abrechnen = await import("../leistungen/abrechnen.ts");
    const zugang = await import("./fastbill-zugang.ts");
    const importPkg = await import("@haben/import");
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== API) throw new Error(`unerwartet: ${String(input)}`);
      const body = JSON.parse(String(init?.body)) as { SERVICE: string; OFFSET: number };
      const page = (key: string, list: unknown[]) =>
        new Response(JSON.stringify({ RESPONSE: { [key]: body.OFFSET === 0 ? list : [] } }), { headers: { "content-type": "application/json" } });
      if (body.SERVICE === "customer.get") return page("CUSTOMERS", []);
      if (body.SERVICE === "project.get") return page("PROJECTS", []);
      if (body.SERVICE === "time.get") return page("TIMES", times);
      throw new Error(body.SERVICE);
    }) as typeof fetch;
    zugang.setFastbillClientFactory((o) => new importPkg.FastbillClient({ fetch: fetchFn, minIntervalMs: 0, maxRetries: 0, ...o }));
    await zugang.saveFastbillKey(actor, { email: "inhaber@example.de", apiKey: KEY, callsPerHour: 500 });
  }, 30_000);

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate service_entries, journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`select set_config('haben.actor', 'test', false)`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    [{ id: kunde }] = (await sql`insert into contacts (name, is_customer, fastbill_id, hourly_rate_cents, strasse, plz, ort, land)
      values ('Muster GmbH', true, '601', 9000, 'Hafenstraße 5', '20457', 'Hamburg', 'DE') returning id`) as unknown as [{ id: string }];
    times = [zeit("4001")];
    await zeiten.importFastbillTimes(actor);
    // In Haben abgerechnet; in FastBill bleibt die Zeit offen (keine INVOICE_ID), weil die Rechnung jetzt Haben schreibt
    await abrechnen.billServiceEntries(actor, { contactId: kunde, from: "2026-03-01", to: "2026-03-31" }, "2026-04-01");
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("zählt einen in Haben abgerechneten Eintrag in der Vorschau nicht als offen und übernehmbar", async () => {
    const plan = await zeiten.previewFastbillTimes();
    expect({ ready: plan.ready, customers: plan.customers }).toEqual({ ready: 0, customers: [] });
  });

  it("meldet einen in Haben abgerechneten Eintrag beim Übernehmen nicht als aktualisiert", async () => {
    times = [zeit("4001", { MINUTES: "120", BILLABLE_MINUTES: "120" })];
    const result = await zeiten.importFastbillTimes(actor);
    expect(await sql`select minutes from service_entries`).toEqual([{ minutes: 90 }]);
    expect(result).toMatchObject({ created: 0, updated: 0 });
  });
});
