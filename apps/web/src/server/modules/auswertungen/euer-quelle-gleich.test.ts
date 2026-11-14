import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const eingang = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Testfirma",
  purpose,
  "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];
const ausgang = (date: string, name: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Testfirma",
  name,
  "Zahlung",
  "Ausgang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

/*
 * EÜR ab dem Stichjahr aus dem Journal (#542, docs/adr/journal-als-quelle.md, Entscheidung 3): euerForYear rechnet aus dem
 * Journal (euer-quelle.ts), die Nebenbücher sind die Gegenprobe im Abgleich. Gleiche Zeilen, gleicher Gewinn, gleiche Monate.
 */
describe.skipIf(!testDatabaseUrl)("EÜR aus dem Journal gleich den Nebenbüchern: Kleinunternehmer, Bewirtung, Privatanteil, Anlagen (Postgres)", () => {
  let reports: typeof import("./reports.ts");
  let assets: typeof import("../buchhaltung/assets.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    reports = await import("./reports.ts");
    assets = await import("../buchhaltung/assets.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(
    versteuerung: "ist" | "soll",
    kontenrahmen: "SKR03" | "SKR04" = "SKR03",
    kleinunternehmer = false,
    rechtsform: "einzelunternehmen" | "gmbh" = "einzelunternehmen",
    journalAb: number | null = null,
  ) {
    await leeren(sql)`truncate asset_depreciations, assets, pauschalen, allocations, bank_transactions, bank_imports, bank_accounts,
      cash_entries, write_offs, year_closings, loans, journal_lines, journal_entries, document_splits, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, kleinunternehmer, rechtsform, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, ${kleinunternehmer}, ${rechtsform}, ${journalAb})`;
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

  async function invoice(issueDate: string, lines: { net: number; rate: 1900 | 700 }[]) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: lines.map((l) => ({ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: l.net, taxRate: l.rate })),
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function bookedDocument(
    date: string,
    amounts: { taxRate: 1900 | 700 | 0; net: number; tax: number }[],
    extra: {
      payment?: "bank" | "privat";
      privateShare?: number;
      reverseCharge?: "eu" | "drittland" | null;
      category?: "edv" | "telefon" | "sonstiges" | "hardware" | "anlage" | "bewirtung" | "geschenke";
      splits?: { category: "software" | "buero"; taxRate: 1900 | 700 | 0; net: number }[];
    } = {},
  ) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 7]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `b${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: "",
      invoiceNumber: `R${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: extra.category ?? "edv",
      payment: extra.payment ?? "bank",
      note: "",
      amounts,
      privateShare: extra.privateShare ?? 0,
      reverseCharge: extra.reverseCharge ?? null,
      ...(extra.splits ? { splits: extra.splits } : {}),
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function transactions(rows: string[][]) {
    await bank.importStatement(actor, { bytes: dkbCsv(rows), filename: `${crypto.randomUUID()}.csv` }, null);
    return sql<
      { id: string; booking_date: string; amount: number }[]
    >`select id, booking_date::text, amount from bank_transactions order by booking_date, amount`;
  }

  let manual: typeof import("../buchhaltung/manual.ts");
  beforeAll(async () => {
    manual = await import("../buchhaltung/manual.ts");
  });

  /** Alles, was euerForYear liefert: Zeilen mit Bezeichnung und Notiz, Summen, Gewinn, Monate, nachrichtliche Beträge */
  const gleich = async (...years: number[]) => {
    for (const year of years) {
      expect(await reports.euerForYear(year), String(year)).toEqual(await reports.euerAusNebenbuechern(year));
    }
  };

  it("GmbH: eine manuelle Buchung auf ein Aufwandskonto ändert den Überschuss nach Zahlung nicht (ADR Entscheidung 3: nur im Einzelunternehmen)", async () => {
    await reset("soll", "SKR03", false, "gmbh");
    await bookedDocument("2026-03-01", [{ taxRate: 1900, net: 10_000, tax: 1_900 }], { payment: "bank" });
    // Jahresabschluss: Rückstellung für Abschlusskosten, ohne Zahlung
    await manual.createManualEntry(
      actor,
      {
        date: "2026-12-31",
        description: "Rückstellung Abschlusskosten",
        lines: [
          { account: "4955", debit: 150_000, credit: 0 },
          { account: "0970", debit: 0, credit: 150_000 },
        ],
      },
      "2027-01-15",
    );
    await gleich(2026);
  }, 60_000);

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`Kleinunternehmer: Teilzahlungen mit krummen Beträgen, Bewirtung zu 7 % und 19 %, Geschenke (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen, true);
      const draft = await invoices.createDraft(actor, {
        contactId,
        issueDate: "2026-02-10",
        serviceFrom: null,
        serviceTo: null,
        paymentTermDays: 14,
        format: "zugferd",
        note: "",
        taxTreatment: "kleinunternehmer",
        lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 100_001, taxRate: 0 }],
      } as never);
      const a = await invoices.finalizeInvoice(actor, draft.id);
      const bew = await bookedDocument(
        "2026-03-05",
        [
          { taxRate: 700, net: 3_333, tax: 233 },
          { taxRate: 1900, net: 1_111, tax: 211 },
        ],
        { category: "bewirtung" },
      );
      await bookedDocument("2026-04-05", [{ taxRate: 1900, net: 2_001, tax: 380 }], { category: "geschenke", payment: "privat" });
      const txs = await transactions([
        eingang("01.03.26", `RE ${a.number} Teil`, "333,33"),
        ausgang("10.03.26", "Restaurant", "-33,33"),
        ausgang("10.04.26", "Restaurant", "-15,55"),
      ]);
      await bank.allocate(actor, { kind: "invoice", transactionId: txs.find((t) => t.amount === 33_333)!.id, invoiceId: a.id, amount: 33_333 });
      await bank.allocate(actor, { kind: "document", transactionId: txs.find((t) => t.amount === -3_333)!.id, documentId: bew, amount: -3_333 });
      await bank.allocate(actor, { kind: "document", transactionId: txs.find((t) => t.amount === -1_555)!.id, documentId: bew, amount: -1_555 });
      await gleich(2026);
    }, 60_000);

    it(`Regelbesteuert: Bewirtung zu 7 % und 19 % mit Teilzahlungen, Privatanteil, Aufteilung, § 13b (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen);
      const bew = await bookedDocument(
        "2026-03-05",
        [
          { taxRate: 700, net: 3_333, tax: 233 },
          { taxRate: 1900, net: 1_111, tax: 211 },
        ],
        { category: "bewirtung" },
      );
      const priv = await bookedDocument("2026-03-06", [{ taxRate: 1900, net: 5_001, tax: 950 }], { privateShare: 33, category: "telefon" });
      const split = await bookedDocument("2026-03-07", [{ taxRate: 1900, net: 3_000, tax: 570 }], {
        splits: [
          { category: "software", taxRate: 1900, net: 1_001 },
          { category: "buero", taxRate: 1900, net: 1_999 },
        ],
      });
      const rc = await bookedDocument("2026-03-08", [{ taxRate: 1900, net: 10_000, tax: 1_900 }], { reverseCharge: "eu" });
      const txs = await transactions([
        ausgang("10.03.26", "Restaurant", "-33,33"),
        ausgang("11.03.26", "Telefon", "-17,77"),
        ausgang("12.03.26", "Software", "-11,11"),
        ausgang("13.03.26", "Ausland", "-33,33"),
        ausgang("10.05.26", "Restaurant", "-15,55"),
      ]);
      const id = (amount: number, date?: string) => txs.find((t) => t.amount === amount && (!date || t.booking_date === date))!.id;
      await bank.allocate(actor, { kind: "document", transactionId: id(-3_333, "2026-03-10"), documentId: bew, amount: -3_333 });
      await bank.allocate(actor, { kind: "document", transactionId: id(-1_555), documentId: bew, amount: -1_555 });
      await bank.allocate(actor, { kind: "document", transactionId: id(-1_777), documentId: priv, amount: -1_777 });
      await bank.allocate(actor, { kind: "document", transactionId: id(-1_111), documentId: split, amount: -1_111 });
      await bank.allocate(actor, { kind: "document", transactionId: id(-3_333, "2026-03-13"), documentId: rc, amount: -3_333 });
      await gleich(2026);
    }, 60_000);

    it(`Anlagen gemischt: AfA gebucht, danach eine weitere Anlage übernommen (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen);
      const anlage = (name: string, privateUse: null | { listPrice: number; drive: "verbrenner" | "elektro"; rate: number; vat: boolean }) =>
        assets.createAsset(actor, {
          name,
          kind: "kfz",
          method: "linear",
          acquisitionDate: "2023-01-10",
          cost: 3_600_000,
          usefulLifeMonths: 72,
          openingDate: "2026-01-01",
          openingBookValue: 1_800_000,
          disposalDate: null,
          privateUse,
          note: "",
        } as never);
      await anlage("Firmenwagen", { listPrice: 4_000_000, drive: "verbrenner", rate: 100, vat: true });
      await invoice("2026-06-01", [{ net: 10_000, rate: 1900 }]);
      await assets.bookDepreciation(actor, 2026, "2026-12-15");
      await gleich(2026);
      await anlage("Zweitwagen", null);
      await gleich(2026);
    }, 60_000);
  }

  it("Kleinunternehmer: aufgehobene Zuordnung der einzigen Zahlung, keine leere Zeile „Betriebseinnahmen als Kleinunternehmer“", async () => {
    await reset("ist", "SKR03", true);
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-02-10",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment: "kleinunternehmer",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 100_000, taxRate: 0 }],
    } as never);
    const a = await invoices.finalizeInvoice(actor, draft.id);
    const txs = await transactions([eingang("01.03.26", `RE ${a.number}`, "1000,00")]);
    await bank.allocate(actor, { kind: "invoice", transactionId: txs[0]!.id, invoiceId: a.id, amount: 100_000 });
    const [alloc] = await sql<{ id: string }[]>`select id from allocations where invoice_id = ${a.id}`;
    // Aufhebung am Tag der Zahlung: Es geht hier um die leere Zeile, nicht um den Zeitraum der Gegenzeile
    await bank.reverseAllocation(actor, alloc!.id, "2026-03-01");
    await gleich(2026);
  }, 60_000);
});
