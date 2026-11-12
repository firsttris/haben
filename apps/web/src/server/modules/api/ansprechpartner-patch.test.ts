import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("API PATCH und Ansprechpartner (#424)", () => {
  let api: typeof import("./index.ts");
  let schemas: typeof import("./schemas.ts");
  let mcp: typeof import("../mcp/index.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let rechnungen: typeof import("../rechnungen/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into "user"(id,name,email,role) values (${actor}, 'Testinhaber', 'inhaber@example.de', 'inhaber')`;
    api = await import("./index.ts");
    schemas = await import("./schemas.ts");
    mcp = await import("../mcp/index.ts");
    stammdaten = await import("../stammdaten/index.ts");
    rechnungen = await import("../rechnungen/index.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate mcp_calls, mcp_tokens, journal_lines, journal_entries, invoice_lines, invoice_taxes, invoices, invoice_number_counters,
      contact_persons, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
  });

  it("PATCH contactId auf einen anderen Kunden klappt auch, wenn der Entwurf in Haben eine Ansprechpartnerin trägt", async () => {
    await mcp.setMcpEnabled(actor, true);
    const { token } = await mcp.createMcpToken({ name: "Shop", days: 30, scopes: ["rechnungen:entwuerfe"] }, new Date(), actor);
    const a = await stammdaten.createContact(actor, { ...schemas.CONTACT_DEFAULTS, name: "Kunde A GmbH" });
    const b = await stammdaten.createContact(actor, { ...schemas.CONTACT_DEFAULTS, name: "Kunde B GmbH" });
    const mara = await stammdaten.createContactPerson(actor, a.id, { name: "Mara Beispiel" });
    const draft = await rechnungen.createDraft(actor, {
      contactId: a.id,
      contactPersonId: mara,
      issueDate: "2026-09-05",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    } as never);
    const response = await api.handleApiRequest(
      new Request(`http://localhost:3000/api/v1/rechnungen/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contactId: b.id }),
      }),
    );
    const text = await response.text();
    expect(response.status, text).toBe(200);
  });
});
