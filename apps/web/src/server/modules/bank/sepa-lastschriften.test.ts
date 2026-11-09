import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Lastschriftdatei pain.008 aus fälligen Rechnungen (Postgres, #445)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let mandates: typeof import("../stammdaten/sepa-mandate.ts");
  const actor = "test-user";
  const ACCOUNT_IBAN = "DE89370400440532013000";
  // Montag, 9. November 2026
  const now = new Date("2026-11-09T08:00:00Z");
  const today = "2026-11-09";
  let accountId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    mandates = await import("../stammdaten/sepa-mandate.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate sepa_direct_debit_items, sepa_direct_debits, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, invoice_lines, invoice_taxes, invoices, invoice_number_counters, sepa_mandate_files,
      sepa_mandate_revocations, sepa_mandates, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank, telefon, glaeubiger_id)
      values (1, 'Müller & Söhne IT', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              ${ACCOUNT_IBAN}, 'COBADEFFXXX', 'Commerzbank', '0941 123456', 'DE98ZZZ09999999999')`;
    accountId = (await bank.createAccount(actor, { name: "Geschäftskonto", iban: ACCOUNT_IBAN })).id;
  });

  async function customer(name: string, iban = "DE02120300000000202051") {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name,
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "rechnung@kunde.example",
      ustId: "",
      iban,
      leitwegId: "",
      defaultFormat: null,
    });
    return contact.id;
  }

  async function mandate(contactId: string, reference: string, overrides: Record<string, unknown> = {}) {
    return mandates.createMandate(
      actor,
      contactId,
      { reference, signedOn: "2026-10-01", scheme: "CORE", firstSequence: "FRST", debtorName: "Kunde", debtorIban: "DE02120300000000202051", ...overrides },
      today,
    );
  }

  async function invoice(contactId: string, mandateId: string | null, issueDate: string, net = 25_000) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Wartung", quantity: 1000, unit: "Monat", unitPrice: net, taxRate: 1900 }],
      ...(mandateId ? { paymentMethod: "lastschrift" as const, sepaMandateId: mandateId } : {}),
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  it("bietet fällige Lastschrift-Rechnungen an, mit Fälligkeit, Sequenz und Mandat; Überweisungen nicht", async () => {
    const nordwerk = await customer("Nordwerk Software GmbH");
    const m = await mandate(nordwerk, "KD-1042-01");
    const due = await invoice(nordwerk, m, "2026-11-02");
    await invoice(nordwerk, null, "2026-11-02");
    const [candidate, ...rest] = await bank.directDebitCandidates(today);
    expect(rest).toEqual([]);
    expect(candidate).toMatchObject({
      invoiceId: due.id,
      number: due.number,
      customerName: "Nordwerk Software GmbH",
      open: 29_750,
      dueDate: "2026-11-16",
      collectionDate: "2026-11-16",
      mandateReference: "KD-1042-01",
      sequence: "FRST",
      scheme: "CORE",
      problem: null,
    });
  });

  it("nicht früher als 14 Kalendertage vor Fälligkeit (SDD Core Rulebook v1.2, Kap. 4.3.4)", async () => {
    const nordwerk = await customer("Nordwerk Software GmbH");
    const m = await mandate(nordwerk, "KD-1042-01");
    // Rechnung vom 9.11., fällig 23.11.: in 14 Tagen, geht gerade noch
    await invoice(nordwerk, m, "2026-11-09");
    // Zahlungsziel 30 Tage: zu früh
    const draft = await invoices.createDraft(actor, {
      contactId: nordwerk,
      issueDate: "2026-11-09",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 30,
      format: "zugferd",
      note: "",
      lines: [{ description: "Jahreslizenz", quantity: 1000, unit: "Stk.", unitPrice: 50_000, taxRate: 1900 }],
      paymentMethod: "lastschrift",
      sepaMandateId: m,
    });
    await invoices.finalizeInvoice(actor, draft.id);
    const candidates = await bank.directDebitCandidates(today);
    expect(candidates.map((c) => c.dueDate)).toEqual(["2026-11-23", "2026-12-09"]);
    expect(candidates[1]!.problem).toBe("Erst ab 25.11.2026 einzureichen, 14 Tage vor Fälligkeit");
  });

  it("erzeugt die Datei mit je einem Sammler je Fälligkeit, Verfahren und Sequenz und hält jede Lastschrift fest", async () => {
    const nordwerk = await customer("Nordwerk Software GmbH");
    const alpenblick = await customer("Alpenblick Media AG");
    const neu = await mandate(nordwerk, "KD-1042-01");
    const alt = await mandate(alpenblick, "AB-2023-07", { signedOn: "2023-04-03", firstSequence: "RCUR", lastCollectionBefore: "2026-10-16" });
    const a = await invoice(nordwerk, neu, "2026-11-02");
    const b = await invoice(alpenblick, alt, "2026-11-02", 10_000);
    const file = await bank.createDirectDebitFile(actor, { bankAccountId: accountId, invoiceIds: [a.id, b.id] }, now);
    expect(file.filename).toMatch(/^HABEN-[0-9A-F]{16}\.xml$/);
    const { xml } = (await bank.directDebitFile(file.id))!;
    expect(xml).toContain("<NbOfTxs>2</NbOfTxs><CtrlSum>416.50</CtrlSum>");
    expect(xml).toContain("<SeqTp>FRST</SeqTp>");
    expect(xml).toContain("<SeqTp>RCUR</SeqTp>");
    expect(xml).toContain("<ReqdColltnDt>2026-11-16</ReqdColltnDt>");
    expect(xml).toContain("<Id>DE98ZZZ09999999999</Id>");
    expect(xml).toContain(`<Ustrd>Rechnung ${a.number}</Ustrd>`);
    const items = await sql`select invoice_id, sequence, amount, collection_date from sepa_direct_debit_items order by amount desc`;
    expect(items).toEqual([
      { invoice_id: a.id, sequence: "FRST", amount: 29_750, collection_date: "2026-11-16" },
      { invoice_id: b.id, sequence: "RCUR", amount: 11_900, collection_date: "2026-11-16" },
    ]);
    // Eingereicht: nicht noch einmal angeboten; die Rechnung bleibt offen, bis die Gutschrift zugeordnet ist
    expect(await bank.directDebitCandidates(today)).toEqual([]);
    // Der Einzug zählt für den Verfall des Mandats: 36 Monate ab dem 16.11.2026
    const [status] = await mandates.listMandates(nordwerk, today);
    expect(status!.status).toEqual({ art: "gueltig", bis: "2029-11-15" });
    // Die nächste Lastschrift auf dasselbe Mandat ist eine Folgelastschrift
    const c = await invoice(nordwerk, neu, "2026-11-09");
    const [next] = await bank.directDebitCandidates(today);
    expect(next).toMatchObject({ invoiceId: c.id, sequence: "RCUR" });
  });

  it("lehnt ab, was nicht eingezogen werden kann", async () => {
    const nordwerk = await customer("Nordwerk Software GmbH");
    const m = await mandate(nordwerk, "KD-1042-01");
    const a = await invoice(nordwerk, m, "2026-11-02");
    await mandates.revokeMandate(actor, m, { revokedOn: "2026-11-09", reason: "" });
    const [candidate] = await bank.directDebitCandidates(today);
    expect(candidate!.problem).toBe("Mandat KD-1042-01 ist am 16.11.2026 widerrufen");
    await expect(bank.createDirectDebitFile(actor, { bankAccountId: accountId, invoiceIds: [a.id] }, now)).rejects.toThrow(
      "Nordwerk Software GmbH: Mandat KD-1042-01 ist am 16.11.2026 widerrufen",
    );
    await sql`update company set glaeubiger_id = '' where id = 1`;
    await expect(bank.createDirectDebitFile(actor, { bankAccountId: accountId, invoiceIds: [a.id] }, now)).rejects.toThrow(
      "Die Gläubiger-ID fehlt in den Firmendaten.",
    );
  });

  it("reicht eine Rechnung bei zwei gleichzeitigen Aufrufen nur einmal ein", async () => {
    const nordwerk = await customer("Nordwerk Software GmbH");
    const a = await invoice(nordwerk, await mandate(nordwerk, "KD-1042-01"), "2026-11-02");
    const input = { bankAccountId: accountId, invoiceIds: [a.id] };
    const results = await Promise.allSettled([bank.createDirectDebitFile(actor, input, now), bank.createDirectDebitFile(actor, input, now)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rows = await sql`select 1 from sepa_direct_debit_items where invoice_id = ${a.id}`;
    expect(rows).toHaveLength(1);
  });

  it("die erste Lastschrift aus Haben auf ein neues Mandat ist FRST, auch wenn nur eine spätere Rechnung gewählt ist", async () => {
    const nordwerk = await customer("Nordwerk Software GmbH");
    const m = await mandate(nordwerk, "KD-1042-01");
    await invoice(nordwerk, m, "2026-11-02");
    const b = await invoice(nordwerk, m, "2026-11-03");
    const file = await bank.createDirectDebitFile(actor, { bankAccountId: accountId, invoiceIds: [b.id] }, now);
    const { xml } = (await bank.directDebitFile(file.id))!;
    expect(xml).toContain("<SeqTp>FRST</SeqTp>");
  });

  it("Datei und Lastschriften sind nur anhängbar", async () => {
    const nordwerk = await customer("Nordwerk Software GmbH");
    const a = await invoice(nordwerk, await mandate(nordwerk, "KD-1042-01"), "2026-11-02");
    const file = await bank.createDirectDebitFile(actor, { bankAccountId: accountId, invoiceIds: [a.id] }, now);
    await expect(sql`update sepa_direct_debits set xml = '' where id = ${file.id}`).rejects.toThrow();
    await expect(sql`delete from sepa_direct_debit_items`).rejects.toThrow();
  });
});
