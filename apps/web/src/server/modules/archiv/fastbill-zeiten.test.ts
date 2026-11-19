import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Zeiten und Projekte in der Form von time.get/project.get am echten Konto (Feldformen); Namen und Sätze erfunden
const API = "https://my.fastbill.com/api/1.0/api.php";
const KEY = "0123456789abcdef0123456789abcdef";
const PROJECTS = [{ PROJECT_ID: "301", PROJECT_NAME: "Relaunch Website", CUSTOMER_ID: "601", HOUR_PRICE: "85.00", CURRENCY_CODE: "EUR" }];
const zeit = (id: string, fields: Record<string, unknown> = {}) => ({
  TIME_ID: id,
  CUSTOMER_ID: "601",
  PROJECT_ID: "301",
  DATE: "2026-10-14 09:00:00",
  MINUTES: "90",
  BILLABLE_MINUTES: "90",
  COMMENT: "Konzept",
  ...fields,
});

describe.skipIf(!testDatabaseUrl)("Offene Zeiten aus FastBill (Postgres)", () => {
  let sql: postgres.Sql;
  let zeiten: typeof import("./fastbill-zeiten.ts");
  let zugang: typeof import("./fastbill-zugang.ts");
  let importPkg: typeof import("@haben/import");
  let times: unknown[];
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    zeiten = await import("./fastbill-zeiten.ts");
    zugang = await import("./fastbill-zugang.ts");
    importPkg = await import("@haben/import");
    await sql`select set_config('haben.actor', 'test', false)`;
    await sql`insert into contacts (name, is_customer, fastbill_id, hourly_rate_cents) values ('Muster GmbH', true, '601', 9000)`;
    await sql`insert into contacts (name, is_customer, fastbill_id, archived_at) values ('Alt GmbH', true, '602', now())`;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== API) throw new Error(`unerwartet: ${String(input)}`);
      const body = JSON.parse(String(init?.body)) as { SERVICE: string; OFFSET: number };
      const page = (key: string, list: unknown[]) =>
        new Response(JSON.stringify({ RESPONSE: { [key]: body.OFFSET === 0 ? list : [] } }), { headers: { "content-type": "application/json" } });
      if (body.SERVICE === "customer.get") return page("CUSTOMERS", []);
      if (body.SERVICE === "project.get") return page("PROJECTS", PROJECTS);
      if (body.SERVICE === "time.get") return page("TIMES", times);
      throw new Error(body.SERVICE);
    }) as typeof fetch;
    zugang.setFastbillClientFactory((o) => new importPkg.FastbillClient({ fetch: fetchFn, minIntervalMs: 0, maxRetries: 0, ...o }));
    await zugang.saveFastbillKey(actor, { email: "inhaber@example.de", apiKey: KEY, callsPerHour: 500 });
  }, 30_000);

  beforeEach(() => {
    times = [
      zeit("4001"),
      zeit("4002", { MINUTES: "30", BILLABLE_MINUTES: "30", PROJECT_ID: "0" }),
      zeit("4003", { INVOICE_ID: "7001" }),
      zeit("4004", { CUSTOMER_ID: "602", PROJECT_ID: "0" }),
      zeit("4005", { CUSTOMER_ID: "699", PROJECT_ID: "0" }),
      zeit("4006", { MINUTES: "1500", BILLABLE_MINUTES: "1500" }),
    ];
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("zeigt je Kunde Anzahl, Dauer und Summe, abgerechnete Zeiten nur gezählt, und was nicht geht", async () => {
    const plan = await zeiten.previewFastbillTimes();
    expect(plan.billed).toBe(1);
    expect(plan.ready).toBe(2);
    // 90 Minuten zu 85,00 € aus dem Projekt, 30 Minuten zum Satz des Kunden 90,00 €
    expect(plan.customers).toEqual([{ name: "Muster GmbH", entries: 2, minutes: 120, amountCents: 12_750 + 4500 }]);
    expect(plan.problems.map((p) => [p.timeId, p.reason])).toEqual([
      ["4004", "Der Kunde ist archiviert."],
      ["4005", expect.stringContaining("nicht da")],
      ["4006", expect.stringContaining("24 Stunden")],
    ]);
    expect(await sql`select count(*)::int as n from service_entries`).toEqual([{ n: 0 }]);
  });

  it("legt die offenen Zeiten als Zeiteinträge mit Quelle fastbill an", async () => {
    const result = await zeiten.importFastbillTimes(actor);
    expect(result).toMatchObject({ created: 2, updated: 0 });
    expect(result.failed).toHaveLength(3);
    const rows = await sql`select external_source, external_id, worked_on::text as worked_on, minutes, hourly_rate_cents, project, description
      from service_entries order by external_id`;
    expect(rows.map((r) => ({ ...r }))).toEqual([
      {
        external_source: "fastbill",
        external_id: "4001",
        worked_on: "2026-10-14",
        minutes: 90,
        hourly_rate_cents: 8500,
        project: "Relaunch Website",
        description: "Konzept",
      },
      { external_source: "fastbill", external_id: "4002", worked_on: "2026-10-14", minutes: 30, hourly_rate_cents: 9000, project: "", description: "Konzept" },
    ]);
  });

  it("aktualisiert beim zweiten Lauf, statt zu verdoppeln", async () => {
    times = [zeit("4001", { MINUTES: "120", BILLABLE_MINUTES: "120" }), zeit("4002", { MINUTES: "30", BILLABLE_MINUTES: "30", PROJECT_ID: "0" })];
    const result = await zeiten.importFastbillTimes(actor);
    expect(result).toMatchObject({ created: 0, updated: 2, failed: [] });
    expect(await sql`select external_id, minutes from service_entries order by external_id`).toEqual([
      { external_id: "4001", minutes: 120 },
      { external_id: "4002", minutes: 30 },
    ]);
  });

  it("holt keine Zeiten, solange ein Abruf aus FastBill läuft, und zählt auf die Stundengrenze (#1522)", async () => {
    await sql`insert into lexoffice_imports (source, status, progress) values ('fastbill', 'laeuft', '{}')`;
    try {
      await expect(zeiten.previewFastbillTimes()).rejects.toThrow(/Abruf aus FastBill.*Zeiten/);
    } finally {
      await sql`delete from lexoffice_imports where status = 'laeuft'`;
    }
    const anfragen = await import("./fastbill-anfragen.ts");
    const vorher = (await anfragen.fastbillUsage()).used;
    await zeiten.previewFastbillTimes();
    // project.get und time.get, je eine Seite
    expect((await anfragen.fastbillUsage()).used).toBe(vorher + 2);
  });
});
