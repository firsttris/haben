import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Zähler je Kunde (#1426): contact_id in den Zählertabellen und als number_contact_id an den Belegen trennt den
 * Nummernkreis je Kontakt vom bisherigen gemeinsamen Kreis (contact_id NULL). Die Vergabe hängt die Kreise in S4 an
 * die Aufrufer; hier stehen Kreis, Fremdschlüssel, Unique-Index, Sperren und Audit der neuen Spalte.
 */
describe.skipIf(!testDatabaseUrl)("Nummernkreis je Kunde (Postgres, #1426)", () => {
  let sql: postgres.Sql;
  let db: typeof import("../../db/index.ts");
  let invoices: typeof import("./index.ts");
  let quotes: typeof import("./quotes.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let formats: typeof import("./number-formats.ts");
  let counter: typeof import("./number-counter.ts");
  const actor = "test-user";
  let contactId: string;
  let contactA: string;
  let contactB: string;

  const createContact = (kundennummer: string, name = "Zweitkunde GmbH") =>
    contacts.createContact(actor, {
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
  const invoiceDraft = (contact = contactId) =>
    invoices.createDraft(actor, {
      contactId: contact,
      issueDate: "2026-03-02",
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

  beforeAll(async () => {
    sql = await setupTestDb();
    db = await import("../../db/index.ts");
    invoices = await import("./index.ts");
    quotes = await import("./quotes.ts");
    contacts = await import("../stammdaten/contacts.ts");
    formats = await import("./number-formats.ts");
    counter = await import("./number-counter.ts");
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

  it("zählt die Kundenkreise unabhängig voneinander und vom gemeinsamen Kreis", async () => {
    await db.db.transaction(async (tx) => {
      await counter.takeNumber(tx, "rechnung", 2026, 1, contactA);
      await counter.takeNumber(tx, "rechnung", 2026, 1, contactB);
      await counter.takeNumber(tx, "rechnung", 2026, 1, null);
      await counter.takeNumber(tx, "rechnung", 2026, 2, contactA);
      await counter.takeNumber(tx, "rechnung", 2026, 2, null);
      // Angebote zählen wie bisher getrennt, ebenfalls je Kreis
      await counter.takeNumber(tx, "angebot", 2026, 1, contactA);
      await counter.takeNumber(tx, "angebot", 2026, 1, null);
    });
    const rows = await sql`select year, contact_id, last from invoice_number_counters`;
    expect(Object.fromEntries(rows.map((r) => [r.contact_id, r.last]))).toEqual({ null: 2, [contactA]: 2, [contactB]: 1 });
    const quoteRows = await sql`select contact_id, last from quote_number_counters`;
    expect(Object.fromEntries(quoteRows.map((r) => [r.contact_id, r.last]))).toEqual({ null: 1, [contactA]: 1 });
  });

  it("verweigert eine zweite Zeile für Jahr und gemeinsamen Kreis (NULLS NOT DISTINCT)", async () => {
    await sql`insert into invoice_number_counters (year, last) values (2026, 1)`;
    await expect(sql`insert into invoice_number_counters (year, last) values (2026, 5)`).rejects.toThrow(/unique|duplicate/i);
    // ein Kundenkreis zum selben Jahr kollidiert nicht mit dem gemeinsamen
    await sql`insert into invoice_number_counters (year, last, contact_id) values (2026, 5, ${contactA})`;
  });

  it("hält den Kontakt von Zählerzeile und Belegkreis fest (ON DELETE RESTRICT)", async () => {
    // Je Kontakt genau eine Sperre, damit klar ist, welcher Fremdschlüssel ihn festhält
    await sql`insert into invoice_number_counters (year, last, contact_id) values (2026, 1, ${contactA})`;
    await sql`insert into quote_number_counters (year, last, contact_id) values (2026, 1, ${contactB})`;
    const loeschen = (contact: string, stattdessen: RegExp) =>
      expect(
        sql.begin(async (tx) => {
          // contacts ist nur anhängbar (0003): die Sperr-Trigger nur für diese Transaktion aussetzen
          await tx`alter table contacts disable trigger contacts_no_delete`;
          await tx`alter table contact_versions disable trigger contact_versions_append_only`;
          await tx`delete from contact_versions where contact_id = ${contact}`;
          await tx`delete from contacts where id = ${contact}`;
        }),
      ).rejects.toThrow(stattdessen);
    await loeschen(contactA, /invoice_number_counters/);
    await loeschen(contactB, /quote_number_counters/);
    // Belegkreis: je ein Beleg von C trägt den Kreis eines frischen Kontakts
    const kreisA = (await createContact("GAMMA")).id;
    const kreisB = (await createContact("DELTA")).id;
    await sql`update invoices set number_contact_id = ${kreisA} where id = ${(await invoiceDraft(contactId)).id}`;
    await sql`update quotes set number_contact_id = ${kreisB} where id = ${(await quoteDraft(contactId)).id}`;
    await loeschen(kreisA, /invoices_number_contact_id/);
    await loeschen(kreisB, /quotes_number_contact_id/);
  });

  it("setzt die nächste Nummer je Kreis und hält jede Zählerzeile monoton", async () => {
    await db.db.transaction(async (tx) => {
      expect(await counter.setNextNumber(tx, "rechnung", 2026, 10, contactA)).toEqual({ ok: true });
      expect(await counter.setNextNumber(tx, "rechnung", 2026, 10, contactB)).toEqual({ ok: true });
      expect(await counter.setNextNumber(tx, "rechnung", 2026, 5, null)).toEqual({ ok: true });
      // hinter dem eigenen Kreis zurück ist unmöglich, ein anderer bleibt frei
      expect(await counter.setNextNumber(tx, "rechnung", 2026, 9, contactA)).toEqual({ ok: false, last: 9 });
      expect(await counter.setNextNumber(tx, "rechnung", 2026, 3, contactB)).toEqual({ ok: false, last: 9 });
    });
    // Der Monotonie-Trigger gilt je Zeile, also je Kreis — auch im Kundenkreis
    await expect(sql`update invoice_number_counters set last = 1 where year = 2026 and contact_id = ${contactA}`).rejects.toThrow(/nicht zurückgesetzt/);
    await expect(sql`update invoice_number_counters set last = 1 where year = 2026 and contact_id is null`).rejects.toThrow(/nicht zurückgesetzt/);
  });

  it("schreibt den Kreis als row_id ins Audit-Log: das Jahr, beim Kundenkreis Jahr:Kontakt", async () => {
    const [before] = await sql`select coalesce(max(seq), 0)::int as seq from audit_log`;
    await db.db.transaction(async (tx) => {
      await counter.takeNumber(tx, "rechnung", 2026, 1, null);
      await counter.takeNumber(tx, "rechnung", 2026, 1, contactA);
    });
    const rows = await sql`select row_id, action from audit_log
      where table_name = 'invoice_number_counters' and seq > ${before!.seq} order by row_id`;
    expect(rows).toEqual([
      { row_id: "2026", action: "INSERT" },
      { row_id: `2026:${contactA}`, action: "INSERT" },
    ]);
  });

  it("erlaubt dieselbe laufende Nummer in zwei Kreisen, im selben Kreis aber nicht", async () => {
    // Der Unique-Index auf Jahr, Kreis und Zähler kennt den gemeinsamen Kreis (NULL) wie die Kundenkreise;
    // Entwürfe ohne Nummernkreis laufen weiter nebeneinander
    const [a, b, s1, s2, a2] = await Promise.all([invoiceDraft(contactA), invoiceDraft(contactB), invoiceDraft(), invoiceDraft(), invoiceDraft(contactA)]);
    await sql`update invoices set number_year = 2026, number_counter = 1, number_contact_id = ${contactA} where id = ${a.id}`;
    await sql`update invoices set number_year = 2026, number_counter = 1, number_contact_id = ${contactB} where id = ${b.id}`;
    await sql`update invoices set number_year = 2026, number_counter = 1 where id = ${s1.id}`;
    await expect(sql`update invoices set number_year = 2026, number_counter = 1 where id = ${s2.id}`).rejects.toThrow(
      /invoices_number_counter|unique|duplicate/i,
    );
    await expect(sql`update invoices set number_year = 2026, number_counter = 1, number_contact_id = ${contactA} where id = ${a2.id}`).rejects.toThrow(
      /invoices_number_counter|unique|duplicate/i,
    );
  });

  it("sperrt den Kreis des festgeschriebenen Angebots wie die übrigen Spalten", async () => {
    const quote = await quotes.finalizeQuote(actor, (await quoteDraft()).id);
    await expect(sql`update quotes set number_contact_id = ${contactA} where id = ${quote.id}`).rejects.toThrow(/festgeschrieben/);
  });

  it("verlangt beim Zähler je Kunde die Kundennummer im Format (#1426)", async () => {
    await expect(formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{NNN}", quote: "AN-{JJJJ}-{NNN}", invoicePerCustomer: true })).rejects.toThrow(
      /Rechnungen: .*\{KUNDENNR\}/,
    );
    await expect(formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{NNN}", quote: "AN-{JJJJ}-{NNN}", quotePerCustomer: true })).rejects.toThrow(
      /Angebote: .*\{KUNDENNR\}/,
    );
    await formats.saveNumberFormats(actor, {
      invoice: "RE-{JJJJ}-{KUNDENNR}-{NNN}",
      quote: "AN-{KUNDENNR}-{NNNN}",
      invoicePerCustomer: true,
      quotePerCustomer: true,
      quoteRunning: true,
    });
    const [company] = await sql`select invoice_counter_per_customer, quote_counter_per_customer from company`;
    expect(company).toEqual({ invoice_counter_per_customer: true, quote_counter_per_customer: true });
    // ein Format ohne {KUNDENNR} lässt sich nicht speichern, solange der Schalter an ist
    await expect(formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{NNN}", quote: "AN-{JJJJ}-{NNN}" })).rejects.toThrow(/\{KUNDENNR\}/);
    // mit dem Schalter aus geht das Format wieder; {KUNDENNR} bleibt im gemeinsamen Kreis erlaubt
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{NNN}", quote: "AN-{KUNDENNR}-{NNNN}", invoicePerCustomer: false });
    const [zurueck] = await sql`select invoice_counter_per_customer, quote_counter_per_customer from company`;
    expect(zurueck).toEqual({ invoice_counter_per_customer: false, quote_counter_per_customer: true });
  });

  it("vergibt die Nummer eines Kundenkreises, solange ein anderer Kreis gesperrt ist", async () => {
    // Der Sperrschlüssel des Kundenkreises trägt den Kontakt: die Sperre eines anderen Kreises hält ihn nicht auf
    await sql.begin(async (blocker) => {
      await blocker`select pg_advisory_xact_lock(hashtext('haben.nummernkreis.rechnung.2026'))`;
      await db.db.transaction(async (tx) => {
        await counter.lockNumbering(tx, "rechnung", 2026, contactA);
        await counter.takeNumber(tx, "rechnung", 2026, 1, contactA);
      });
    });
    await sql.begin(async (blocker) => {
      await blocker`select pg_advisory_xact_lock(hashtext(${`haben.nummernkreis.rechnung.2026.${contactA}`}))`;
      await db.db.transaction(async (tx) => {
        await counter.lockNumbering(tx, "rechnung", 2026, contactB);
        await counter.takeNumber(tx, "rechnung", 2026, 1, contactB);
      });
    });
    const [row] = await sql`select last from invoice_number_counters where year = 2026 and contact_id = ${contactB}`;
    expect(row!.last).toBe(1);
  });

  it("lässt das Festschreiben im gemeinsamen Kreis unverändert", async () => {
    const number = (await invoices.finalizeInvoice(actor, (await invoiceDraft()).id, kleinunternehmerStand)).number;
    expect(number).toBe("2026-001");
    const [row] = await sql`select contact_id, number_contact_id from invoices where status = 'final'`;
    expect(row).toEqual({ contact_id: contactId, number_contact_id: null });
  });
});
