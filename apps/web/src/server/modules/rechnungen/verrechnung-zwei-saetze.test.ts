import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Befund 2 aus dem Review zu #919: Bei Ist-Versteuerung mit zwei Steuersätzen nimmt die Verrechnung den Anteil aus dem
 * falschen Satz. Rechnung 100,00 € zu 19 % und 100,00 € zu 7 %; die Korrektur nimmt die 19-%-Position zurück und wird mit
 * 119,00 € verrechnet, der Kunde zahlt die restlichen 107,00 €. Vereinnahmt ist damit nur der 7-%-Teil: Kz 81 bleibt bei
 * null, Kz 86 trägt 100,00 € Bemessungsgrundlage und 7,00 € Steuer.
 */
describe.skipIf(!testDatabaseUrl)("Verrechnung mit zwei Steuersätzen, Ist (Postgres)", () => {
  let invoices: typeof import("./index.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let bank: typeof import("../bank/index.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    verrechnung = await import("./verrechnung.ts");
    contacts = await import("../stammdaten/contacts.ts");
    bank = await import("../bank/index.ts");
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
    return (await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand)).id;
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

  it("Ist: die Verrechnung nimmt den Satz der Korrektur weg, die Zahlung trägt den Rest", async () => {
    const rechnung = await beleg(
      "rechnung",
      [
        { netto: 10_000, satz: 1900 },
        { netto: 10_000, satz: 700 },
      ],
      "2026-11-01",
    );
    const korrektur = await beleg("korrektur", [{ netto: -10_000, satz: 1900 }], "2026-11-10", rechnung);
    await verrechnung.settleInvoices(actor, {
      invoiceId: rechnung,
      counterInvoiceId: korrektur,
      amount: 11_900,
      date: "2026-11-12",
      note: "Position zu 19 % zurückgenommen",
    });
    await zahle(rechnung, 10_700, "2026-11-13");

    const nov = await figures.computeVatFigures({ year: 2026, month: 11 });
    expect({ kz81: nov.kz81, tax81: nov.tax81, kz86: nov.kz86, tax86: nov.tax86 }).toEqual({
      kz81: 0,
      tax81: 0,
      kz86: 10_000,
      tax86: 700,
    });
  }, 60_000);
});
