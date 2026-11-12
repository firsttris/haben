import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

type Scenario = "skonto" | "aufteilung";
type Profile = { kr: "SKR03" | "SKR04"; taxation: "ist" | "soll"; legalForm: "einzelunternehmen" | "gmbh" };

describe.skipIf(!testDatabaseUrl)("Gemeinsamer Belegstorno entspricht der manuellen Bankrücknahme (Postgres)", () => {
  let sql: postgres.Sql;
  let documents: typeof import("./documents.ts");
  let cancellation: typeof import("./cancellation.ts");
  let bank: typeof import("../bank/index.ts");
  let vat: typeof import("../umsatzsteuer/vat-figures.ts");
  let sequence = 0;
  const actor = "review-parity";

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    cancellation = await import("./cancellation.ts");
    bank = await import("../bank/index.ts");
    vat = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(profile: Profile) {
    await leeren(sql)`truncate document_cancellations, vat_returns, annual_submissions, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts,
      documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts,
      year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, kontenrahmen, versteuerung, rechtsform, journal_ab)
      values (1, 'Prüfbetrieb', 'Teststraße 1', '93047', 'Regensburg', 'test@example.com', '+49 941 1', '198/113/10010',
        'DE123456789', 'BY', 'DE89370400440532013000', ${profile.kr}, ${profile.taxation}, ${profile.legalForm}, 2026)`;
  }

  async function receipt() {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, ++sequence, 37]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `parity-${sequence}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Musterlieferant GmbH",
      supplierUstId: "",
      invoiceNumber: "TEST-1",
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function invoice() {
    const contacts = await import("../stammdaten/contacts.ts");
    const invoices = await import("../rechnungen/invoices.ts");
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Testkunde GmbH",
      strasse: "Teststraße 2",
      plz: "93047",
      ort: "Regensburg",
      land: "DE",
      email: "kunde@example.com",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate: "2026-09-05",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Testleistung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    return (await invoices.finalizeInvoice(actor, draft.id)).id;
  }

  async function transaction(scenario: Scenario) {
    const amount = scenario === "skonto" ? "-116,62" : "1.071,00";
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"20.09.26";"20.09.26";"Gebucht";"Prüfbetrieb";"Musterlieferant GmbH";"Testzahlung";"Ausgang";"DE02100100100006820101";"${amount}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: "parity.csv" }, null);
    return (await sql`select id from bank_transactions`)[0]!.id as string;
  }

  async function snapshot(documentId: string, transactionId: string) {
    return {
      cancellationDate: (await cancellation.documentCancellation(documentId)).cancellation?.date,
      openBank: (await bank.transactionDetail(transactionId))!.transaction.open,
      allocations: await sql`select kind, amount, reverses_id is not null as reversed, split_id is not null as split
        from allocations order by kind, amount`,
      writeOffs: await sql`select kind, date, amount, reverses_id is not null as reversed from write_offs order by kind, amount`,
      journal: await sql`select e.date, e.source_type, l.account, l.tax_code, sum(l.debit)::int as debit,
        sum(l.credit)::int as credit, coalesce(sum(l.basis), 0)::int as basis
        from journal_entries e join journal_lines l on l.entry_id = e.id
        group by e.date, e.source_type, l.account, l.tax_code order by e.date, e.source_type, l.account, l.tax_code`,
    };
  }

  async function execute(profile: Profile, scenario: Scenario, mode: "gemeinsam" | "manuell") {
    await reset(profile);
    const documentId = await receipt();
    const transactionId = await transaction(scenario);
    if (scenario === "skonto") {
      await bank.allocateWithRest(actor, { transactionId, target: { kind: "document", documentId }, rest: "skontoErhalten" });
    } else {
      await bank.allocateSplit(actor, {
        transactionId,
        parts: [
          { kind: "invoice", invoiceId: await invoice(), amount: 119_000 },
          { kind: "document", documentId, amount: -11_900 },
        ],
      });
    }
    const before = await vat.computeVatFigures({ year: 2026, month: 9 });
    await sql`insert into vat_returns (year, month, status, source, kz66, kz81, sent_at, locked_at)
      values (2026, 9, 'sent', 'manuell', ${before.kz66}, ${before.kz81}, now(), now())`;
    const sent = await sql`select * from vat_returns`;
    const originalDocument = await sql`select * from documents where id = ${documentId}`;
    const originalBank = await sql`select * from bank_transactions where id = ${transactionId}`;
    const allocationIds = (await bank.documentBankAllocations(documentId)).map((a) => a.id);
    if (mode === "manuell") {
      await bank.reverseAllocation(actor, allocationIds[0]!);
      await cancellation.cancelDocument(actor, documentId, {}, "2026-10-05");
    } else {
      await cancellation.cancelDocument(actor, documentId, { allocationIds }, "2026-10-05");
    }
    // Gespeicherte Anmeldung und Originale bleiben unverändert. Neu berechnete Zahlen sind davon zu unterscheiden.
    expect(await sql`select * from vat_returns`).toEqual(sent);
    expect(await sql`select * from documents where id = ${documentId}`).toEqual(originalDocument);
    expect(await sql`select * from bank_transactions where id = ${transactionId}`).toEqual(originalBank);
    const september = await vat.computeVatFigures({ year: 2026, month: 9 });
    const october = await vat.computeVatFigures({ year: 2026, month: 10 });
    expect(before.kz66).toBe(scenario === "skonto" ? 1_862 : 1_900);
    expect(september.kz66).toBe(1_900);
    expect(october.kz66).toBe(-1_900);
    expect(before.tax81).toBe(scenario === "aufteilung" ? 19_000 : 0);
    expect(september.tax81).toBe(scenario === "aufteilung" && profile.taxation === "soll" ? 19_000 : 0);
    expect(october.tax81).toBe(0);
    const abgleich = await import("../auswertungen/abgleich.ts");
    for (const month of [9, 10]) expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month })).zeilen)).toEqual([]);
    return snapshot(documentId, transactionId);
  }

  for (const kr of ["SKR03", "SKR04"] as const)
    for (const taxation of ["ist", "soll"] as const)
      for (const legalForm of ["einzelunternehmen", "gmbh"] as const)
        for (const scenario of ["skonto", "aufteilung"] as const)
          it(`${scenario}: identische Rücknahme trotz gemeldeten Zeitraums (${kr}, ${taxation}, ${legalForm})`, async () => {
            const profile = { kr, taxation, legalForm };
            const manual = await execute(profile, scenario, "manuell");
            const combined = await execute(profile, scenario, "gemeinsam");
            expect(combined).toEqual(manual);
            expect(combined.cancellationDate).toBe("2026-10-05");
          });
});
