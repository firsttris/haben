import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Zahlungsart Lastschrift an Rechnung und Vorlage (Postgres, #445)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./invoices.ts");
  let recurring: typeof import("./recurring.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let mandates: typeof import("../stammdaten/sepa-mandate.ts");
  const actor = "test-user";
  let contactId: string;
  let mandateId: string;

  const draft = (overrides: Record<string, unknown> = {}) =>
    invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-11-02",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "xrechnung-cii",
      note: "",
      lines: [{ description: "Wartung November", quantity: 1000, unit: "Monat", unitPrice: 25_000, taxRate: 1900 }],
      paymentMethod: "lastschrift",
      sepaMandateId: mandateId,
      ...overrides,
    });

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    recurring = await import("./recurring.ts");
    contacts = await import("../stammdaten/contacts.ts");
    mandates = await import("../stammdaten/sepa-mandate.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate journal_lines, journal_entries, invoice_lines, invoice_taxes, invoices, recurring_invoices,
      invoice_number_counters, sepa_mandate_files, sepa_mandate_revocations, sepa_mandates, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank, telefon, glaeubiger_id)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', '0941 123456', 'DE98ZZZ09999999999')`;
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
        iban: "DE02120300000000202051",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
    mandateId = await mandates.createMandate(
      actor,
      contactId,
      {
        reference: "KD-1042-01",
        signedOn: "2026-10-01",
        scheme: "CORE",
        firstSequence: "FRST",
        debtorName: "Nordwerk Software GmbH",
        debtorIban: "DE02120300000000202051",
      },
      "2026-11-02",
    );
  });

  it("schreibt die Vorabankündigung ins PDF und Zahlungsart 59 mit Mandat und Gläubiger-ID ins XML", async () => {
    const created = await draft();
    expect(created).toMatchObject({ paymentMethod: "lastschrift", sepaMandateId: mandateId });
    expect(await invoices.finalizeIssues(created.id)).toEqual([]);
    const final = await invoices.finalizeInvoice(actor, created.id);
    expect(final.xml).toMatch(/<ram:TypeCode>59<\/ram:TypeCode>/);
    expect(final.xml).toContain("<ram:DirectDebitMandateID>KD-1042-01</ram:DirectDebitMandateID>");
    expect(final.xml).toContain("<ram:CreditorReferenceID>DE98ZZZ09999999999</ram:CreditorReferenceID>");
    expect(final.xml).toMatch(/<ram:PayerPartyDebtorFinancialAccount>\s*<ram:IBANID>DE02120300000000202051<\/ram:IBANID>/);
    // Einzug am Fälligkeitstag: 02.11.2026 plus 14 Tage
    expect(final.dueDate).toBe("2026-11-16");
    expect(final.xml).toContain("ziehen wir am 16.11.2026 per SEPA-Lastschrift");
  });

  it("ohne Zahlungsart bleibt es die Überweisung wie bisher", async () => {
    const created = await draft({ paymentMethod: undefined, sepaMandateId: undefined });
    expect(created).toMatchObject({ paymentMethod: "ueberweisung", sepaMandateId: null });
    const final = await invoices.finalizeInvoice(actor, created.id);
    expect(final.xml).toMatch(/<ram:TypeCode>58<\/ram:TypeCode>/);
  });

  it("Lastschrift braucht ein Mandat, Überweisung keins", async () => {
    await expect(draft({ sepaMandateId: null })).rejects.toThrow("Für die Lastschrift fehlt das Mandat.");
    const ueberweisung = await draft({ paymentMethod: "ueberweisung", sepaMandateId: mandateId });
    expect(ueberweisung.sepaMandateId).toBeNull();
  });

  it("vor dem Festschreiben: Gläubiger-ID, Mandat des Kunden, gültig am Einzugstag, Euro, kein Skonto", async () => {
    const created = await draft();
    await sql`update company set glaeubiger_id = '' where id = 1`;
    expect(await invoices.finalizeIssues(created.id)).toContain("Firmendaten: Gläubiger-ID fehlt; sie gehört auf jede Rechnung mit Lastschrift");
    await sql`update company set glaeubiger_id = 'DE98ZZZ09999999999' where id = 1`;

    await mandates.revokeMandate(actor, mandateId, { revokedOn: "2026-11-10", reason: "" });
    expect(await invoices.finalizeIssues(created.id)).toContain("Mandat KD-1042-01 ist am Einzugstag 16.11.2026 widerrufen");

    const [{ id: other }] = (await sql`insert into contacts (name) values ('Rheinpixel GmbH') returning id`) as unknown as [{ id: string }];
    const fremd = await mandates.createMandate(
      actor,
      other,
      { reference: "RP-1", signedOn: "2026-10-01", scheme: "CORE", firstSequence: "FRST", debtorName: "Rheinpixel GmbH", debtorIban: "DE02120300000000202051" },
      "2026-11-02",
    );
    await expect(draft({ sepaMandateId: fremd })).rejects.toThrow("Das Mandat gehört zu einem anderen Kunden.");

    const skonto = await draft({ sepaMandateId: mandateId, skonto: [{ days: 7, percent: 200 }] });
    expect(await invoices.finalizeIssues(skonto.id)).toContain("Skonto und Lastschrift gehen nicht zusammen: eingezogen wird der volle Betrag");
  });

  it("ein Mandat, das vor dem Einzugstag abläuft, hält das Festschreiben auf", async () => {
    const alt = await mandates.createMandate(
      actor,
      contactId,
      {
        reference: "KD-ALT",
        signedOn: "2022-01-10",
        scheme: "CORE",
        firstSequence: "RCUR",
        lastCollectionBefore: "2023-11-14",
        debtorName: "Nordwerk Software GmbH",
        debtorIban: "DE02120300000000202051",
      },
      "2026-11-02",
    );
    // 36 Monate nach dem 14.11.2023: ab 14.11.2026 abgelaufen, der Einzug wäre am 16.11.2026
    const created = await draft({ sepaMandateId: alt });
    expect(await invoices.finalizeIssues(created.id)).toContain("Mandat KD-ALT ist am Einzugstag 16.11.2026 abgelaufen");
  });

  it("Storno einer Lastschrift-Rechnung wird nicht eingezogen", async () => {
    const final = await invoices.finalizeInvoice(actor, (await draft()).id);
    const storno = await invoices.cancelInvoice(actor, final.id, "2026-11-03");
    expect(storno).toMatchObject({ paymentMethod: "ueberweisung", sepaMandateId: null });
    expect(storno.xml).not.toMatch(/<ram:TypeCode>59<\/ram:TypeCode>/);
  });

  it("Vorlage: Lastschrift mit dem jüngsten gültigen Mandat des Kunden am Termin", async () => {
    const template = await recurring.createRecurring(actor, {
      name: "Wartung",
      active: true,
      contactId,
      format: "zugferd",
      paymentTermDays: 14,
      intro: "",
      note: "",
      taxTreatment: "regulaer",
      exemptionReason: "",
      priceMode: "netto",
      lines: [{ description: "Wartung {MONAT}", quantity: 1000, unit: "Monat", unitPrice: 25_000, taxRate: 1900 }],
      intervalMonths: 1,
      nextDate: "2026-11-02",
      endDate: null,
      servicePeriod: "laufend",
      mode: "festschreiben",
      sendByMail: false,
      paymentMethod: "lastschrift",
    });
    expect(template.paymentMethod).toBe("lastschrift");
    await recurring.runDueRecurring("2026-11-02");
    const [invoice] = await sql`select payment_method, sepa_mandate_id, status, xml from invoices where recurring_id = ${template.id}`;
    expect(invoice).toMatchObject({ payment_method: "lastschrift", sepa_mandate_id: mandateId, status: "final" });
    expect(invoice!.xml).toContain("KD-1042-01");
  });

  it("Vorlage ohne gültiges Mandat: keine Rechnung, sondern ein Fehler an der Vorlage", async () => {
    await mandates.revokeMandate(actor, mandateId, { revokedOn: "2026-11-01", reason: "" });
    const template = await recurring.createRecurring(actor, {
      name: "Wartung",
      active: true,
      contactId,
      format: "zugferd",
      paymentTermDays: 14,
      intro: "",
      note: "",
      taxTreatment: "regulaer",
      exemptionReason: "",
      priceMode: "netto",
      lines: [{ description: "Wartung", quantity: 1000, unit: "Monat", unitPrice: 25_000, taxRate: 1900 }],
      intervalMonths: 1,
      nextDate: "2026-11-02",
      endDate: null,
      servicePeriod: "laufend",
      mode: "festschreiben",
      sendByMail: false,
      paymentMethod: "lastschrift",
    });
    await recurring.runDueRecurring("2026-11-02");
    const rows = await sql`select id from invoices where recurring_id = ${template.id}`;
    expect(rows).toHaveLength(0);
    const [t] = await sql`select last_error from recurring_invoices where id = ${template.id}`;
    expect(t!.last_error).toBe("Kein gültiges Lastschriftmandat für Nordwerk Software GmbH am 16.11.2026");
  });

  it("Vorlage: nach einem neuen Mandat holt der nächste Lauf den verpassten Termin nach und bleibt nicht hängen", async () => {
    // Mandat widerrufen, der Lauf am 02.11. findet keins (Einzug wäre am 16.11.)
    await mandates.revokeMandate(actor, mandateId, { revokedOn: "2026-11-01", reason: "" });
    const template = await recurring.createRecurring(actor, {
      name: "Wartung",
      active: true,
      contactId,
      format: "zugferd",
      paymentTermDays: 14,
      intro: "",
      note: "",
      taxTreatment: "regulaer",
      exemptionReason: "",
      priceMode: "netto",
      lines: [{ description: "Wartung", quantity: 1000, unit: "Monat", unitPrice: 25_000, taxRate: 1900 }],
      intervalMonths: 1,
      nextDate: "2026-11-02",
      endDate: null,
      servicePeriod: "laufend",
      mode: "entwurf",
      sendByMail: false,
      paymentMethod: "lastschrift",
    });
    await recurring.runDueRecurring("2026-11-02");
    // Der Kunde unterschreibt am 20.11. ein neues Mandat; „der nächste Lauf holt den Termin nach, sobald ein Mandat da ist“
    // (docs/rechnungen.md, Lastschrift)
    const neu = await mandates.createMandate(
      actor,
      contactId,
      { reference: "KD-1042-02", signedOn: "2026-11-20", scheme: "CORE", firstSequence: "FRST", debtorName: "Nordwerk Software GmbH", debtorIban: "DE02120300000000202051" },
      "2026-11-21",
    );
    await recurring.runDueRecurring("2026-11-21");
    const rows = await sql`select sepa_mandate_id from invoices where recurring_id = ${template.id} and recurring_date = '2026-11-02'`;
    expect(rows).toEqual([{ sepa_mandate_id: neu }]);
    const [t] = await sql`select next_date::text from recurring_invoices where id = ${template.id}`;
    expect(t!.next_date).toBe("2026-12-02");
  });

  it("ein Einzug per Rechnung aus Haben zählt für den Verfall nach 36 Monaten", async () => {
    // Mandat vom 01.09.2023 ohne Einzug vor Haben; ohne Einzug wäre es ab 01.09.2026 abgelaufen
    const alt = await mandates.createMandate(
      actor,
      contactId,
      { reference: "KD-2023", signedOn: "2023-09-01", scheme: "CORE", firstSequence: "FRST", debtorName: "Nordwerk Software GmbH", debtorIban: "DE02120300000000202051" },
      "2026-11-02",
    );
    // Rechnung vom 02.06.2025 per Lastschrift, eingezogen am 16.06.2025: das Mandat gilt dann bis 15.06.2028
    const frueher = await draft({ issueDate: "2025-06-02", sepaMandateId: alt });
    expect(await invoices.finalizeIssues(frueher.id)).toEqual([]);
    await invoices.finalizeInvoice(actor, frueher.id);
    const jetzt = await draft({ sepaMandateId: alt });
    expect(await invoices.finalizeIssues(jetzt.id)).toEqual([]);
  });
});
