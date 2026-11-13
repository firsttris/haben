import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { today } from "../../today.ts";

/*
 * Aufhebung einer Bank-Zuordnung trägt ihr eigenes Datum (#782): Die Gegenbuchung wirkt am Tag, an dem die Aufhebung
 * erklärt wird, nicht am Buchungsdatum des Umsatzes. Sonst verschiebt eine Aufhebung im Juli nachträglich die
 * Voranmeldung des März, und der Juli bleibt unberührt; über das Jahr stimmt der Saldo, in der Periode nicht
 * (§ 17 Abs. 1 UStG gilt für die Berichtigung, die Aufhebung ist ein Vorgang von heute).
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const KONTENRAHMEN = ["SKR03", "SKR04"] as const;

describe.skipIf(!testDatabaseUrl)("Aufhebung einer Zuordnung am Tag der Aufhebung (#782)", () => {
  let bank: typeof import("./index.ts");
  let verrechnung: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let documents: typeof import("../belege/index.ts");
  let cancellation: typeof import("../belege/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let sequence = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    verrechnung = await import("./index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/index.ts");
    documents = await import("../belege/index.ts");
    cancellation = await import("../belege/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate document_settlements, document_cancellations, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, vat_returns, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 2026)`;
  });

  async function setKontenrahmen(kontenrahmen: (typeof KONTENRAHMEN)[number]) {
    await sql`update company set kontenrahmen = ${kontenrahmen}`;
  }

  /** Ausgangsrechnung über 1.190,00 € brutto, im März festgeschrieben */
  async function marchInvoice() {
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
      issueDate: "2026-03-05",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistungen Februar", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  /** Zahlungseingang im März, dem Umsatz zugeordnet; gibt die Zuordnung zurück */
  async function marchPayment(invoiceId: string) {
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          ["20.03.26", "20.03.26", "Gebucht", "Nordwerk Software GmbH", "Testfirma", "RE", "Eingang", "DE02100100100006820101", "1.190,00", "", "", ""],
        ]),
        filename: "maerz.csv",
      },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id as string, invoiceId, amount: 119_000 });
    const [allocation] = await sql`select id from allocations where reverses_id is null`;
    return { transactionId: tx!.id as string, allocationId: allocation!.id as string };
  }

  /** Alle Journalzeilen bis einschließlich `bis` als vergleichbare Liste; die Zeilen der Gegenbuchung tragen den Storno-Text */
  const zeilenBis = (bis: string) =>
    sql`select e.date, l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
        where e.date <= ${bis} order by e.date, l.account`;

  const gegenbuchung = (allocationId: string) =>
    sql`select e.id, e.date, e.description from journal_entries e join allocations a on a.id = e.source_id
        where e.source_type = 'allocation' and a.reverses_id = ${allocationId}`;

  for (const kontenrahmen of KONTENRAHMEN) {
    it(`Aufhebung im Juli bucht im Juli, die Zeilen des März bleiben unverändert (${kontenrahmen})`, async () => {
      await setKontenrahmen(kontenrahmen);
      const invoice = await marchInvoice();
      const { allocationId } = await marchPayment(invoice.id);
      const maerzVorher = await zeilenBis("2026-03-31");

      await bank.reverseAllocation(actor, allocationId, "2026-07-10");

      // Die Gegenbuchung steht im Juli; vor dem Fix stand hier das Buchungsdatum des Umsatzes (2026-03-20)
      expect((await gegenbuchung(allocationId)).map((e) => e.date)).toEqual(["2026-07-10"]);
      expect(await zeilenBis("2026-03-31")).toEqual(maerzVorher);
      // Der Juli trägt die Gegenbuchung, der Saldo über das Jahr bleibt null
      const [juli] = await sql`select count(*)::int as n from journal_entries where date = '2026-07-10'`;
      expect(juli?.n).toBeGreaterThan(0);
      const [saldo] = await sql`select sum(debit) - sum(credit) as diff from journal_lines`;
      expect(Number(saldo?.diff)).toBe(0);
    }, 30_000);
  }

  it("ohne Datum gilt heute", async () => {
    const invoice = await marchInvoice();
    const { allocationId } = await marchPayment(invoice.id);
    await bank.reverseAllocation(actor, allocationId);
    expect((await gegenbuchung(allocationId)).map((e) => e.date)).toEqual([today()]);
  }, 30_000);

  it("Aufteilung: alle Gegenzeilen eines Splits bekommen dasselbe Aufhebungsdatum", async () => {
    const invoice = await marchInvoice();
    // 1.200,00 € gehen ein, 10,00 € davon als Gebühr: eine Aufteilung aus zwei Teilen
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          ["20.03.26", "20.03.26", "Gebucht", "Nordwerk Software GmbH", "Testfirma", "RE", "Eingang", "DE02100100100006820101", "1.200,00", "", "", ""],
        ]),
        filename: "split.csv",
      },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    await bank.allocateSplit(actor, {
      transactionId: tx!.id as string,
      parts: [
        { kind: "invoice", invoiceId: invoice.id, amount: 119_000 },
        { kind: "gebuehren", amount: 1_000 },
      ],
    });
    const [part] = await sql`select id from allocations where kind = 'invoice'`;
    await bank.reverseAllocation(actor, part!.id as string, "2026-07-10");
    const dates = await sql`select distinct e.date from journal_entries e join allocations a on a.id = e.source_id
      where e.source_type = 'allocation' and a.reverses_id is not null order by e.date`;
    expect(dates.map((r) => r.date)).toEqual(["2026-07-10"]);
    expect(await sql`select id from allocations where reverses_id is not null`).toHaveLength(2);
  }, 30_000);

  it("verknüpfte Skontoaufhebung erbt das Aufhebungsdatum, nicht das der Zahlung", async () => {
    sequence++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, sequence % 256, 37]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${sequence}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Codewerk Lizenzen GmbH",
      supplierUstId: "",
      invoiceNumber: `L-${sequence}`,
      documentDate: "2026-03-10",
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 100_000, tax: 19_000 }],
    });
    await documents.bookDocument(actor, id);
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          ["20.03.26", "20.03.26", "Gebucht", "Testfirma", "Codewerk Lizenzen GmbH", "L", "Ausgang", "DE02100100100006820101", "-116,62", "", "", ""],
        ]),
        filename: "skonto.csv",
      },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    await bank.allocateWithRest(actor, { transactionId: tx!.id as string, target: { kind: "document", documentId: id }, rest: "skontoErhalten" });
    const [allocation] = await sql`select id from allocations where reverses_id is null`;
    const [writeOff] = await sql`select id, date from write_offs where reverses_id is null`;
    expect(writeOff?.date).toBe("2026-03-20");

    await bank.reverseAllocation(actor, allocation!.id as string, "2026-07-10");

    const [gegen] = await sql`select date from write_offs where reverses_id = ${writeOff!.id as string}`;
    expect(gegen?.date).toBe("2026-07-10");
    const [buchung] = await sql`select date from journal_entries where source_type = 'ausbuchung' and reverses_id is not null`;
    expect(buchung?.date).toBe("2026-07-10");
  }, 30_000);

  it("Belegstorno: die mit aufgehobene Zuordnung bekommt das Datum des Stornos", async () => {
    sequence++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, sequence % 256, 37]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${sequence}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Codewerk Lizenzen GmbH",
      supplierUstId: "",
      invoiceNumber: `L-${sequence}`,
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    await documents.bookDocument(actor, id);
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          ["20.09.26", "20.09.26", "Gebucht", "Testfirma", "Codewerk Lizenzen GmbH", "L", "Ausgang", "DE02100100100006820101", "-119,00", "", "", ""],
        ]),
        filename: "zahlung.csv",
      },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    await bank.allocate(actor, { kind: "document", transactionId: tx!.id as string, documentId: id, amount: -11_900 });
    const allocationIds = (await bank.documentBankAllocations(id)).map((a) => a.id);
    // September ist gemeldet: der Storno wirkt am Tag des Stornos, und die Zuordnung geht mit diesem Datum
    await sql`insert into vat_returns (year, month, status, source, sent_at, locked_at) values (2026, 9, 'sent', 'manuell', now(), now())`;
    const row = await cancellation.cancelDocument(actor, id, { allocationIds }, "2026-10-05");
    expect(row.date).toBe("2026-10-05");

    const gegen = await sql`select e.date from journal_entries e join allocations a on a.id = e.source_id
      where e.source_type = 'allocation' and a.reverses_id is not null`;
    expect(gegen.map((r) => r.date)).toEqual(["2026-10-05"]);
  }, 30_000);

  it("Aufhebung in einem schon gemeldeten Zeitraum ist erlaubt (kein Fehler)", async () => {
    const invoice = await marchInvoice();
    const { allocationId } = await marchPayment(invoice.id);
    await sql`insert into vat_returns (year, month, status, source, sent_at, locked_at) values (2026, 3, 'sent', 'manuell', now(), now())`;
    await bank.reverseAllocation(actor, allocationId, "2026-07-10");
    expect((await gegenbuchung(allocationId)).map((e) => e.date)).toEqual(["2026-07-10"]);
  }, 30_000);

  it("Ausbuchung und Verrechnung buchen weiter an ihrem eigenen Datum (Regression)", async () => {
    const invoice = await marchInvoice();
    // Ausbuchung ohne Zahlung: der Forderungsausfall steht im März, die Aufhebung im Juli
    await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: invoice.id, date: "2026-03-31" });
    const [writeOff] = await sql`select id from write_offs where reverses_id is null`;
    await bank.reverseWriteOff(actor, writeOff!.id as string, "2026-07-10");
    const [gegen] = await sql`select date from write_offs where reverses_id = ${writeOff!.id as string}`;
    expect(gegen?.date).toBe("2026-07-10");

    // Verrechnung zweier Belege desselben Lieferanten: Aufhebung trägt den Tag der Aufhebung
    const belege = [];
    for (const net of [10_000, -4_000]) {
      sequence++;
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, sequence % 256, 37]);
      const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${sequence}.jpg` });
      await documents.updateDocument(actor, id, {
        supplierName: "Codewerk Lizenzen GmbH",
        supplierUstId: "",
        invoiceNumber: `V-${sequence}`,
        documentDate: "2026-03-10",
        dueDate: null,
        category: "software",
        payment: "bank",
        note: "",
        amounts: [{ taxRate: 1900, net, tax: Math.round(net * 0.19) }],
      });
      await documents.bookDocument(actor, id);
      belege.push(id);
    }
    const { ids } = await verrechnung.settleDocuments(actor, {
      documentId: belege[0]!,
      counterDocumentId: belege[1]!,
      amount: 4_760,
      date: "2026-03-20",
      note: "Verrechnung",
    });
    const vorher = await sql`select count(*)::int as n from journal_entries`;
    await verrechnung.reverseSettlement(actor, ids[0]!, "2026-07-10");
    const [nachher] = await sql`select count(*)::int as n from journal_entries`;
    expect(nachher?.n).toBe(vorher![0]!.n);
    const [paar] = await sql`select distinct date from document_settlements where reverses_id is not null`;
    expect(paar?.date).toBe("2026-07-10");
  }, 30_000);
});
