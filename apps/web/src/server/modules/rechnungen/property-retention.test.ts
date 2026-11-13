import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Aufbewahrungshinweis für Grundstücksleistungen (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let externalReference: typeof import("./external-reference.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  let contactId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    externalReference = await import("./external-reference.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001",
        name: "Anna Muster",
        strasse: "Lindenweg 3",
        plz: "10115",
        ort: "Berlin",
        land: "DE",
        email: "anna@example.com",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  const draft = (overrides = {}) => ({
    contactId,
    issueDate: "2026-11-02",
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "xrechnung-ubl" as const,
    note: "Freier Fußtext",
    lines: [{ description: "Montage", quantity: 1000, unit: "Std." as const, unitPrice: 10000, taxRate: 1900 as const }],
    ...overrides,
  });

  it("speichert die Auswahl unabhängig vom Fußtext, erhält sie beim Laden und kann sie wieder ausschalten", async () => {
    expect(await invoices.newDraftDefaults("2026-11-02")).toMatchObject({ propertyRetention: false });
    expect(await invoices.createDraft(actor, draft())).toMatchObject({ propertyRetention: false });
    const created = await invoices.createDraft(actor, draft({ propertyRetention: true }));
    expect(created).toMatchObject({ propertyRetention: true, note: "Freier Fußtext" });
    const loaded = (await invoices.getInvoice(created.id))!;
    const input = externalReference.draftInputOf(loaded.invoice, loaded.lines);
    expect(input).toMatchObject({ propertyRetention: true });
    expect(await invoices.updateDraft(actor, created.id, { ...input, note: "Geänderter Fußtext" })).toMatchObject({ propertyRetention: true });
    const disabled = { ...input, propertyRetention: false };
    expect(await invoices.updateDraft(actor, created.id, disabled)).toMatchObject({ propertyRetention: false });
  });

  it("übernimmt die Auswahl unveränderlich in Korrektur und Storno und schützt den festgeschriebenen Stand", async () => {
    const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft({ propertyRetention: true }))).id);
    expect(original).toMatchObject({ propertyRetention: true });
    expect(original.xml).toContain("14b");
    const correction = await invoices.createCorrection(actor, original.id, "2026-11-03");
    expect(correction).toMatchObject({ propertyRetention: true });
    const loaded = (await invoices.getInvoice(correction.id))!;
    const changed = { ...externalReference.draftInputOf(loaded.invoice, loaded.lines), propertyRetention: false };
    expect(await invoices.updateDraft(actor, correction.id, changed)).toMatchObject({ propertyRetention: true });
    await invoices.finalizeInvoice(actor, correction.id);
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-11-04");
    expect(storno).toMatchObject({ propertyRetention: true });
    expect(storno.xml).toContain("14b");
    const reversed = await sql`select property_retention from invoices where kind = 'storno'`;
    expect(reversed).toHaveLength(2);
    expect(reversed.every((row) => row.property_retention === true)).toBe(true);
    await expect(sql`update invoices set property_retention = false where id = ${original.id}`).rejects.toThrow(/festgeschrieben/);
    const unchanged = (await invoices.getInvoice(original.id))!.invoice;
    expect(unchanged.xml).toBe(original.xml);
    expect(unchanged.pdf).toEqual(original.pdf);
    expect(unchanged.pdfSha256).toBe(original.pdfSha256);
  });

  it("lässt den Hinweis freiwillig auch bei Kleinunternehmern zu und fügt ihn älteren Belegen nicht nachträglich hinzu", async () => {
    await sql`update company set kleinunternehmer = true where id = 1`;
    const input = draft({ taxTreatment: "kleinunternehmer", lines: [{ ...draft().lines[0]!, taxRate: 0 }] });
    const previous = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input)).id);
    expect(previous).toMatchObject({ propertyRetention: false });
    expect(previous.xml).not.toContain("14b");
    const selected = await invoices.createDraft(actor, { ...input, propertyRetention: true });
    const final = await invoices.finalizeInvoice(actor, selected.id);
    expect(final).toMatchObject({ propertyRetention: true });
    expect(final.xml).toContain("14b");
    const unchanged = (await invoices.getInvoice(previous.id))!.invoice;
    expect(unchanged.xml).toBe(previous.xml);
    expect(unchanged.pdf).toEqual(previous.pdf);
    expect(unchanged.pdfSha256).toBe(previous.pdfSha256);
    const correction = await invoices.createCorrection(actor, previous.id, "2026-11-03");
    const loaded = (await invoices.getInvoice(correction.id))!;
    const changed = { ...externalReference.draftInputOf(loaded.invoice, loaded.lines), propertyRetention: true };
    expect(await invoices.updateDraft(actor, correction.id, changed)).toMatchObject({ propertyRetention: false });
  });
});
