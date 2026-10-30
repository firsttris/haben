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

/**
 * Ist-Versteuerung: Die Umsatzsteuer einer Rechnung wird mit den Zahlungen fällig. Jede Rate rundet ihren Steueranteil;
 * ist die Rechnung erledigt, muss trotzdem genau ihre Steuer angemeldet, gebucht und in der EÜR vereinnahmt sein.
 */
describe.skipIf(!testDatabaseUrl)("Teilzahlungen bei Ist-Versteuerung (Postgres)", () => {
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("./vat-figures.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    reports = await import("../auswertungen/reports.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate vat_return_submissions, vat_returns, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
  });

  /** 100,00 € + 19,00 € = 119,00 € */
  async function invoice() {
    const contact = await contacts.createContact(actor, {
      kundennummer: "", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
      email: "a@b.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id, issueDate: "2026-09-20", serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd", note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function pay(invoiceId: string, rows: [date: string, purpose: string, amount: string][]) {
    await bank.importStatement(actor, { bytes: dkbCsv(rows.map(([d, p, a]) => incoming(d, p, a))), filename: `${rows[0]![1]}.csv` }, null);
    const ids: string[] = [];
    for (const [, purpose] of rows) {
      const [tx] = await sql`select id, amount from bank_transactions where purpose = ${purpose}`;
      await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId, amount: Number(tx!.amount) });
      const [allocation] = await sql`select id from allocations where transaction_id = ${tx!.id} and reverses_id is null`;
      ids.push(allocation!.id);
    }
    return ids;
  }

  /** Saldo „Umsatzsteuer nicht fällig 19 %“ (SKR03 1766): nach voller Zahlung 0 */
  async function notYetDue() {
    const [row] = await sql`select coalesce(sum(credit - debit), 0)::int as saldo from journal_lines where account = '1766'`;
    return row!.saldo;
  }

  it("voll bezahlt in drei Raten: angemeldet, gebucht und vereinnahmt wird genau die Steuer der Rechnung", async () => {
    const inv = await invoice();
    // 39,67 + 39,67 + 39,66 = 119,00; einzeln gerundet ergäben die Raten 6,33 + 6,33 + 6,33 = 18,99 €
    await pay(inv.id, [["01.10.26", "Rate 1", "39,67"], ["02.10.26", "Rate 2", "39,67"], ["03.10.26", "Rate 3", "39,66"]]);
    const oct = await figures.computeVatFigures({ year: 2026, month: 10 });
    expect({ kz81: oct.kz81, tax81: oct.tax81 }).toEqual({ kz81: 10_000, tax81: 1_900 });
    expect(await notYetDue()).toBe(0);
    const euer = await reports.euerForYear(2026);
    expect(euer.einnahmen.find((l) => l.key === "vereinnahmteUst")?.amount).toBe(1_900);
  }, 60_000);

  it("eine Rate aufgehoben und neu zugeordnet: weiter genau die Steuer der Rechnung", async () => {
    const inv = await invoice();
    const [, second] = await pay(inv.id, [["01.10.26", "Rate A", "39,67"], ["02.10.26", "Rate B", "39,67"]]);
    await bank.reverseAllocation(actor, second!);
    await pay(inv.id, [["03.10.26", "Rate C", "39,66"], ["04.10.26", "Rate D", "39,67"]]);
    const oct = await figures.computeVatFigures({ year: 2026, month: 10 });
    expect({ kz81: oct.kz81, tax81: oct.tax81 }).toEqual({ kz81: 10_000, tax81: 1_900 });
    expect(await notYetDue()).toBe(0);
  }, 60_000);

  it("zwei Raten und Skonto als Rest: auf „nicht fällig“ bleibt nichts stehen", async () => {
    const inv = await invoice();
    await pay(inv.id, [["01.10.26", "Rate X", "39,67"], ["02.10.26", "Rate Y", "39,67"]]);
    await bank.writeOff(actor, { kind: "skonto", invoiceId: inv.id, date: "2026-10-05" });
    expect(await notYetDue()).toBe(0);
  }, 60_000);
});
