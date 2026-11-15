import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Review zu #919 (Verrechnung von Ausgangsrechnung und Kundenkorrektur, #877): Storno nach einer Verrechnung, Ist- und
 * Soll-Versteuerung, SKR03 und SKR04.
 */
describe.skipIf(!testDatabaseUrl)("Verrechnung von Rechnung und Korrektur, Review (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let bank: typeof import("../bank/bank.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    verrechnung = await import("./verrechnung.ts");
    contacts = await import("../stammdaten/contacts.ts");
    bank = await import("../bank/bank.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  type Zeile = { netto: number; satz: 0 | 700 | 1900 };

  async function beleg(art: "rechnung" | "korrektur", zeilen: Zeile[], issueDate: string, correctsFor?: string): Promise<string> {
    const draft = await invoices.createDraft(
      actor,
      {
        contactId,
        issueDate,
        serviceFrom: null,
        serviceTo: null,
        paymentTermDays: 14,
        format: "zugferd",
        note: "",
        lines: zeilen.map((z) => ({ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: z.netto, taxRate: z.satz })),
      },
      art === "korrektur" ? { kind: "korrektur", correctsId: correctsFor! } : {},
    );
    return (await invoices.finalizeInvoice(actor, draft.id)).id;
  }

  async function zahle(invoiceId: string, betrag: number, datum: string): Promise<void> {
    const [konto] = await sql`insert into bank_accounts (name, iban, purpose) values ('Geschäftskonto', 'DE89370400440532013000', 'geschaeft') returning id`;
    const [import_] = await sql`
      insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${(konto as { id: string }).id}, 'umsatz.csv', ${"a".repeat(64)}, 'swan', 1, 0) returning id`;
    const [umsatz] = await sql`
      insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, dedup_hash)
      values (${(konto as { id: string }).id}, ${(import_ as { id: string }).id}, ${datum}, ${betrag}, 'Nordwerk Software GmbH', ${`h${datum}${betrag}`})
      returning id`;
    await bank.allocate(actor, { kind: "invoice", transactionId: (umsatz as { id: string }).id, invoiceId, amount: betrag });
  }

  async function firma(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04") {
    await sql`update company set versteuerung = ${versteuerung}, kontenrahmen = ${kontenrahmen} where id = 1`;
  }

  beforeEach(async () => {
    await leeren(sql)`truncate invoice_settlements, dunnings, journal_lines, journal_entries, allocations, write_offs,
      cash_entries, invoice_taxes, invoice_lines, invoices, invoice_number_counters, bank_transactions, bank_imports,
      bank_accounts, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'soll', 'SKR03', 14)`;
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

  it("Storno nach einer Verrechnung lässt keinen offenen Posten aus der Verrechnung zurück", async () => {
    const rechnung = await beleg("rechnung", [{ netto: 13_361, satz: 1900 }], "2026-11-01");
    const korrektur = await beleg("korrektur", [{ netto: -1_471, satz: 1900 }], "2026-11-10", rechnung);
    await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: korrektur, amount: 1_750, date: "2026-11-12", note: "Gutschrift" });
    // Wie bei einer Ausbuchung: erst die Verrechnung aufheben, dann stornieren. Kein Geld ist geflossen; nach dem Storno
    // darf weder eine Erstattung an den Kunden noch eine Forderung aus der Korrektur offen stehen.
    await expect(invoices.cancelInvoice(actor, rechnung, "2026-11-13")).rejects.toThrow(/Verrechnung/);
    // Nach der Aufhebung geht das Storno, und nichts bleibt offen
    const [zeile] = await verrechnung.listInvoiceSettlements(rechnung);
    await verrechnung.reverseInvoiceSettlement(actor, zeile!.id, "2026-11-13");
    await invoices.cancelInvoice(actor, rechnung, "2026-11-13");
    const offen = (await invoices.listInvoices("2026-11-14")).filter((r) => r.open !== 0).map((r) => ({ kind: r.kind, open: r.open }));
    expect(offen).toEqual([]);
  }, 60_000);

  for (const kontenrahmen of ["SKR03", "SKR04"] as const)
    for (const versteuerung of ["ist", "soll"] as const)
      it(`${kontenrahmen}, ${versteuerung}: Verrechnung bucht Forderungen gegen Verrechnungskonto ohne Steuer, Kz 81 Journal = Nebenbuch`, async () => {
        await firma(versteuerung, kontenrahmen);
        const rechnung = await beleg("rechnung", [{ netto: 13_361, satz: 1900 }], "2026-11-01");
        const korrektur = await beleg("korrektur", [{ netto: -1_471, satz: 1900 }], "2026-11-10", rechnung);
        await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: korrektur, amount: 1_750, date: "2026-11-12", note: "Gutschrift" });
        await zahle(rechnung, 14_150, "2026-11-13");
        const konten = kontenrahmen === "SKR03" ? { forderungen: "1400", verrechnung: "1590" } : { forderungen: "1200", verrechnung: "1370" };
        const zeilen = await sql<{ account: string; saldo: number }[]>`
          select jl.account, (sum(jl.debit) - sum(jl.credit))::int as saldo, count(*) filter (where jl.tax_code is not null)::int as steuer
            from journal_entries je join journal_lines jl on jl.entry_id = je.id where je.source_type = 'verrechnung' group by 1 order by 1`;
        expect([...zeilen].map((z) => z.account).sort()).toEqual([konten.forderungen, konten.verrechnung].sort());
        expect([...zeilen].every((z) => z.saldo === 0 && (z as unknown as { steuer: number }).steuer === 0)).toBe(true);
        const [forderung] = await sql`select coalesce(sum(debit - credit), 0)::int as saldo from journal_lines where account = ${konten.forderungen}`;
        expect(forderung!.saldo).toBe(0);
        const beide = await figures.kennzahlenBeiderQuellen({ year: 2026, month: 11 });
        expect(beide.journal.kz81).toBe(beide.nebenbuecher.kz81);
        // Soll: 133,61 − 14,71 = 118,90 im November; Ist: vereinnahmt 141,50 € brutto, davon 22,60 € Steuer
        const nov = await figures.computeVatFigures({ year: 2026, month: 11 });
        expect({ kz81: nov.kz81, tax81: nov.tax81 }).toEqual({ kz81: 11_890, tax81: 2_260 });
      }, 60_000);
});
