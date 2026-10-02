import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom 01.10.2026:";"10.000,00 €"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
  return new TextEncoder().encode("﻿" + header + columns + body + "\n");
}

const row = (date: string, party: string, purpose: string, amount: string) =>
  [date, date, "Gebucht", party, party, purpose, amount.startsWith("-") ? "Ausgang" : "Eingang", "DE02100100100006820101", amount, "", "", ""];

describe.skipIf(!testDatabaseUrl)("Auswertungen (Postgres)", () => {
  let bank: typeof import("./bank.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("./contacts.ts");
  let documents: typeof import("./documents.ts");
  let reports: typeof import("./reports.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./bank.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("./contacts.ts");
    documents = await import("./documents.ts");
    reports = await import("./reports.ts");
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

  async function bookedDocument(
    marker: number,
    fields: { supplierName: string; documentDate: string; dueDate: string | null; category: "telefon" | "buero" | "software"; payment: "bank" | "privat"; net: number; tax: number },
  ) {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, marker]), filename: `beleg-${marker}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: fields.supplierName,
      supplierUstId: "",
      invoiceNumber: `B-${marker}`,
      documentDate: fields.documentDate,
      dueDate: fields.dueDate,
      category: fields.category,
      payment: fields.payment,
      note: "",
      amounts: [{ taxRate: 1900, net: fields.net, tax: fields.tax }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  it("EÜR nach Zufluss und Abfluss und offene Posten", async () => {
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
      lines: [{ description: "Leistungen August", quantity: 1000, unit: "Psch.", unitPrice: 400_000, taxRate: 1900 }],
    });
    const invoice = await invoices.finalizeInvoice(actor, draft.id);

    const telekom = await bookedDocument(1, { supplierName: "Telekom", documentDate: "2026-09-27", dueDate: null, category: "telefon", payment: "bank", net: 3857, tax: 733 });
    const software = await bookedDocument(2, { supplierName: "JetBrains", documentDate: "2026-09-28", dueDate: "2026-10-10", category: "software", payment: "bank", net: 10_000, tax: 1_900 });
    await bookedDocument(3, { supplierName: "Bürohaus", documentDate: "2026-08-15", dueDate: null, category: "buero", payment: "privat", net: 1_000, tax: 190 });
    // Privat bezahlter Beleg im Vorjahr zählt nicht
    await bookedDocument(4, { supplierName: "Bürohaus", documentDate: "2025-12-30", dueDate: null, category: "buero", payment: "privat", net: 5_000, tax: 950 });

    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          row("01.10.26", "Nordwerk Software GmbH", `RE ${invoice.number}`, "2.000,00"),
          row("29.09.26", "Telekom", "MF B-1", "-45,90"),
          row("10.09.26", "Finanzamt Regensburg", "USt 08/2026", "-500,00"),
          row("30.09.26", "DKB", "Kontoführung", "-9,90"),
          row("24.09.26", "Eigene Überweisung", "Privat", "-3.000,00"),
        ]),
        filename: "a.csv",
      },
      null,
    );
    const txs = await sql`select id, amount from bank_transactions`;
    const tx = (amount: number) => txs.find((t) => t.amount === amount)!.id as string;

    // Erst falsch zugeordnet und aufgehoben, dann richtig
    await bank.allocate(actor, { kind: "invoice", transactionId: tx(200_000), invoiceId: invoice.id, amount: 100_000 });
    const [wrong] = await sql`select id from allocations`;
    await bank.reverseAllocation(actor, wrong!.id);
    await bank.allocate(actor, { kind: "invoice", transactionId: tx(200_000), invoiceId: invoice.id, amount: 200_000 });
    await bank.allocate(actor, { kind: "document", transactionId: tx(-4590), documentId: telekom, amount: -4590 });
    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: tx(-50_000), amount: -50_000 });
    await bank.allocate(actor, { kind: "gebuehren", transactionId: tx(-990), amount: -990 });
    await bank.allocate(actor, { kind: "privat", transactionId: tx(-300_000), amount: -300_000 });

    const euer = await reports.euerForYear(2026);
    const line = (key: string) => [...euer.einnahmen, ...euer.ausgaben].find((l) => l.key === key)?.amount;
    expect(line("einnahmenSteuerpflichtig")).toBe(168_067);
    expect(line("vereinnahmteUst")).toBe(31_933);
    expect(euer.totalEinnahmen).toBe(200_000);
    expect(line("ausgabe:telefon")).toBe(3857);
    expect(line("ausgabe:buero")).toBe(1000);
    expect(line("ausgabe:geldverkehr")).toBe(990);
    expect(line("ausgabe:software")).toBeUndefined();
    expect(line("vorsteuer")).toBe(733 + 190);
    expect(line("gezahlteUst")).toBe(50_000);
    expect(euer.totalAusgaben).toBe(4590 + 1190 + 990 + 50_000);
    expect(euer.gewinn).toBe(200_000 - 56_770);
    expect(euer.monthly.einnahmen[9]).toBe(168_067);
    expect(euer.monthly.ausgaben[7]).toBe(1000);
    expect(euer.monthly.ausgaben[8]).toBe(3857 + 990);
    expect((await reports.euerForYear(2025)).totalAusgaben).toBe(5_950);

    const open = await reports.openPositions("2026-10-02");
    expect(open.receivables).toEqual([
      expect.objectContaining({ id: invoice.id, number: invoice.number, party: "Nordwerk Software GmbH", gross: 476_000, open: 276_000, dueDate: "2026-09-19", daysOverdue: 13 }),
    ]);
    expect(open.payables).toEqual([
      expect.objectContaining({ id: software, party: "JetBrains", gross: 11_900, open: 11_900, dueDate: "2026-10-10", daysOverdue: -8 }),
    ]);
    expect(open).toMatchObject({ receivablesTotal: 276_000, payablesTotal: 11_900, receivablesOverdue: 276_000, payablesOverdue: 0 });
    expect(await reports.reportYears()).toEqual([2025, 2026]);
  }, 30_000);
});
