import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Steuerpfad der Verrechnung (#877, Etappe 4). Die Aufrechnung selbst ist umsatzsteuerlich neutral: Die Minderung hängt
 * an der Korrektur, nicht am Ausgleich. Was sie aber ändert, ist der Zahlungsstand — und daran hängt der Steueranteil
 * jeder weiteren Zahlung. Wer hier die Verrechnung übersieht, rechnet die Steuer der letzten Zahlung zu klein.
 */
describe.skipIf(!testDatabaseUrl)("Verrechnung und Steueranteile der Zahlungen (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let bank: typeof import("../bank/bank.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    verrechnung = await import("./verrechnung.ts");
    contacts = await import("../stammdaten/contacts.ts");
    bank = await import("../bank/bank.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Rechnung über 100,00 EUR netto plus 19 % = 119,00 EUR */
  async function rechnung(): Promise<string> {
    const draft = await invoices.createDraft(
      actor,
      {
        contactId,
        issueDate: "2026-09-01",
        serviceFrom: null,
        serviceTo: null,
        paymentTermDays: 14,
        format: "zugferd",
        note: "",
        lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
      },
      {},
    );
    return (await invoices.finalizeInvoice(actor, draft.id)).id;
  }

  /** Korrektur über 20,00 EUR netto plus 19 % = 23,80 EUR */
  async function korrektur(correctsId: string): Promise<string> {
    const draft = await invoices.createDraft(
      actor,
      {
        contactId,
        issueDate: "2026-10-05",
        serviceFrom: null,
        serviceTo: null,
        paymentTermDays: 14,
        format: "zugferd",
        note: "",
        lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: -2_000, taxRate: 1900 }],
      },
      { kind: "korrektur", correctsId },
    );
    return (await invoices.finalizeInvoice(actor, draft.id)).id;
  }

  /** Zahlungseingang über die Bank, wie aus dem Kontoauszug */
  async function zahle(invoiceId: string, betrag: number, datum: string): Promise<void> {
    const [konto] = await sql`insert into bank_accounts (name, iban, purpose) values ('Geschäftskonto', 'DE89370400440532013000', 'geschaeft')
      on conflict (iban) do update set name = excluded.name returning id`;
    const [import_] = await sql`
      insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${(konto as { id: string }).id}, 'umsatz.csv', ${"a".repeat(64)}, 'swan', 1, 0) returning id`;
    const [umsatz] = await sql`
      insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, dedup_hash)
      values (${(konto as { id: string }).id}, ${(import_ as { id: string }).id}, ${datum}, ${betrag}, 'Nordwerk Software GmbH', ${`h${datum}${betrag}`})
      returning id`;
    await bank.allocate(actor, { kind: "invoice", transactionId: (umsatz as { id: string }).id, invoiceId, amount: betrag });
  }

  /** Steueranteile, die an den Zahlungen der Rechnung gespeichert sind */
  async function steueranteile(invoiceId: string): Promise<number> {
    const rows = await sql<{ tax: string | null }[]>`
      select coalesce((s ->> 'tax')::numeric, 0)::text as tax
        from allocations a, jsonb_array_elements(coalesce(a.tax_shares, '[]'::jsonb)) s
       where a.invoice_id = ${invoiceId}`;
    return [...rows].reduce((sum, r) => sum + Number(r.tax), 0);
  }

  beforeEach(async () => {
    await leeren(sql)`truncate invoice_settlements, dunnings, journal_lines, journal_entries, allocations, write_offs,
      cash_entries, invoice_taxes, invoice_lines, invoices, invoice_number_counters, bank_transactions, bank_imports,
      bank_accounts, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 14)`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "rechnung@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  }, 60_000);

  it("Teilzahlung, Verrechnung, Restzahlung: die Steuer der Zahlungen ist die Steuer des vereinnahmten Entgelts", async () => {
    const rechnungId = await rechnung();
    const korrekturId = await korrektur(rechnungId);

    await zahle(rechnungId, 60_00, "2026-09-15");
    await verrechnung.settleInvoices(actor, {
      invoiceId: rechnungId,
      counterInvoiceId: korrekturId,
      amount: 23_80,
      date: "2026-10-10",
      note: "Verrechnung mit der Korrektur",
    });
    await zahle(rechnungId, 35_20, "2026-11-05");

    // Vereinnahmt sind 95,20 EUR in Geld: 60,00 EUR und 35,20 EUR. Die 23,80 EUR der Korrektur sind kein Zufluss,
    // Haben gibt die Forderung auf, statt sie zu kassieren. Die Steuer der Zahlungen ist deshalb 15,20 EUR und nicht
    // 19,00 EUR; die 3,80 EUR der Korrektur entstehen bei Ist-Versteuerung nie, bei Soll mindert die Korrektur sie in
    // ihrem eigenen Monat. Wer hier 19,00 erwartet, zählt Geld mit, das nie kommt.
    expect(await steueranteile(rechnungId)).toBe(15_20);
  }, 60_000);

  it("die Verrechnung selbst trägt keine Steuer", async () => {
    const rechnungId = await rechnung();
    const korrekturId = await korrektur(rechnungId);
    await verrechnung.settleInvoices(actor, {
      invoiceId: rechnungId,
      counterInvoiceId: korrekturId,
      amount: 23_80,
      date: "2026-10-10",
      note: "Verrechnung mit der Korrektur",
    });

    const rows = await sql<{ steuer: string }[]>`
      select count(*)::text as steuer
        from journal_entries je join journal_lines jl on jl.entry_id = je.id
       where je.source_type = 'verrechnung' and jl.tax_code is not null`;
    expect(Number([...rows][0]!.steuer)).toBe(0);
  }, 60_000);
});
