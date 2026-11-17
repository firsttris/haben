import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * REST-API für Angebote (#297): nur lesen, mit eigenem Recht angebote:lesen. Festgeschrieben, versendet und abgerechnet
 * wird in Haben; die API zeigt den Stand.
 */

describe.skipIf(!testDatabaseUrl)("REST-API /api/v1/angebote (Postgres, #297)", () => {
  let api: typeof import("./index.ts");
  let mcp: typeof import("../mcp/index.ts");
  let mcpServer: typeof import("../mcp/server.ts");
  let rechnungen: typeof import("../rechnungen/index.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let schemas: typeof import("./quotes-schemas.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  /** 8 Std. zu 95 € = 760 € netto */
  const line = (extra = {}) => ({
    description: "Workshop Architektur",
    quantity: 8000,
    unit: "Std." as const,
    unitPrice: 9500,
    taxRate: 1900 as const,
    ...extra,
  });
  const optional = line({ description: "Dokumentation", quantity: 1000, unit: "Psch." as const, unitPrice: 50_000, kind: "optional" as const });

  /** Gültig bis 2099: der Stand hängt am heutigen Tag, den der Router selbst nimmt */
  const draft = (overrides = {}) => ({
    contactId,
    issueDate: "2026-10-01",
    validUntil: "2099-12-31",
    serviceFrom: null,
    serviceTo: null,
    note: "",
    lines: [line()],
    ...overrides,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into "user"(id,name,email,role) values (${actor}, 'Testinhaber', 'inhaber@example.de', 'inhaber')`;
    api = await import("./index.ts");
    mcp = await import("../mcp/index.ts");
    mcpServer = await import("../mcp/server.ts");
    rechnungen = await import("../rechnungen/index.ts");
    stammdaten = await import("../stammdaten/index.ts");
    schemas = await import("./quotes-schemas.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    mcpServer.resetRateLimitForTests();
    await leeren(sql)`truncate mcp_calls, mcp_tokens, mail_log, quote_lines, quotes, quote_number_counters, journal_lines, journal_entries,
      invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', 21)`;
    const contact = await stammdaten.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "einkauf@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: "zugferd",
    });
    contactId = contact.id;
  });

  type Scope = import("../mcp/index.ts").TokenScope;
  async function token(scopes: Scope[]) {
    await mcp.setMcpEnabled(actor, true);
    return (await mcp.createMcpToken({ name: "Auftragsverwaltung", days: 30, scopes }, new Date(), actor)).token;
  }

  async function call(tokenValue: string, path: string) {
    const response = await api.handleApiRequest(new Request(`http://localhost:3000/api/v1${path}`, { headers: { Authorization: `Bearer ${tokenValue}` } }));
    const text = await response.text();
    return { status: response.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : null };
  }

  async function finalQuote(overrides = {}) {
    const created = await rechnungen.createQuoteDraft(actor, draft(overrides));
    return rechnungen.finalizeQuote(actor, created.id);
  }

  it("listet Entwürfe zuerst, dann festgeschriebene Angebote mit Nummer, Kunde und Stand", async () => {
    const final = await finalQuote();
    const entwurf = await rechnungen.createQuoteDraft(actor, draft());
    const t = await token(["angebote:lesen"]);

    const list = await call(t, "/angebote");
    expect(list.status).toBe(200);
    const page = schemas.quoteListSchema.parse(list.json);
    expect(page.total).toBe(2);
    expect(page.data.map((q) => q.id)).toEqual([entwurf.id, final.id]);
    expect(page.data[0]).toMatchObject({ status: "draft", listStatus: "entwurf", number: null, contactId });
    expect(page.data[1]).toMatchObject({
      status: "final",
      listStatus: "offen",
      number: final.number,
      contactId,
      customer: "Nordwerk Software GmbH",
      net: 76_000,
      gross: 90_440,
      decision: null,
      invoiceId: null,
      url: expect.stringMatching(new RegExp(`/angebote/${final.id}$`)),
    });
  });

  it("liest ein Angebot mit Positionen; eine optionale Position zählt nicht zur Summe", async () => {
    const final = await finalQuote({ intro: "Wie besprochen:", lines: [line(), optional] });
    const t = await token(["angebote:lesen"]);

    const read = await call(t, `/angebote/${final.id}`);
    expect(read.status).toBe(200);
    const quote = schemas.quoteSchema.parse(read.json);
    expect(quote).toMatchObject({ number: final.number, intro: "Wie besprochen:", net: 76_000, tax: 14_440, gross: 90_440, choices: [] });
    expect(quote.lines).toEqual([
      expect.objectContaining({ position: 1, description: "Workshop Architektur", quantity: 8000, unitPrice: 9500, net: 76_000, kind: null }),
      expect.objectContaining({ position: 2, description: "Dokumentation", unit: "Psch.", net: 50_000, kind: "optional" }),
    ]);
    expect(quote.lockedAt).not.toBeNull();
  });

  it("zeigt die Antwort des Kunden mit seiner Auswahl und danach die Rechnung aus dem Angebot", async () => {
    const final = await finalQuote({ lines: [line(), optional] });
    const t = await token(["angebote:lesen"]);

    await rechnungen.setQuoteDecision(actor, final.id, "angenommen", [2]);
    const angenommen = schemas.quoteSchema.parse((await call(t, `/angebote/${final.id}`)).json);
    expect(angenommen).toMatchObject({ listStatus: "angenommen", decision: "angenommen", choices: [2], invoiceId: null });
    expect(angenommen.decidedAt).not.toBeNull();

    const invoice = await rechnungen.quoteToInvoice(actor, final.id, "2026-11-02");
    const abgerechnet = schemas.quoteSchema.parse((await call(t, `/angebote/${final.id}`)).json);
    expect(abgerechnet).toMatchObject({ listStatus: "abgerechnet", invoiceId: invoice.id, invoiceNumber: null });
  });

  it("filtert nach Status, Nummer und Kunde", async () => {
    const final = await finalQuote();
    await rechnungen.createQuoteDraft(actor, draft());
    const t = await token(["angebote:lesen"]);

    expect(schemas.quoteListSchema.parse((await call(t, "/angebote?status=final")).json).data.map((q) => q.id)).toEqual([final.id]);
    expect(schemas.quoteListSchema.parse((await call(t, `/angebote?number=${final.number}`)).json).data.map((q) => q.id)).toEqual([final.id]);
    expect(schemas.quoteListSchema.parse((await call(t, `/angebote?contactId=${crypto.randomUUID()}`)).json).total).toBe(0);
    expect(schemas.quoteListSchema.parse((await call(t, "/angebote?limit=1&offset=1")).json)).toMatchObject({ total: 2, limit: 1, offset: 1 });
  });

  it("filtert nach Kunde auch mit einer UUID in Großbuchstaben, wie der Router Pfad-IDs annimmt", async () => {
    const final = await finalQuote();
    const t = await token(["angebote:lesen"]);

    const list = await call(t, `/angebote?contactId=${contactId.toUpperCase()}`);
    expect(list.status).toBe(200);
    expect(schemas.quoteListSchema.parse(list.json).data.map((q) => q.id)).toEqual([final.id]);
  });

  it("verlangt das eigene Recht angebote:lesen; Rechnungsrechte reichen nicht und umgekehrt", async () => {
    const final = await finalQuote();
    const rechnungenLesen = await token(["rechnungen:entwuerfe"]);
    const angeboteLesen = await token(["angebote:lesen"]);

    expect((await call(rechnungenLesen, "/angebote")).status).toBe(403);
    expect((await call(rechnungenLesen, `/angebote/${final.id}`)).status).toBe(403);
    expect((await call(angeboteLesen, "/rechnungen")).status).toBe(403);
  });

  it("antwortet mit 404 für ein unbekanntes Angebot und mit 400 für unbekannte Filter", async () => {
    const t = await token(["angebote:lesen"]);
    expect((await call(t, `/angebote/${crypto.randomUUID()}`)).status).toBe(404);
    const unknown = await call(t, "/angebote?kind=storno");
    expect(unknown.status).toBe(400);
    expect(unknown.json).toMatchObject({ error: { code: "validation_failed" } });
  });
});
