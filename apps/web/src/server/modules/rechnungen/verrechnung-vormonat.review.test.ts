import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Review zu #919: Ist mit zwei Steuersätzen, ein Teil ist schon vor der Korrektur bezahlt. Rechnung 100,00 € zu 19 % und
 * 100,00 € zu 7 %, im Oktober 50,00 € bezahlt (anteilig auf beide Sätze gebucht und gemeldet), im November die Korrektur
 * über die 19-%-Position, mit 119,00 € verrechnet, dann die restlichen 57,00 €. Ein schon gemeldeter Monat darf sich durch
 * die spätere Verrechnung nicht ändern (§ 17 Abs. 1 Satz 8 UStG: berichtigt wird im Zeitraum der Änderung), und Journal und
 * Nebenbücher müssen in jedem Monat dasselbe zeigen.
 */
describe.skipIf(!testDatabaseUrl)("Verrechnung nach einer Teilzahlung im Vormonat, zwei Steuersätze, Ist (Postgres)", () => {
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
    const [konto] = await sql`
      insert into bank_accounts (name, iban, purpose) values ('Geschäftskonto', 'DE89370400440532013000', 'geschaeft')
      on conflict (iban) do update set name = excluded.name returning id`;
    const [import_] = await sql`
      insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${(konto as { id: string }).id}, 'umsatz.csv', ${datum.replaceAll("-", "").padEnd(64, "a")}, 'swan', 1, 0) returning id`;
    const [umsatz] = await sql`
      insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, dedup_hash)
      values (${(konto as { id: string }).id}, ${(import_ as { id: string }).id}, ${datum}, ${betrag}, 'Nordwerk Software GmbH', ${`h${datum}${betrag}`})
      returning id`;
    await bank.allocate(actor, { kind: "invoice", transactionId: (umsatz as { id: string }).id, invoiceId, amount: betrag });
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

  it("Ist: ein schon gemeldeter Vormonat bleibt, Journal und Nebenbücher stimmen in jedem Monat überein", async () => {
    const rechnung = await beleg(
      "rechnung",
      [
        { netto: 10_000, satz: 1900 },
        { netto: 10_000, satz: 700 },
      ],
      "2026-10-01",
    );
    await zahle(rechnung, 5_000, "2026-10-05");
    const okt = { year: 2026, month: 10 } as const;
    const nov = { year: 2026, month: 11 } as const;
    const kennzahlen = (f: Awaited<ReturnType<typeof figures.computeVatFigures>>) => ({ kz81: f.kz81, tax81: f.tax81, kz86: f.kz86, tax86: f.tax86 });
    const oktoberVorher = kennzahlen(await figures.computeVatFigures(okt));

    const korrektur = await beleg("korrektur", [{ netto: -10_000, satz: 1900 }], "2026-11-10", rechnung);
    await verrechnung.settleInvoices(actor, {
      invoiceId: rechnung,
      counterInvoiceId: korrektur,
      amount: 11_900,
      date: "2026-11-12",
      note: "Position zu 19 % zurückgenommen",
    });
    await zahle(rechnung, 5_700, "2026-11-13");

    expect(kennzahlen(await figures.computeVatFigures(okt))).toEqual(oktoberVorher);
    const summe = { kz81: 0, tax81: 0, kz86: 0, tax86: 0 };
    for (const periode of [okt, nov]) {
      const beide = await figures.kennzahlenBeiderQuellen(periode);
      const journal = { kz81: beide.journal.kz81, tax81: beide.journal.tax81, kz86: beide.journal.kz86, tax86: beide.journal.tax86 };
      expect({ monat: periode.month, ...journal }).toEqual({
        monat: periode.month,
        kz81: beide.nebenbuecher.kz81,
        tax81: beide.nebenbuecher.tax81,
        kz86: beide.nebenbuecher.kz86,
        tax86: beide.nebenbuecher.tax86,
      });
      for (const feld of Object.keys(summe) as (keyof typeof summe)[]) summe[feld] += journal[feld];
    }
    // Vereinnahmt sind am Ende 107,00 € für die 7-%-Position; der 19-%-Anteil aus dem Oktober wird im November berichtigt
    expect(summe).toEqual({ kz81: 0, tax81: 0, kz86: 10_000, tax86: 700 });
  }, 60_000);
});
