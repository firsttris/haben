import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Anzahlung: Die Aufhebung ihrer Bankzuordnung wirkt am Tag der Aufhebung (#782). Der Vorauszahlungsplan liest die
 * Nebenbücher bewusst ohne Journal (advance-vat-plan.ts, „Gegenprobe“) und nahm für die Ereignisse bisher das
 * Buchungsdatum des Umsatzes. Eine im Juli erklärte Aufhebung einer März-Zahlung landete damit ebenfalls im März: Der
 * März verlor die Anzahlung, die er in der Voranmeldung trägt, und der Juli blieb unberührt.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

describe.skipIf(!testDatabaseUrl)("Anzahlung: Aufhebung wirkt am Tag der Aufhebung (#782)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  const actor = "anzahlung-aufhebung";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    bank = await import("../bank/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    contacts = await import("../stammdaten/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, document_settlements, document_cancellations, write_offs, allocations, bank_transactions,
      bank_imports, bank_accounts, cash_entries, company, invoices, invoice_number_counters, contacts, journal_lines, journal_entries cascade`;
    // journal_ab 2030: Beide Seiten kommen aus den Nebenbüchern, also aus dem Vorauszahlungsplan
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, bundesland, iban, kontenrahmen, versteuerung, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '0941 1', '198/113/10010',
              'BY', 'DE89370400440532013000', 'SKR03', 'soll', 2030)`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
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
      })
    ).id;
  });

  /** Anzahlungsrechnung über 300,00 € netto (357,00 € brutto, 19 %) */
  async function anzahlung(issueDate: string) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "abschlag",
      advanceType: "anzahlung",
      lines: [{ description: "Anzahlung vor Leistung", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  /** Zahlungseingang am `day` (TT.MM.JJ), der Rechnung zugeordnet; gibt die Zuordnung zurück */
  async function zahlen(invoiceId: string, day: string) {
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([[day, day, "Gebucht", "Testfirma", "Nordwerk Software GmbH", "Anzahlung", "Eingang", "DE02100100100006820101", "357,00", "", "", ""]]),
        filename: `bank-${day.replaceAll(".", "-")}.csv`,
      },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id as string, invoiceId, amount: 35_700 });
    const [allocation] = await sql`select id from allocations where reverses_id is null`;
    return { transactionId: tx!.id as string, allocationId: allocation!.id as string };
  }

  const kz81 = async (year: number, month: number) => (await vat.computeVatFigures({ year, month })).kz81;

  it("Aufhebung im Juli bucht im Juli; der März behält die Anzahlung", async () => {
    const invoice = await anzahlung("2026-03-05");
    const { allocationId } = await zahlen(invoice.id, "20.03.26");
    expect(await kz81(2026, 3)).toBe(30_000);

    await bank.reverseAllocation(actor, allocationId, "2026-07-10");

    expect(await kz81(2026, 3)).toBe(30_000);
    expect(await kz81(2026, 7)).toBe(-30_000);
  }, 30_000);

  it("Aufhebung im Folgejahr: die Gegenzeile steht im Januar, nicht im Dezember", async () => {
    const invoice = await anzahlung("2026-12-01");
    const { allocationId } = await zahlen(invoice.id, "20.12.26");
    expect(await kz81(2026, 12)).toBe(30_000);

    await bank.reverseAllocation(actor, allocationId, "2027-01-15");

    expect(await kz81(2026, 12)).toBe(30_000);
    expect(await kz81(2027, 1)).toBe(-30_000);
  }, 30_000);
});
