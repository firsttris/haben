import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

const IBAN = "DE12120300001234567890";

function dkbCsv(rows: string[][], balance = "23.418,72 €", date = "01.10.2026") {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom ${date}:";"${balance}"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
  return new TextEncoder().encode("﻿" + header + columns + body + "\n");
}

const incoming = (date: string, from: string, iban: string, purpose: string, amount: string) =>
  [date, date, "Gebucht", from, "Tristan Teufel", purpose, "Eingang", iban, amount, "", "", ""];
const outgoing = (date: string, to: string, iban: string, purpose: string, amount: string) =>
  [date, date, "Gebucht", "Tristan Teufel", to, purpose, "Ausgang", iban, amount, "", "", ""];

describe.skipIf(!testDatabaseUrl)("Bankabgleich (Postgres)", () => {
  let bank: typeof import("./bank.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("./contacts.ts");
  let documents: typeof import("./documents.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./bank.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("./contacts.ts");
    documents = await import("./documents.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
  });

  async function finalInvoice(net: number) {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@nordwerk.example",
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
      lines: [{ description: "Leistungen August", quantity: 1000, unit: "Psch.", unitPrice: net, taxRate: 1900 }],
    });
    return { invoice: await invoices.finalizeInvoice(actor, draft.id), contact };
  }

  it("legt das Konto aus der IBAN an, überspringt Dubletten und erkennt Lücken", async () => {
    const first = await bank.importStatement(
      actor,
      { bytes: dkbCsv([incoming("01.10.26", "Nordwerk Software GmbH", "DE89370400440532013000", "RE 2026-001", "4.760,00")], "4.760,00 €"), filename: "a.csv" },
      null,
    );
    expect(first).toMatchObject({ added: 1, skipped: 0, gap: null });
    const [account] = await sql`select iban from bank_accounts`;
    expect(account?.iban).toBe(IBAN);

    const again = await bank.importStatement(
      actor,
      {
        bytes: dkbCsv(
          [
            incoming("02.10.26", "Kunde B", "DE02100100100006820101", "Abschlag", "100,00"),
            incoming("01.10.26", "Nordwerk Software GmbH", "DE89370400440532013000", "RE 2026-001", "4.760,00"),
          ],
          "4.860,00 €",
          "02.10.2026",
        ),
        filename: "b.csv",
      },
      null,
    );
    expect(again).toMatchObject({ added: 1, skipped: 1 });
    await expect(sql`update bank_transactions set amount = 1`).rejects.toThrow(/nur ergänzt/);
  });

  it("Zahlungseingang: Vorschlag, Zuordnung, Ist-Buchung, bezahlt", async () => {
    const { invoice, contact } = await finalInvoice(400_000);
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([incoming("01.10.26", "Nordwerk Software GmbH", "DE02100100100006820101", `RE ${invoice.number} Leistungen August`, "4.760,00")]), filename: "a.csv" },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    const detail = await bank.transactionDetail(tx!.id);
    expect(detail?.suggestions[0]).toMatchObject({ item: { id: invoice.id }, amount: 476_000 });
    expect(detail?.suggestions[0]?.reasons).toEqual(["Betrag stimmt exakt", "Rechnungsnummer im Verwendungszweck", "Name passt"]);

    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: invoice.id, amount: 476_000 });
    const lines = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'allocation' order by l.account`;
    expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["1200", 476_000, 0],
      ["1400", 0, 476_000],
      ["1766", 76_000, 0],
      ["1776", 0, 76_000],
    ]);
    const list = await invoices.listInvoices("2026-10-02");
    expect(list.find((i) => i.id === invoice.id)).toMatchObject({ listStatus: "bezahlt", open: 0 });
    expect((await contacts.getContact(contact.id))?.contact.iban).toBe("DE02100100100006820101");
    expect((await invoices.invoiceSummary("2026-10-02")).openTotal).toBe(0);
  }, 30_000);

  it("Teilzahlung, Überzuordnung abgelehnt, Aufheben macht wieder offen", async () => {
    const { invoice } = await finalInvoice(400_000);
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([incoming("01.10.26", "Nordwerk", "DE02100100100006820101", "Abschlag", "2.000,00")]), filename: "a.csv" },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    await expect(
      bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: invoice.id, amount: 300_000 }),
    ).rejects.toThrow(/größer als der noch offene Teil/);
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: invoice.id, amount: 200_000 });
    // Liste und Filter rechnen den offenen Betrag gleich
    const [txRow] = await sql<{ bank_account_id: string }[]>`select bank_account_id from bank_transactions`;
    const accountId = txRow!.bank_account_id;
    expect((await bank.listTransactions(accountId, "alle", "")).map((t) => t.open)).toEqual([0]);
    expect(await bank.listTransactions(accountId, "offen", "")).toEqual([]);
    expect((await invoices.listInvoices("2026-09-10")).find((i) => i.id === invoice.id)).toMatchObject({
      listStatus: "teilbezahlt",
      open: 276_000,
    });

    const [allocation] = await sql`select id from allocations`;
    await bank.reverseAllocation(actor, allocation!.id);
    await expect(bank.reverseAllocation(actor, allocation!.id)).rejects.toThrow(/bereits aufgehoben/);
    const detail = await bank.transactionDetail(tx!.id);
    expect(detail?.transaction.open).toBe(200_000);
    expect(detail?.allocations[0]?.reversed).toBe(true);
    const [sum] = await sql`select sum(debit) - sum(credit) as diff, sum(case when account = '1776' then credit - debit else 0 end) as ust from journal_lines l
      join journal_entries e on e.id = l.entry_id where e.source_type = 'allocation'`;
    expect(Number(sum?.diff)).toBe(0);
    expect(Number(sum?.ust)).toBe(0);
  }, 30_000);

  it("Belegzahlung und Privatentnahme", async () => {
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7]);
    const { id: docId } = await documents.uploadDocument(actor, { bytes: JPEG, filename: "telekom.jpg" });
    await documents.updateDocument(actor, docId, {
      supplierName: "Telekom Deutschland GmbH",
      supplierUstId: "",
      invoiceNumber: "MF-09",
      documentDate: "2026-09-27",
      dueDate: null,
      category: "telefon",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 3857, tax: 733 }],
    });
    await documents.bookDocument(actor, docId);
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          outgoing("29.09.26", "Telekom Deutschland GmbH", "DE11100100100000000001", "Mobilfunk MF-09", "-45,90"),
          outgoing("24.09.26", "Eigene Überweisung", "DE33100100100000000002", "Umbuchung auf Privatkonto", "-3.000,00"),
        ]),
        filename: "a.csv",
      },
      null,
    );
    const txs = await sql`select id, amount from bank_transactions order by amount`;
    const privat = txs[0]!;
    const telekom = txs[1]!;

    const detail = await bank.transactionDetail(telekom.id);
    expect(detail?.suggestions[0]?.item).toMatchObject({ type: "document", id: docId, open: -4590 });
    await bank.allocate(actor, { kind: "document", transactionId: telekom.id, documentId: docId, amount: -4590 });
    await bank.allocate(actor, { kind: "privat", transactionId: privat.id, amount: -300_000 });

    const lines = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'allocation' order by l.account, l.debit`;
    expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["1200", 0, 4590],
      ["1200", 0, 300_000],
      ["1600", 4590, 0],
      ["1800", 300_000, 0],
    ]);
    expect(await bank.openItems()).toEqual([]);
    const accounts = await bank.listAccounts();
    expect(accounts[0]?.openCount).toBe(0);
  }, 30_000);

  it("Datei ohne IBAN braucht ein gewähltes Konto", async () => {
    const n26 = new TextEncoder().encode(
      '"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"\n' +
        '2026-09-28,2026-09-28,"JetBrains s.r.o.",,Presentment,"WebStorm","Main Account",-24.90,,,\n',
    );
    await expect(bank.importStatement(actor, { bytes: n26, filename: "n26.csv" }, null)).rejects.toThrow(/keine IBAN/);
    const account = await bank.createAccount(actor, { name: "N26 Business", iban: "DE55100110012620000000" });
    const result = await bank.importStatement(actor, { bytes: n26, filename: "n26.csv" }, account.id);
    expect(result).toMatchObject({ added: 1, accountName: "N26 Business" });
  });
});
