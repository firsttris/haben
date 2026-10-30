import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n") + "\n");
}
const incoming = (date: string, purpose: string, amount: string) =>
  [date, date, "Gebucht", "Nordwerk", "Testfirma", purpose, "Eingang", "DE02100100100006820101", amount, "", "", ""];

describe.skipIf(!testDatabaseUrl)("TDD: gespeicherte Steueranteile, Journal = Voranmeldung (Postgres)", () => {
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("./vat-figures.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
  }, 30_000);
  afterAll(async () => { await sql?.end(); });

  beforeEach(async () => {
    await sql`truncate vat_return_submissions, vat_returns, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
  });

  async function invoice(lines: { unitPrice: number; taxRate: 1900 | 700 | 0 }[]) {
    const contact = await contacts.createContact(actor, {
      kundennummer: "", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
      email: "a@b.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id, issueDate: "2026-09-20", serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd", note: "",
      lines: lines.map((l, i) => ({ description: `Leistung ${i}`, quantity: 1000, unit: "Psch." as const, unitPrice: l.unitPrice, taxRate: l.taxRate })),
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function pay(invoiceId: string, rows: [date: string, purpose: string, amount: string][]) {
    await bank.importStatement(actor, { bytes: dkbCsv(rows.map(([d, p, a]) => incoming(d, p, a))), filename: `${rows[0]![1]}.csv` }, null);
    for (const [, purpose] of rows) {
      const [tx] = await sql`select id, amount from bank_transactions where purpose = ${purpose}`;
      await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId, amount: Number(tx!.amount) });
    }
  }

  async function journalTax(account: string) {
    const [row] = await sql`select coalesce(sum(credit - debit), 0)::int as saldo from journal_lines where account = ${account}`;
    return row!.saldo;
  }

  it("gemischte Sätze 19/7/0 %, drei gleiche Raten: Kz 86 der Voranmeldung = Journal (SKR03 1771)", async () => {
    // 150 € zu 19 %, 40 € zu 7 %, 130 € zu 0 % = 351,30 €; drei Raten zu 117,10 €
    const inv = await invoice([{ unitPrice: 15_000, taxRate: 1900 }, { unitPrice: 4_000, taxRate: 700 }, { unitPrice: 13_000, taxRate: 0 }]);
    await pay(inv.id, [["01.10.26", "Rate 1", "117,10"], ["02.10.26", "Rate 2", "117,10"], ["03.10.26", "Rate 3", "117,10"]]);
    const oct = await figures.computeVatFigures({ year: 2026, month: 10 });
    expect({ journal86: await journalTax("1771"), journal81: await journalTax("1776") }).toEqual({ journal86: 280, journal81: 2_850 });
    expect({ tax81: oct.tax81, tax86: oct.tax86 }).toEqual({ tax81: 2_850, tax86: 280 });
    expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month: 10 })).zeilen)).toEqual([]);
  }, 60_000);

  it("ältere Raten ohne gespeicherten Anteil, letzte Rate neu: Voranmeldung = Journal", async () => {
    // 300 € + 57 € = 357 €; acht ältere Raten zu 39,67 € (vor der Migration, ohne tax_shares), Rest 39,64 €
    const inv = await invoice([{ unitPrice: 30_000, taxRate: 1900 }]);
    const legacy: [string, string, string][] = Array.from({ length: 8 }, (_, i) => [`0${i + 1}.10.26`, `Alt ${i + 1}`, "39,67"]);
    await pay(inv.id, legacy);
    await sql`alter table allocations disable trigger user`;
    await sql`update allocations set tax_shares = null`;
    await sql`alter table allocations enable trigger user`;
    await pay(inv.id, [["20.10.26", "Neu", "39,64"]]);
    const oct = await figures.computeVatFigures({ year: 2026, month: 10 });
    // Gespeichert und gebucht wurde für die neue Rate 57,00 − 8 × 6,33 = 6,36 € (Journal mit echten Altzeilen: 50,64 + 6,36 = 57,00 €)
    const [neu] = await sql`select a.tax_shares from allocations a join bank_transactions t on t.id = a.transaction_id where t.purpose = 'Neu'`;
    expect(neu!.tax_shares).toEqual([{ rate: 1900, base: 3_328, tax: 636 }]);
    expect(oct.tax81).toBe(5_700);
  }, 60_000);
});
