import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * REST-Import von Bankumsätzen (#306, Schritt 4): POST /api/v1/bankimporte und GET /api/v1/bankquellen mit dem Recht
 * bank:importieren. Geliefert wird nur in freigegebene Quellen. Erfundene Daten.
 */

const lieferung = (key: string, amount = 4999) => ({
  contractVersion: 1,
  provider: "haben-ebay",
  externalAccountId: "verkaeufer-beispiel",
  idempotencyKey: key,
  fetchedAt: "2026-10-31T23:00:00+01:00",
  coverage: { from: "2026-10-01", to: "2026-10-31" },
  part: { fetchId: key, index: 0, last: true },
  movements: [
    {
      sourceEventId: "SALE-0001",
      component: "main",
      kind: "payment",
      bookingDate: "2026-10-03",
      amount,
      currency: "EUR",
      counterpartyName: "Erika Beispiel",
      purpose: "Bestellung 01-00000-00001",
      references: { orderId: "01-00000-00001" },
    },
    {
      sourceEventId: "SALE-0001",
      component: "fee",
      kind: "payment",
      bookingDate: "2026-10-03",
      amount: -1006,
      currency: "EUR",
      purpose: "Gebühren zu Bestellung 01-00000-00001",
      references: { orderId: "01-00000-00001" },
    },
  ],
});

describe.skipIf(!testDatabaseUrl)("REST-API /api/v1/bankimporte und /bankquellen (Postgres, #306)", () => {
  let api: typeof import("./index.ts");
  let mcp: typeof import("../mcp/index.ts");
  let schemas: typeof import("./bankimporte.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let konto: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into "user"(id,name,email,role) values (${actor}, 'Testinhaber', 'inhaber@example.de', 'inhaber')`;
    api = await import("./index.ts");
    mcp = await import("../mcp/index.ts");
    schemas = await import("./bankimporte.ts");
    [{ id: konto }] =
      (await sql`insert into bank_accounts (name, purpose, provider) values ('eBay', 'zahlungsdienstleister', 'ebay') returning id`) as unknown as [
        { id: string },
      ];
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  type Scope = import("../mcp/index.ts").TokenScope;
  async function token(scopes: Scope[]) {
    await mcp.setMcpEnabled(actor, true);
    return (await mcp.createMcpToken({ name: "eBay-Abgleich", days: 30, scopes }, new Date(), actor)).token;
  }

  async function call(tokenValue: string, method: string, path: string, body?: unknown) {
    const response = await api.handleApiRequest(
      new Request(`http://localhost:3000/api/v1${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), Authorization: `Bearer ${tokenValue}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await response.text();
    return {
      status: response.status,
      json: text ? (JSON.parse(text) as Record<string, unknown> & { error?: { code: string; message: string; issues?: unknown[] } }) : null,
    };
  }

  it("verlangt das Recht bank:importieren", async () => {
    const ohne = await token(["belege:anlegen"]);
    expect((await call(ohne, "POST", "/bankimporte", lieferung("l-0"))).status).toBe(403);
    expect((await call(ohne, "GET", "/bankquellen")).status).toBe(403);
  });

  it("liefert nur in eine freigegebene Quelle: vorher 404, danach 201 mit Umsätzen und Akteur im Änderungsprotokoll", async () => {
    const t = await token(["bank:importieren"]);
    const vorher = await call(t, "POST", "/bankimporte", lieferung("l-1"));
    expect(vorher.status).toBe(404);
    expect(vorher.json!.error!.message).toMatch(/nicht freigegeben/);

    const bank = await import("../bank/index.ts");
    await bank.addExternalSource(actor, { accountId: konto, provider: "haben-ebay", externalAccountId: "verkaeufer-beispiel", cutoverDate: "2026-10-01" });
    const angenommen = await call(t, "POST", "/bankimporte", lieferung("l-1"));
    expect(angenommen.status).toBe(201);
    expect(schemas.bankImportResultSchema.parse(angenommen.json)).toMatchObject({ replay: false, added: 2, checkpoint: "2026-10-31", complete: true });
    const umsaetze = await sql`select amount from bank_transactions where bank_account_id = ${konto} order by amount desc`;
    expect(umsaetze.map((u) => u.amount)).toEqual([4999, -1006]);
    const [eintrag] = await sql`select actor from audit_log where table_name = 'import_movements' order by seq desc limit 1`;
    expect(eintrag!.actor).toMatch(/^api:.+:eBay-Abgleich$/);

    const quellen = await call(t, "GET", "/bankquellen");
    expect(quellen.status).toBe(200);
    expect(schemas.bankSourceListSchema.parse(quellen.json).data).toMatchObject([
      { provider: "haben-ebay", externalAccountId: "verkaeufer-beispiel", accountKind: "psp", accountName: "eBay", checkpoint: "2026-10-31", openConflicts: 0 },
    ]);
  });

  it("gibt dieselbe Lieferung mit 200 zurück, ohne etwas anzulegen", async () => {
    const t = await token(["bank:importieren"]);
    const wieder = await call(t, "POST", "/bankimporte", lieferung("l-1"));
    expect(wieder.status).toBe(200);
    expect(wieder.json).toMatchObject({ replay: true, added: 0 });
  });

  it("meldet einen geänderten Betrag als 409 mit der betroffenen Bewegung, einen Vertragsverstoß als 422", async () => {
    const t = await token(["bank:importieren"]);
    const konflikt = await call(t, "POST", "/bankimporte", lieferung("l-2", 5099));
    expect(konflikt.status).toBe(409);
    expect(konflikt.json!.error).toMatchObject({ code: "conflict", issues: [{ path: "SALE-0001/main" }] });
    expect((await call(t, "GET", "/bankquellen")).json).toMatchObject({ data: [{ openConflicts: 1 }] });

    const kaputt = await call(t, "POST", "/bankimporte", { ...lieferung("l-3"), contractVersion: 2 });
    expect(kaputt.status).toBe(422);
    expect(kaputt.json!.error).toMatchObject({ code: "unprocessable", issues: [{ message: expect.stringMatching(/Vertragsversion 2/) }] });
  });
});
