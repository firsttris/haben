import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Zähler je Kunde, Vergabe (#1426): Steht der Schalter, gehen Rechnung und Angebot beim Festschreiben in den Kreis des
 * Kunden (number_contact_id), sonst in den gemeinsamen Kreis. Storno und Korrektur folgen dem Kreis des Originals,
 * unabhängig vom Schalter. Dieselbe Kundennummer bei zwei Kontakten blockiert das Festschreiben im Kundenkreis, und
 * wer festgeschriebene Belege im eigenen Kundenkreis trägt, kann seine Kundennummer nicht mehr ändern.
 */
describe.skipIf(!testDatabaseUrl)("Nummernkreis je Kunde, Vergabe (Postgres, #1426)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./invoices.ts");
  let quotes: typeof import("./quotes.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let formats: typeof import("./number-formats.ts");
  const actor = "test-user";
  let contactId: string;
  let contactA: string;
  let contactB: string;

  const contactInput = (kundennummer: string, name = "Zweitkunde GmbH") => ({
    kundennummer,
    name,
    strasse: "Werkstraße 9",
    plz: "10115",
    ort: "Berlin",
    land: "DE",
    email: "",
    ustId: "",
    iban: "",
    leitwegId: "",
    defaultFormat: null,
  });
  const createContact = (kundennummer: string, name?: string) => contacts.createContact(actor, contactInput(kundennummer, name));
  const invoiceDraft = (contact = contactId, issueDate = "2026-03-02") =>
    invoices.createDraft(actor, {
      contactId: contact,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
    });
  const quoteDraft = (contact = contactId) =>
    quotes.createQuoteDraft(actor, {
      contactId: contact,
      issueDate: "2026-03-02",
      validUntil: "2026-03-31",
      serviceFrom: null,
      serviceTo: null,
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
    });
  const JE_KUNDE = { invoice: "RE-{JJJJ}-{KUNDENNR}-{NNN}", quote: "AN-{JJJJ}-{KUNDENNR}-{NNN}", invoicePerCustomer: true, quotePerCustomer: true };
  const GEMEINSAM = { invoice: "RE-{JJJJ}-{NNN}", quote: "AN-{JJJJ}-{NNN}", invoicePerCustomer: false, quotePerCustomer: false };

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    quotes = await import("./quotes.ts");
    contacts = await import("../stammdaten/contacts.ts");
    formats = await import("./number-formats.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    contactId = (await createContact("10001", "Nordwerk Software GmbH")).id;
    contactA = (await createContact("ACME", "ACME GmbH")).id;
    contactB = (await createContact("BETA", "Beta KG")).id;
  });

  it("vergibt je Kunde einen eigenen Kreis und lässt den gemeinsamen unberührt", async () => {
    await formats.saveNumberFormats(actor, JE_KUNDE);
    const a1 = await invoices.finalizeInvoice(actor, (await invoiceDraft(contactA)).id, kleinunternehmerStand);
    const b1 = await invoices.finalizeInvoice(actor, (await invoiceDraft(contactB)).id, kleinunternehmerStand);
    const a2 = await invoices.finalizeInvoice(actor, (await invoiceDraft(contactA)).id, kleinunternehmerStand);
    expect([a1.number, b1.number, a2.number]).toEqual(["RE-2026-ACME-001", "RE-2026-BETA-001", "RE-2026-ACME-002"]);
    const belege = await sql`select number, number_contact_id from invoices where status = 'final' order by number`;
    expect(belege.map((r) => [r.number, r.number_contact_id])).toEqual([
      ["RE-2026-ACME-001", contactA],
      ["RE-2026-ACME-002", contactA],
      ["RE-2026-BETA-001", contactB],
    ]);
    // Der gemeinsame Kreis hat keine Zählerzeile bekommen
    const rows = await sql`select contact_id, last from invoice_number_counters`;
    expect(Object.fromEntries(rows.map((r) => [r.contact_id, r.last]))).toEqual({ [contactA]: 2, [contactB]: 1 });
  });

  it("stellt Storno und Korrektur in den Kreis des Originals, auch wenn der Schalter inzwischen aus ist", async () => {
    await formats.saveNumberFormats(actor, JE_KUNDE);
    const a1 = await invoices.finalizeInvoice(actor, (await invoiceDraft(contactA)).id, kleinunternehmerStand);
    const a2 = await invoices.finalizeInvoice(actor, (await invoiceDraft(contactA)).id, kleinunternehmerStand);
    await formats.saveNumberFormats(actor, GEMEINSAM);
    const korrektur = await invoices.createCorrection(actor, a1.id, "2026-12-16");
    const korrigiert = await invoices.finalizeInvoice(actor, korrektur.id, kleinunternehmerStand);
    const storno = await invoices.cancelInvoice(actor, a2.id, "2026-12-17");
    expect([korrigiert.number, storno.number]).toEqual(["RE-2026-003", "RE-2026-004"]);
    const belege = await sql`select id, number_contact_id from invoices where id in (${korrigiert.id}, ${storno.id}) order by number`;
    expect(belege.map((r) => r.number_contact_id)).toEqual([contactA, contactA]);
    const [kreis] = await sql`select last from invoice_number_counters where year = 2026 and contact_id = ${contactA}`;
    expect(kreis!.last).toBe(4);
  });

  it("lässt das Storno eines Belegs im gemeinsamen Kreis dort, auch wenn der Schalter inzwischen an ist (SKR04)", async () => {
    await sql`update company set kontenrahmen = 'SKR04'`;
    await formats.saveNumberFormats(actor, GEMEINSAM);
    const original = await invoices.finalizeInvoice(actor, (await invoiceDraft(contactA)).id, kleinunternehmerStand);
    await formats.saveNumberFormats(actor, JE_KUNDE);
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-12-15");
    expect(storno.number).toBe("RE-2026-ACME-002");
    const [beleg] = await sql`select number_year, number_contact_id from invoices where id = ${storno.id}`;
    expect(beleg).toMatchObject({ number_year: 2026, number_contact_id: null });
  });

  it("kreist auch Angebote je Kunde", async () => {
    await formats.saveNumberFormats(actor, JE_KUNDE);
    const a1 = await quotes.finalizeQuote(actor, (await quoteDraft(contactA)).id);
    const b1 = await quotes.finalizeQuote(actor, (await quoteDraft(contactB)).id);
    const a2 = await quotes.finalizeQuote(actor, (await quoteDraft(contactA)).id);
    expect([a1.number, b1.number, a2.number]).toEqual(["AN-2026-ACME-001", "AN-2026-BETA-001", "AN-2026-ACME-002"]);
    const [beleg] = await sql`select number_contact_id from quotes where number = 'AN-2026-ACME-001'`;
    expect(beleg!.number_contact_id).toBe(contactA);
  });

  it("sperrt die Kundennummer, sobald festgeschriebene Belege im Kundenkreis sie tragen", async () => {
    await formats.saveNumberFormats(actor, JE_KUNDE);
    await invoices.finalizeInvoice(actor, (await invoiceDraft(contactA)).id, kleinunternehmerStand);
    await expect(contacts.updateContact(actor, contactA, contactInput("ACMEX", "ACME GmbH"))).rejects.toThrow(/gesperrt/);
    const [a] = await sql`select kundennummer from contacts where id = ${contactA}`;
    expect(a!.kundennummer).toBe("ACME");
    // ohne festgeschriebenen Beleg im Kundenkreis bleibt die Änderung erlaubt
    await invoices.finalizeInvoice(actor, (await invoiceDraft(contactB)).id, kleinunternehmerStand);
    await expect(contacts.updateContact(actor, contactB, contactInput("BETAX", "Beta KG"))).rejects.toThrow(/gesperrt/);
    await expect(contacts.updateContact(actor, contactId, contactInput("10002", "Nordwerk Software GmbH"))).resolves.toMatchObject({ kundennummer: "10002" });
  });

  it("sperrt die Kundennummer auch über ein festgeschriebenes Angebot, nicht über den gemeinsamen Kreis", async () => {
    await formats.saveNumberFormats(actor, JE_KUNDE);
    await quotes.finalizeQuote(actor, (await quoteDraft(contactA)).id);
    await expect(contacts.updateContact(actor, contactA, contactInput("ACME2", "ACME GmbH"))).rejects.toThrow(/gesperrt/);
    // Beleg im gemeinsamen Kreis sperrt nicht: erst mit dem Schalter kam der Kundenkreis dazu
    await formats.saveNumberFormats(actor, GEMEINSAM);
    await invoices.finalizeInvoice(actor, (await invoiceDraft(contactId)).id, kleinunternehmerStand);
    await expect(contacts.updateContact(actor, contactId, contactInput("10002", "Nordwerk Software GmbH"))).resolves.toMatchObject({ kundennummer: "10002" });
  });

  it("stellt Storno und Korrektur auch zu, wenn inzwischen ein zweiter Kontakt dieselbe Kundennummer trägt", async () => {
    await formats.saveNumberFormats(actor, JE_KUNDE);
    const original = await invoices.finalizeInvoice(actor, (await invoiceDraft(contactA)).id, kleinunternehmerStand);
    const zweites = await invoices.finalizeInvoice(actor, (await invoiceDraft(contactA)).id, kleinunternehmerStand);
    // Die Kundennummer darf doppelt angelegt werden; erst das Festschreiben im Kundenkreis verlangt Eindeutigkeit
    const nachzuegler = (await createContact("ACME", "Nachzügler AG")).id;
    // GoBD: Storno und Korrektur folgen dem Original und dürfen nie an der Eindeutigkeit scheitern
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-12-15");
    expect(storno.number).toBe("RE-2026-ACME-003");
    const [beleg] = await sql`select number_contact_id from invoices where id = ${storno.id}`;
    expect(beleg!.number_contact_id).toBe(contactA);
    const korrektur = await invoices.createCorrection(actor, zweites.id, "2026-12-16");
    const korrigiert = await invoices.finalizeInvoice(actor, korrektur.id, kleinunternehmerStand);
    expect(korrigiert.number).toBe("RE-2026-ACME-004");
    // Festschreiben eines neuen Belegs im Kreis des Nachzüglers scheitert weiterhin an der Eindeutigkeit
    const draft = await invoiceDraft(nachzuegler);
    await expect(invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand)).rejects.toThrow(/Kundennummer ACME hat auch.*eindeutig/);
  });

  it("verlangt beim Zähler je Kunde eine eindeutige Kundennummer und lässt den Zähler unverändert", async () => {
    await formats.saveNumberFormats(actor, JE_KUNDE);
    await invoices.finalizeInvoice(actor, (await invoiceDraft(contactA)).id, kleinunternehmerStand);
    await contacts.updateContact(actor, contactB, contactInput("ACME", "Beta KG"));
    const draft = await invoiceDraft(contactB);
    await expect(invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand)).rejects.toThrow(/Kundennummer ACME hat auch.*eindeutig/);
    const rows = await sql`select contact_id, last from invoice_number_counters`;
    expect(rows.map((r) => [r.contact_id, r.last])).toEqual([[contactA, 1]]);
    const [beleg] = await sql`select status from invoices where id = ${draft.id}`;
    expect(beleg!.status).toBe("draft");
  });

  it("setzt die nächste Nummer je Kunde und lässt die anderen Kreise unberührt", async () => {
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{KUNDENNR}-{NNN}", quote: "AN-{JJJJ}-{NNN}", invoicePerCustomer: true });
    await invoices.setNextNumber(actor, "2026-11-07", 50, "rechnung", contactA);
    expect(await invoices.numbering("2026-11-07", "rechnung", contactA)).toMatchObject({ last: 49, next: "RE-2026-ACME-050" });
    expect(await invoices.numbering("2026-11-07", "rechnung", contactB)).toMatchObject({ last: 0 });
    expect(await invoices.numbering("2026-11-07", "rechnung")).toMatchObject({ last: 0 });
    // ohne Schalter je Kunde ist ein Kontakt-Kreis nicht erlaubt
    await expect(invoices.setNextNumber(actor, "2026-11-07", 5, "angebot", contactA)).rejects.toThrow(/je Kunde/);
  });

  it("liefert die Kreise eines Kunden nur für die Art mit Zähler je Kunde", async () => {
    expect(await invoices.contactNumbering("2026-11-07", contactA)).toEqual({ invoice: null, quote: null });
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{KUNDENNR}-{NNN}", quote: "AN-{JJJJ}-{NNN}", invoicePerCustomer: true });
    const kreise = await invoices.contactNumbering("2026-11-07", contactA);
    expect(kreise.invoice).toMatchObject({ kind: "rechnung", year: 2026, last: 0, next: "RE-2026-ACME-001" });
    expect(kreise.quote).toBeNull();
  });

  it("startet den durchlaufenden Kundenkreis hinter seiner letzten Jahresnummer", async () => {
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{KUNDENNR}-{NNN}", quote: "AN-{JJJJ}-{NNN}", invoicePerCustomer: true });
    await invoices.finalizeInvoice(actor, (await invoiceDraft(contactA, "2026-12-30")).id, kleinunternehmerStand);
    await invoices.finalizeInvoice(actor, (await invoiceDraft(contactA, "2026-12-30")).id, kleinunternehmerStand);
    await formats.saveNumberFormats(actor, {
      invoice: "RE-{KUNDENNR}-{NNNN}",
      quote: "AN-{JJJJ}-{NNN}",
      invoiceRunning: true,
      invoicePerCustomer: true,
    });
    const [kreis] = await sql`select last from invoice_number_counters where year = 0 and contact_id = ${contactA}`;
    expect(kreis!.last).toBe(2);
    const next = await invoices.finalizeInvoice(actor, (await invoiceDraft(contactA, "2027-01-05")).id, kleinunternehmerStand);
    expect(next.number).toBe("RE-ACME-0003");
    const fremd = await invoices.finalizeInvoice(actor, (await invoiceDraft(contactB, "2027-01-05")).id, kleinunternehmerStand);
    expect(fremd.number).toBe("RE-BETA-0001");
  });
});
