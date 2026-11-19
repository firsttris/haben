import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import type { EuerBeitraege } from "./euer-journal-buchungen.ts";
import { kleinunternehmerStand } from "./test-umsatz-stand.ts";

/*
 * Der Sammler der BWA in euerAusJournal (#1380) ist rein additiv: Mit und ohne Sammler rechnet die EÜR gleich, und er meldet je
 * Buchung deren eigene ID mit der Rechnung bzw. dem Beleg, den sie ausgleicht, auch bei Ausbuchung und Kasse. Alle Daten erfunden.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}
const umsatz = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Testfirma",
  purpose,
  "Umsatz",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

describe.skipIf(!testDatabaseUrl)("Sammler der BWA in euerAusJournal (Postgres, #1380)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/bank.ts");
  let cashInvoice: typeof import("../bank/cash-invoice.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let euerJournal: typeof import("./euer-journal.ts");
  const actor = "test-user";
  let contactId: string;
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/bank.ts");
    cashInvoice = await import("../bank/cash-invoice.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    euerJournal = await import("./euer-journal.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04") {
    await leeren(sql)`truncate document_settlements, asset_depreciations, assets, pauschalen, allocations, bank_transactions, bank_imports, bank_accounts,
      cash_entries, write_offs, journal_lines, journal_entries, document_splits, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', ${kontenrahmen})`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "a@b.example",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  }

  async function invoice(issueDate: string, net: number) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: net, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  }

  async function beleg(date: string, net: number, category: "edv" | "bewirtung", payment: "bank" | "privat") {
    docSeq++;
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, 7]), filename: `s${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Rechenzentrum Süd",
      supplierUstId: "",
      invoiceNumber: `S${docSeq}`,
      documentDate: date,
      dueDate: null,
      category,
      payment,
      note: "",
      amounts: [{ taxRate: 1900, net, tax: (net * 19) / 100 }],
      privateShare: 0,
      reverseCharge: null,
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`EÜR mit und ohne Sammler gleich, je Buchung ihre ID und ihr Ausgleich (${kontenrahmen}, Ist)`, async () => {
      await reset(kontenrahmen);
      const bezahlt = await invoice("2026-03-02", 100_000);
      const ausgefallen = await invoice("2026-04-01", 20_000);
      const bar = await invoice("2026-05-04", 10_000);
      const edv = await beleg("2026-03-10", 40_000, "edv", "bank");
      await beleg("2026-06-03", 10_000, "bewirtung", "privat");
      const txs = await (async () => {
        await bank.importStatement(
          actor,
          {
            bytes: dkbCsv([
              umsatz("20.03.26", `RE ${bezahlt.number}`, "600,00"),
              umsatz("15.04.26", `RE ${bezahlt.number}`, "590,00"),
              umsatz("25.03.26", "RZ", "-476,00"),
            ]),
            filename: "s.csv",
          },
          null,
        );
        return sql<{ id: string; amount: number }[]>`select id, amount from bank_transactions order by booking_date`;
      })();
      await bank.allocate(actor, { kind: "invoice", transactionId: txs[0]!.id, invoiceId: bezahlt.id, amount: 60_000 });
      await bank.allocate(actor, { kind: "document", transactionId: txs[1]!.id, documentId: edv, amount: -47_600 });
      await bank.allocate(actor, { kind: "invoice", transactionId: txs[2]!.id, invoiceId: bezahlt.id, amount: 59_000 });
      await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: ausgefallen.id, date: "2026-09-30" });
      await cashInvoice.createCashInvoiceEntry(actor, { invoiceId: bar.id, date: "2026-05-10", amount: 11_900 }, "2026-05-10");

      const ohne = await euerJournal.euerAusJournal(2026);
      const gemeldet: Parameters<EuerBeitraege>[0][] = [];
      const mit = await euerJournal.euerAusJournal(2026, undefined, undefined, false, (b) => gemeldet.push(b));
      expect(mit).toEqual(ohne);
      expect(Object.keys(ohne.summe.zeilen).length).toBeGreaterThan(3);

      // Jede gemeldete Buchung trägt ihre eigene ID aus dem Journal, nicht die der Zahlung, Ausbuchung oder Kassenbuchung
      const journal = new Set((await sql<{ id: string }[]>`select id from journal_entries`).map((r) => r.id));
      for (const b of gemeldet) expect(journal.has(b.id), `${b.sourceType} ${b.id}`).toBe(true);
      const ausbuchung = gemeldet.find((b) => b.sourceType === "ausbuchung");
      expect(ausbuchung?.invoiceId).toBe(ausgefallen.id);
      expect(gemeldet.find((b) => b.sourceType === "kasse")?.invoiceId).toBe(bar.id);
    }, 60_000);
  }
});
