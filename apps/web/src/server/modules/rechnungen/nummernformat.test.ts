import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

describe.skipIf(!testDatabaseUrl)("Nummernformat (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let quotes: typeof import("./quotes.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let formats: typeof import("./number-formats.ts");
  const actor = "test-user";
  let contactId: string;

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
  const finalizeNew = async () => (await invoices.finalizeInvoice(actor, (await invoiceDraft()).id, kleinunternehmerStand)).number;
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
  const updateKundennummer = (id: string, kundennummer: string) =>
    contacts.updateContact(actor, id, {
      kundennummer,
      name: "Zweitkunde GmbH",
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

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
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
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "buchhaltung@nordwerk.example",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  it("nummeriert ab Werk wie bisher", async () => {
    expect(await finalizeNew()).toBe("2026-001");
    expect((await quotes.finalizeQuote(actor, (await quoteDraft()).id)).number).toBe("AN-2026-001");
  });

  it("nummeriert Rechnungen und Angebote im eigenen Format und zeigt die nächste Nummer darin", async () => {
    await formats.saveNumberFormats(actor, { invoice: " RE-{JJJJ}-{NNNN} ", quote: "ANG{JJ}{NN}" });
    expect(await finalizeNew()).toBe("RE-2026-0001");
    expect((await quotes.finalizeQuote(actor, (await quoteDraft()).id)).number).toBe("ANG2601");
    expect(await invoices.numbering("2026-03-02")).toMatchObject({ last: 1, next: "RE-2026-0002" });
    const [company] = await sql`select invoice_number_format from company`;
    expect(company!.invoice_number_format).toBe("RE-{JJJJ}-{NNNN}");
  });

  it("lehnt ungültige Formate ab und lässt das gespeicherte stehen", async () => {
    await expect(formats.saveNumberFormats(actor, { invoice: "RE-{NNN}", quote: "AN-{JJJJ}-{NNN}" })).rejects.toThrow(/Rechnungen: .*Jahr/);
    await expect(formats.saveNumberFormats(actor, { invoice: "{JJJJ}-{NNN}", quote: "AN/{JJJJ}/{NNN}" })).rejects.toThrow(/Angebote: /);
    const [company] = await sql`select invoice_number_format, quote_number_format from company`;
    expect(company).toEqual({ invoice_number_format: "{JJJJ}-{NNN}", quote_number_format: "AN-{JJJJ}-{NNN}" });
  });

  it("meldet nach einem Formatwechsel eine schon vergebene Nummer, ohne den Zähler zu verbrauchen", async () => {
    // Nr. 1 im alten Format ergibt 2026-12, Nr. 2 im neuen ebenfalls
    await formats.saveNumberFormats(actor, { invoice: "{JJJJ}-{N}2", quote: "AN-{JJJJ}-{NNN}" });
    expect(await finalizeNew()).toBe("2026-12");
    await formats.saveNumberFormats(actor, { invoice: "{JJJJ}-1{N}", quote: "AN-{JJJJ}-{NNN}" });
    const draft = await invoiceDraft();
    await expect(invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand)).rejects.toThrow(/2026-12 ist schon vergeben/);
    const [counter] = await sql`select last from invoice_number_counters where year = 2026`;
    expect(counter!.last).toBe(1);
    expect((await sql`select status from invoices where id = ${draft.id}`)[0]!.status).toBe("draft");
    // Mit einem passenden Format geht es mit Nr. 2 weiter
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{NNN}", quote: "AN-{JJJJ}-{NNN}" });
    expect((await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand)).number).toBe("RE-2026-002");
  });

  it("meldet auch bei Angeboten eine schon vergebene Nummer", async () => {
    await formats.saveNumberFormats(actor, { invoice: "{JJJJ}-{NNN}", quote: "A{JJJJ}-{N}2" });
    expect((await quotes.finalizeQuote(actor, (await quoteDraft()).id)).number).toBe("A2026-12");
    await formats.saveNumberFormats(actor, { invoice: "{JJJJ}-{NNN}", quote: "A{JJJJ}-1{N}" });
    await expect(quotes.finalizeQuote(actor, (await quoteDraft()).id)).rejects.toThrow(/A2026-12 ist schon vergeben/);
  });

  it("trägt die Kundennummer des Käufers mit {KUNDENNR} in die Nummer ein (#1426)", async () => {
    await formats.saveNumberFormats(actor, { invoice: "RE-{KUNDENNR}-{NNN}", quote: "AN-{KUNDENNR}-{NNN}", invoiceRunning: true, quoteRunning: true });
    const acme = (await createContact("ACME")).id;
    expect((await invoices.finalizeInvoice(actor, (await invoiceDraft(acme)).id, kleinunternehmerStand)).number).toBe("RE-ACME-001");
    expect((await quotes.finalizeQuote(actor, (await quoteDraft(acme)).id)).number).toBe("AN-ACME-001");
    // Der gemeinsame Zähler macht die Nummer eindeutig; {KUNDENNR} vergibt keinen eigenen Kreis
    expect((await invoices.finalizeInvoice(actor, (await invoiceDraft(contactId)).id, kleinunternehmerStand)).number).toBe("RE-10001-002");
  });

  it("meldet bei {KUNDENNR} eine fehlende Kundennummer und lässt den Zähler stehen (#1426)", async () => {
    await formats.saveNumberFormats(actor, { invoice: "RE-{KUNDENNR}-{NNN}", quote: "AN-{KUNDENNR}-{NNN}", invoiceRunning: true, quoteRunning: true });
    const ohne = (await createContact("")).id;
    const draft = await invoiceDraft(ohne);
    expect(await invoices.finalizeIssues(draft.id)).toEqual([expect.stringMatching(/braucht eine Kundennummer/)]);
    await expect(invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand)).rejects.toThrow(/braucht eine Kundennummer/);
    const quote = await quoteDraft(ohne);
    expect(await quotes.quoteIssues(quote.id)).toEqual([expect.stringMatching(/braucht eine Kundennummer/)]);
    await expect(quotes.finalizeQuote(actor, quote.id)).rejects.toThrow(/braucht eine Kundennummer/);
    expect(await sql`select last from invoice_number_counters`).toEqual([{ last: 0 }]);
    expect(await sql`select last from quote_number_counters`).toEqual([{ last: 0 }]);
    expect((await sql`select status from invoices where id = ${draft.id}`)[0]!.status).toBe("draft");
    expect((await sql`select status from quotes where id = ${quote.id}`)[0]!.status).toBe("draft");
  });

  it("hält Nummern über 36 Zeichen auf, weil DATEV das Belegfeld 1 kürzt (#1426)", async () => {
    // Der gemeldete Fall: eine 32-stellige Kundennummer ergibt mit {KUNDENNR} 45 Zeichen; zweimal dieselbe
    // Belegfeld-1-Nummer ließe offene Posten in DATEV zusammenfallen
    const lang = (await createContact("b7a4d3bb872a4f82ae936d0c15293612")).id;
    const original = await invoices.finalizeInvoice(actor, (await invoiceDraft(lang)).id, kleinunternehmerStand);
    expect(original.number).toBe("2026-001");
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{KUNDENNR}-{NNN}", quote: "AN-{JJJJ}-{NNN}" });
    const draft = await invoiceDraft(lang);
    await expect(invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand)).rejects.toThrow(/36 Zeichen.*DATEV/);
    // Auch das Storno darf keine Nummer erzeugen, die DATEV kürzt
    await expect(invoices.cancelInvoice(actor, original.id, "2026-03-05")).rejects.toThrow(/36 Zeichen.*DATEV/);
    const [counter] = await sql`select last from invoice_number_counters where year = 2026`;
    expect(counter!.last).toBe(1);
    expect((await sql`select status from invoices where id = ${draft.id}`)[0]!.status).toBe("draft");
    // Eine kürzere Kundennummer passt wieder unter 36 Zeichen
    await updateKundennummer(lang, "ACME");
    expect((await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand)).number).toBe("RE-2026-ACME-002");
  });

  it("hält Nummern auf, die im DATEV-Belegfeld 1 aussehen wie eine vergebene (#1426)", async () => {
    // Der Fall aus dem Review: „A1“ + Zähler 1 und „A“ + Zähler 11 stehen beide als „RE-2026-A11“ im
    // Belegfeld 1; DATEV könnte ihre offenen Posten verwechseln
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{KUNDENNR}_{N}", quote: "AN-{JJJJ}-{NNN}" });
    const a1 = (await createContact("A1")).id;
    expect((await invoices.finalizeInvoice(actor, (await invoiceDraft(a1)).id, kleinunternehmerStand)).number).toBe("RE-2026-A1_1");
    await invoices.setNextNumber(actor, "2026-03-02", 11);
    const a = (await createContact("A")).id;
    const draft = await invoiceDraft(a);
    await expect(invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand)).rejects.toThrow(/RE-2026-A_11.*RE-2026-A1_1/);
    const [counter] = await sql`select last from invoice_number_counters where year = 2026`;
    expect(counter!.last).toBe(10);
    expect((await sql`select status from invoices where id = ${draft.id}`)[0]!.status).toBe("draft");
    // Eine Nummer mit eigenem Belegfeld geht weiter durch
    const b = (await createContact("B")).id;
    expect((await invoices.finalizeInvoice(actor, (await invoiceDraft(b)).id, kleinunternehmerStand)).number).toBe("RE-2026-B_11");
  });

  it("fängt auch Kollisionen durch den Punkt ab, der im Belegfeld 1 zum Bindestrich wird (#1426)", async () => {
    await formats.saveNumberFormats(actor, { invoice: "RE-{JJJJ}-{KUNDENNR}_{N}", quote: "AN-{JJJJ}-{NNN}" });
    const strich = (await createContact("A-1")).id;
    expect((await invoices.finalizeInvoice(actor, (await invoiceDraft(strich)).id, kleinunternehmerStand)).number).toBe("RE-2026-A-1_1");
    // „A.“ + Zähler 11 ergibt „RE-2026-A._11“ — im Belegfeld 1 ebenfalls „RE-2026-A-11“
    await invoices.setNextNumber(actor, "2026-03-02", 11);
    const punkt = (await createContact("A.")).id;
    const draft = await invoiceDraft(punkt);
    await expect(invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand)).rejects.toThrow(/RE-2026-A\._11.*RE-2026-A-1_1/);
    const [counter] = await sql`select last from invoice_number_counters where year = 2026`;
    expect(counter!.last).toBe(10);
  });

  it("vergibt dem Storno die Kundennummer des Originals, auch wenn die des Kontakts inzwischen anders ist (#1426)", async () => {
    await formats.saveNumberFormats(actor, { invoice: "RE-{KUNDENNR}-{NNN}", quote: "AN-{JJJJ}-{NNN}", invoiceRunning: true });
    const acme = (await createContact("ACME")).id;
    const original = await invoices.finalizeInvoice(actor, (await invoiceDraft(acme)).id, kleinunternehmerStand);
    expect(original.number).toBe("RE-ACME-001");
    // Die Kundennummer im Beleg ist der Stand beim Festschreiben, nicht die des Kontakts von heute
    await contacts.updateContact(actor, acme, {
      kundennummer: "NEUE-9",
      name: "Zweitkunde GmbH",
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
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-03-05");
    expect(storno.number).toBe("RE-ACME-002");
  });

  it("endet die Meldung beim Festschreiben ohne Kundennummer nicht mit zwei Punkten (#1426)", async () => {
    await formats.saveNumberFormats(actor, { invoice: "RE-{KUNDENNR}-{NNN}", quote: "AN-{JJJJ}-{NNN}", invoiceRunning: true });
    const ohne = (await createContact("")).id;
    await expect(invoices.finalizeInvoice(actor, (await invoiceDraft(ohne)).id, kleinunternehmerStand)).rejects.toThrow(/enthält\.$/);
    await expect(invoices.finalizeInvoice(actor, (await invoiceDraft(ohne)).id, kleinunternehmerStand)).rejects.not.toThrow(/\.\.$/);
  });

  it("lässt eine vor {KUNDENNR} festgeschriebene Rechnung ohne Kundennummer stornieren, nachdem der Kunde eine bekommen hat (#1426)", async () => {
    const ohne = (await createContact("")).id;
    const original = await invoices.finalizeInvoice(actor, (await invoiceDraft(ohne)).id, kleinunternehmerStand);
    expect(original.number).toBe("2026-001");
    await formats.saveNumberFormats(actor, { invoice: "RE-{KUNDENNR}-{NNN}", quote: "AN-{JJJJ}-{NNN}", invoiceRunning: true });
    // Solange auch der Kontakt keine Kundennummer hat, bleibt das Storno gesperrt
    await expect(invoices.cancelInvoice(actor, original.id, "2026-03-05")).rejects.toThrow(/Kundennummer/);
    // Trägt die Person sie nach, wie die Meldung es verlangt, nummeriert das Storno mit der heutigen
    await updateKundennummer(ohne, "ACME");
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-03-05");
    expect(storno.number).toBe("RE-ACME-002");
    // Im Käufer-Snapshot des Stornos steht die Nummer, mit der nummeriert wurde; das Original bleibt unverändert
    const [stornoRow] = await sql`select buyer from invoices where id = ${storno.id}`;
    expect(stornoRow!.buyer.kundennummer).toBe("ACME");
    const [originalRow] = await sql`select buyer from invoices where id = ${original.id}`;
    expect(originalRow!.buyer.kundennummer ?? null).toBeNull();
  });

  it("lässt eine Rechnung stornieren, deren Kundennummer im Snapshot ungültig ist, sobald der Kontakt eine gültige hat (#1426)", async () => {
    const kunde = (await createContact("10/2024")).id;
    const original = await invoices.finalizeInvoice(actor, (await invoiceDraft(kunde)).id, kleinunternehmerStand);
    await formats.saveNumberFormats(actor, { invoice: "RE-{KUNDENNR}-{NNN}", quote: "AN-{JJJJ}-{NNN}", invoiceRunning: true });
    await updateKundennummer(kunde, "ACME");
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-03-05");
    expect(storno.number).toBe("RE-ACME-002");
    const [stornoRow] = await sql`select buyer from invoices where id = ${storno.id}`;
    expect(stornoRow!.buyer.kundennummer).toBe("ACME");
    // Der festgeschriebene Snapshot des Originals bleibt unverändert (GoBD)
    const [originalRow] = await sql`select buyer from invoices where id = ${original.id}`;
    expect(originalRow!.buyer.kundennummer).toBe("10/2024");
  });

  it("lässt eine Korrektur einer Rechnung ohne Kundennummer im Original mit der heutigen festschreiben (#1426)", async () => {
    const ohne = (await createContact("")).id;
    const original = await invoices.finalizeInvoice(actor, (await invoiceDraft(ohne)).id, kleinunternehmerStand);
    await formats.saveNumberFormats(actor, { invoice: "RE-{KUNDENNR}-{NNN}", quote: "AN-{JJJJ}-{NNN}", invoiceRunning: true });
    const korrektur = await invoices.createCorrection(actor, original.id, "2026-03-05");
    await expect(invoices.finalizeInvoice(actor, korrektur.id, kleinunternehmerStand)).rejects.toThrow(/Kundennummer/);
    await updateKundennummer(ohne, "ACME");
    const final = await invoices.finalizeInvoice(actor, korrektur.id, kleinunternehmerStand);
    expect(final.number).toBe("RE-ACME-002");
    const [row] = await sql`select buyer from invoices where id = ${korrektur.id}`;
    expect(row!.buyer.kundennummer).toBe("ACME");
  });
});
