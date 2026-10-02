import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Wiederkehrende Rechnungen (Postgres)", () => {
  let recurring: typeof import("./recurring.ts");
  let contacts: typeof import("./contacts.ts");
  let sql: postgres.Sql;
  let contactId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    recurring = await import("./recurring.ts");
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate journal_lines, journal_entries, invoice_lines, invoices, recurring_invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
      email: "rechnung@nordwerk.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
    });
    contactId = contact.id;
  });

  const template = (overrides: Partial<import("./recurring.ts").RecurringInput> = {}) => ({
    name: "Wartung Nordwerk",
    active: true,
    contactId,
    format: "zugferd" as const,
    paymentTermDays: 14,
    note: "Abrechnung {zeitraum}",
    taxTreatment: "regulaer" as const,
    exemptionReason: "",
    lines: [{ description: "Wartung {monat} {jahr}", quantity: 1000, unit: "Psch." as const, unitPrice: 50_000, taxRate: 1900 as const }],
    intervalMonths: 1 as const,
    nextDate: "2026-08-31",
    endDate: null,
    servicePeriod: "laufend" as const,
    mode: "entwurf" as const,
    ...overrides,
  });

  it("holt verpasste Termine als Entwürfe nach, mit Platzhaltern und Leistungszeitraum", async () => {
    const created = await recurring.createRecurring(actor, template());
    expect(await recurring.runDueRecurring("2026-10-02")).toEqual({ created: 2, finalized: 0, errors: [] });
    const rows = await sql`select i.issue_date::text, i.service_from::text, i.service_to::text, i.status, i.note, l.description
      from invoices i join invoice_lines l on l.invoice_id = i.id order by i.issue_date`;
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { issue_date: "2026-08-31", service_from: "2026-08-01", service_to: "2026-08-31", status: "draft", note: "Abrechnung August 2026", description: "Wartung August 2026" },
      { issue_date: "2026-09-30", service_from: "2026-09-01", service_to: "2026-09-30", status: "draft", note: "Abrechnung September 2026", description: "Wartung September 2026" },
    ]);
    const [after] = await sql`select next_date::text, active from recurring_invoices where id = ${created.id}`;
    expect(after).toEqual({ next_date: "2026-10-31", active: true });
    // Ein zweiter Lauf am selben Tag legt nichts doppelt an
    expect((await recurring.runDueRecurring("2026-10-02")).created).toBe(0);
  });

  it("schreibt fest und endet nach dem Enddatum", async () => {
    const created = await recurring.createRecurring(actor, template({ mode: "festschreiben", nextDate: "2026-09-01", endDate: "2026-10-15" }));
    expect(await recurring.runDueRecurring("2026-12-01")).toEqual({ created: 2, finalized: 2, errors: [] });
    const numbers = await sql`select number from invoices where status = 'final' order by number`;
    expect(numbers.map((r) => r.number)).toEqual(["2026-001", "2026-002"]);
    const [after] = await sql`select active from recurring_invoices where id = ${created.id}`;
    expect(after?.active).toBe(false);
  });

  it("lässt den Entwurf stehen, wenn das Festschreiben scheitert", async () => {
    await sql`update company set iban = ''`;
    const created = await recurring.createRecurring(actor, template({ mode: "festschreiben", nextDate: "2026-10-01" }));
    const result = await recurring.runDueRecurring("2026-10-02");
    expect(result).toMatchObject({ created: 1, finalized: 0 });
    expect(result.errors[0]).toContain("IBAN fehlt");
    const [row] = await sql`select status from invoices`;
    expect(row?.status).toBe("draft");
    const [after] = await sql`select last_error, next_date::text from recurring_invoices where id = ${created.id}`;
    expect(after).toMatchObject({ next_date: "2026-11-01" });
    expect(after?.last_error).toContain("als Entwurf angelegt");
  });

  it("Vorlage mit Rechnungen lässt sich nicht löschen", async () => {
    const created = await recurring.createRecurring(actor, template({ nextDate: "2026-10-01" }));
    await recurring.runDueRecurring("2026-10-02");
    await expect(recurring.deleteRecurring(actor, created.id)).rejects.toThrow("Deaktiviere");
    const unused = await recurring.createRecurring(actor, template({ nextDate: "2027-01-01" }));
    await recurring.deleteRecurring(actor, unused.id);
  });
});
