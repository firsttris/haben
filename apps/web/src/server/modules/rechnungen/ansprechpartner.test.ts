import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Ansprechpartner in Entwurf, Rechnung und Angebot (#424): Im Entwurf wählbar (nur aktive Personen des eigenen Kunden,
 * die schon gewählte bleibt), beim Festschreiben als Stand im Käufer des Belegs. Spätere Änderungen an der Person
 * ändern weder die Rechnung noch ihr Siegel. Storno, Mahnung und Lieferschein tragen den Stand der Rechnung, Angebot
 * und Rechnung aus dem Angebot den ihres Angebots. SKR03/SKR04 spielen hier keine Rolle (keine Buchung wird verändert),
 * die Siegel und die Hash-Kette bleiben unverändert gültig. Alle Daten sind erfunden.
 */

describe.skipIf(!testDatabaseUrl)("Ansprechpartner an Rechnung und Angebot (Postgres, #424)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./invoices.ts");
  let quotes: typeof import("./quotes.ts");
  let persons: typeof import("../stammdaten/contact-persons.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let integrity: typeof import("../auswertungen/integrity.ts");
  let reference: typeof import("./external-reference.ts");
  const actor = "test-user";
  let contactId: string;
  let otherContactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    quotes = await import("./quotes.ts");
    persons = await import("../stammdaten/contact-persons.ts");
    contacts = await import("../stammdaten/contacts.ts");
    integrity = await import("../auswertungen/integrity.ts");
    reference = await import("./external-reference.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate quote_lines, quotes, invoice_lines, invoices, invoice_number_counters, quote_number_counters, contact_persons, contact_versions, contacts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    const kunde = (name: string) => ({
      kundennummer: "",
      name,
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = (await contacts.createContact(actor, kunde("Nordwerk Software GmbH"))).id;
    otherContactId = (await contacts.createContact(actor, kunde("Rheinpixel GmbH"))).id;
  });

  /** Der Käufer in der CII-XML; der Verkäufer hat ebenfalls einen Ansprechpartner (BT-41) */
  const käufer = (xml: string | null) => xml?.match(/<ram:BuyerTradeParty>([\s\S]*?)<\/ram:BuyerTradeParty>/)?.[1] ?? "";

  const maraInput = { name: "Mara Beispiel", email: "mara@nordwerk.example", telefon: "+49 40 7654321", funktion: "Einkauf" };

  const draftInput = (overrides: Record<string, unknown> = {}) => ({
    contactId,
    issueDate: "2026-09-05",
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines: [{ description: "Leistungen August", quantity: 1000, unit: "Psch." as const, unitPrice: 100_000, taxRate: 1900 as const }],
    ...overrides,
  });

  const quoteInput = (overrides: Record<string, unknown> = {}) => ({
    contactId,
    issueDate: "2026-09-05",
    validUntil: "2026-10-05",
    serviceFrom: null,
    serviceTo: null,
    note: "",
    lines: [{ description: "Beratung", quantity: 1000, unit: "Psch." as const, unitPrice: 100_000, taxRate: 1900 as const }],
    ...overrides,
  });

  it("Rechnung: die Person steht nach dem Festschreiben als Stand im Käufer und in der XML, spätere Änderungen berühren sie nicht", async () => {
    const mara = await persons.createContactPerson(actor, contactId, maraInput);
    const draft = await invoices.createDraft(actor, draftInput({ contactPersonId: mara }));
    expect(draft.contactPersonId).toBe(mara);
    const invoice = await invoices.finalizeInvoice(actor, draft.id);

    expect(invoice.buyer?.ansprechpartner).toEqual(maraInput);
    // BT-56 am Käufer der gespeicherten E-Rechnung (ZUGFeRD: CII)
    expect(käufer(invoice.xml)).toContain("<ram:PersonName>Mara Beispiel</ram:PersonName>");
    const siegelVorher = await sql`select * from seals order by id`;

    // Die Person ändert sich und wird deaktiviert: Rechnung, Stand und Siegel bleiben
    await persons.updateContactPerson(actor, mara, { ...maraInput, name: "Mara Beispielmann", email: "neu@nordwerk.example" });
    await persons.setContactPersonActive(actor, mara, false);
    const nachher = await invoices.getInvoice(draft.id);
    expect(nachher?.invoice.buyer?.ansprechpartner).toEqual(maraInput);
    expect(await sql`select * from seals order by id`).toEqual(siegelVorher);

    // Die gewählte Person einer festgeschriebenen Rechnung lässt sich nicht mehr ändern (Sperre ab dem Festschreiben)
    await expect(sql`update invoices set contact_person_id = null where id = ${draft.id}`).rejects.toThrow(/festgeschrieben|gesperrt|darf nicht/i);
    const report = await integrity.checkIntegrity("2026-09-10");
    expect(report.problems).toEqual([]);
  });

  it("Entwurf: nur aktive Personen des eigenen Kunden; die schon gewählte bleibt auch deaktiviert", async () => {
    const aktiv = await persons.createContactPerson(actor, contactId, maraInput);
    const weg = await persons.createContactPerson(actor, contactId, { ...maraInput, name: "Ehemals Beispiel" });
    const fremd = await persons.createContactPerson(actor, otherContactId, { ...maraInput, name: "Fremde Person" });

    await expect(invoices.createDraft(actor, draftInput({ contactPersonId: fremd }))).rejects.toThrow(/anderen Kunden/);
    await expect(invoices.createDraft(actor, draftInput({ contactId: null, contactPersonId: aktiv }))).rejects.toThrow(/brauchen einen Kunden/);

    const draft = await invoices.createDraft(actor, draftInput({ contactPersonId: weg }));
    await persons.setContactPersonActive(actor, weg, false);
    // Schon gewählt: bleibt beim Speichern; neu wählen geht nicht mehr
    await invoices.updateDraft(actor, draft.id, draftInput({ contactPersonId: weg, note: "geändert" }));
    expect((await invoices.getInvoice(draft.id))?.invoice.contactPersonId).toBe(weg);
    const other = await invoices.createDraft(actor, draftInput());
    await expect(invoices.updateDraft(actor, other.id, draftInput({ contactPersonId: weg }))).rejects.toThrow(/deaktiviert/);
    // Kunde gewechselt: die Person des alten Kunden passt nicht mehr
    await expect(invoices.updateDraft(actor, draft.id, draftInput({ contactId: otherContactId, contactPersonId: weg }))).rejects.toThrow(/anderen Kunden/);
    await invoices.updateDraft(actor, draft.id, draftInput({ contactPersonId: null }));
    expect((await invoices.getInvoice(draft.id))?.invoice.contactPersonId).toBeNull();
  });

  it("Rechnung ohne Person bleibt wie bisher: kein Ansprechpartner im Käufer, keine Zeile im XML", async () => {
    const invoice = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draftInput())).id);
    expect(invoice.buyer).not.toHaveProperty("ansprechpartner");
    expect(käufer(invoice.xml)).not.toContain("PersonName");
  });

  it("Storno trägt den Stand der Rechnung, auch wenn die Person inzwischen anders heißt", async () => {
    const mara = await persons.createContactPerson(actor, contactId, maraInput);
    const invoice = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draftInput({ contactPersonId: mara }))).id);
    await persons.updateContactPerson(actor, mara, { ...maraInput, name: "Mara Beispielmann" });
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-09-20");
    expect(storno.buyer?.ansprechpartner?.name).toBe("Mara Beispiel");
  });

  it("API: Ein PATCH mit anderen Feldern setzt die gewählte Person nicht zurück (draftInputOf)", async () => {
    const mara = await persons.createContactPerson(actor, contactId, maraInput);
    const draft = await invoices.createDraft(actor, draftInput({ contactPersonId: mara }));
    const data = await invoices.getInvoice(draft.id);
    expect(reference.draftInputOf(data!.invoice, data!.lines).contactPersonId).toBe(mara);
  });

  it("Angebot: die Person steht im Käufer des Angebots und geht in die Rechnung aus dem Angebot über; deaktiviert, bleibt sie dort leer", async () => {
    const mara = await persons.createContactPerson(actor, contactId, maraInput);
    const quote = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, quoteInput({ contactPersonId: mara }))).id);
    expect(quote.buyer?.ansprechpartner).toEqual(maraInput);

    const invoice = await quotes.quoteToInvoice(actor, quote.id, "2026-09-10");
    expect(invoice.contactPersonId).toBe(mara);

    // Die Kopie behält die Person, solange sie aktiv ist
    const copy = await quotes.copyQuote(actor, quote.id, "2026-09-12");
    expect(copy.contactPersonId).toBe(mara);

    // Ein zweites Angebot mit derselben Person; sie wird deaktiviert, bevor es abgerechnet oder kopiert wird
    const second = await quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, quoteInput({ contactPersonId: mara }))).id);
    await persons.setContactPersonActive(actor, mara, false);
    // Die Rechnung daraus lässt sich trotzdem anlegen, ohne Person; auch die Kopie wählt sie nicht mehr
    expect((await quotes.quoteToInvoice(actor, second.id, "2026-09-15")).contactPersonId).toBeNull();
    expect((await quotes.copyQuote(actor, second.id, "2026-09-16")).contactPersonId).toBeNull();
    // Der Stand im Angebot bleibt
    expect(second.buyer?.ansprechpartner?.name).toBe("Mara Beispiel");
  });
});
