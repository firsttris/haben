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
describe.skipIf(!testDatabaseUrl)("EÜR aus dem Journal bei Wechseln zum Stichjahr und mit Anlagen (Postgres)", () => {
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
  beforeAll(async () => {});

  /** Alles, was euerForYear liefert: Zeilen mit Bezeichnung und Notiz, Summen, Gewinn, Monate, nachrichtliche Beträge */

  /** Alles, was euerForYear liefert */
  const gleich = async (...years: number[]) => {
    for (const year of years) {
      expect(await reports.euerForYear(year), String(year)).toEqual(await reports.euerAusNebenbuechern(year));
    }
  };

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const [vorher, nachher] of [
      [true, false],
      [false, true],
    ] as const) {
      it(`Kleinunternehmer ${vorher} → ${nachher} zum Stichjahr: offene Rechnung und offener Beleg aus dem Vorjahr, im Stichjahr in Teilen bezahlt (${kontenrahmen})`, async () => {
        await reset("ist", kontenrahmen, vorher, "einzelunternehmen", 2026);
        const draft = await invoices.createDraft(actor, {
          contactId,
          issueDate: "2025-12-10",
          serviceFrom: null,
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd",
          note: "",
          ...(vorher ? { taxTreatment: "kleinunternehmer" } : {}),
          lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 33_333, taxRate: vorher ? 0 : 1900 }],
        } as never);
        const a = await invoices.finalizeInvoice(actor, draft.id);
        const b = await bookedDocument("2025-12-12", [{ taxRate: 1900, net: 5_001, tax: 950 }], { category: "bewirtung" });
        await sql`update company set kleinunternehmer = ${nachher} where id = 1`;
        const txs = await transactions([eingang("10.02.26", `RE ${a.number} Teil`, "100,01"), ausgang("11.02.26", "Restaurant", "-33,33")]);
        await bank.allocate(actor, { kind: "invoice", transactionId: txs.find((t) => t.amount === 10_001)!.id, invoiceId: a.id, amount: 10_001 });
        await bank.allocate(actor, { kind: "document", transactionId: txs.find((t) => t.amount === -3_333)!.id, documentId: b, amount: -3_333 });
        await gleich(2025, 2026);
      }, 60_000);
    }
  }
  for (const [vorher, nachher] of [
    ["SKR03", "SKR04"],
    ["SKR04", "SKR03"],
  ] as const) {
    it(`Kontenrahmenwechsel ${vorher} → ${nachher} zum Stichjahr: Restzahlungen auf Rechnungen und Belege (Privatanteil, Bewirtung, 7 %) aus dem Vorjahr`, async () => {
      await reset("ist", vorher, false, "einzelunternehmen", 2025);
      const a = await invoice("2025-11-10", [{ net: 33_333, rate: 1900 }]);
      const b = await bookedDocument("2025-11-12", [{ taxRate: 1900, net: 5_001, tax: 950 }], { privateShare: 30, category: "telefon" });
      await assets.createAsset(actor, {
        name: "Firmenwagen",
        kind: "kfz",
        method: "linear",
        acquisitionDate: "2023-01-10",
        cost: 3_600_000,
        usefulLifeMonths: 72,
        openingDate: "2025-01-01",
        openingBookValue: 2_400_000,
        disposalDate: null,
        privateUse: { listPrice: 4_000_000, drive: "verbrenner", rate: 100, vat: true },
        note: "",
      } as never);
      let txs = await transactions([eingang("20.11.25", `RE ${a.number} Teil`, "100,01"), ausgang("21.11.25", "Telefon", "-19,51")]);
      await bank.allocate(actor, { kind: "invoice", transactionId: txs.find((t) => t.amount === 10_001)!.id, invoiceId: a.id, amount: 10_001 });
      await bank.allocate(actor, { kind: "document", transactionId: txs.find((t) => t.amount === -1_951)!.id, documentId: b, amount: -1_951 });
      const c = await bookedDocument("2025-12-20", [{ taxRate: 700, net: 3_333, tax: 233 }], { category: "bewirtung" });
      const d = await invoice("2025-12-22", [{ net: 11_111, rate: 700 }]);
      await assets.bookDepreciation(actor, 2025, "2025-12-31");
      txs = await transactions([
        ausgang("28.12.25", "Restaurant", "-11,11"),
        eingang("29.12.25", `RE ${d.number} Teil`, "33,33"),
        eingang("15.01.26", `RE ${a.number} Rest`, "296,65"),
        ausgang("16.01.26", "Telefon", "-40,00"),
        eingang("17.01.26", `RE ${d.number} Rest`, "85,56"),
      ]);
      const id = (amount: number) => txs.find((t) => t.amount === amount)!.id;
      await bank.allocate(actor, { kind: "document", transactionId: id(-1_111), documentId: c, amount: -1_111 });
      await bank.allocate(actor, { kind: "invoice", transactionId: id(3_333), invoiceId: d.id, amount: 3_333 });
      await sql`update company set kontenrahmen = ${nachher} where id = 1`;
      await bank.allocate(actor, { kind: "invoice", transactionId: id(29_665), invoiceId: a.id, amount: 29_665 });
      await bank.allocate(actor, { kind: "document", transactionId: id(-4_000), documentId: b, amount: -4_000 });
      await bank.allocate(actor, { kind: "invoice", transactionId: id(8_556), invoiceId: d.id, amount: 8_556 });
      await gleich(2025, 2026);
    }, 60_000);
  }
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const ku of [false, true]) {
      it(`Anlagen: Abgang im Jahr, Sammelposten, GWG, Elektro-Kfz mit Privatnutzung, gebucht (${kontenrahmen}, Kleinunternehmer ${ku})`, async () => {
        await reset("ist", kontenrahmen, ku, "einzelunternehmen", 2026);
        const base = { usefulLifeMonths: null, disposalDate: null, privateUse: null, note: "" };
        await assets.createAsset(actor, {
          ...base,
          name: "Altwagen",
          kind: "kfz",
          method: "linear",
          acquisitionDate: "2022-01-10",
          cost: 3_600_011,
          usefulLifeMonths: 72,
          openingDate: "2026-01-01",
          openingBookValue: 1_200_003,
          disposalDate: "2026-06-30",
        } as never);
        await assets.createAsset(actor, {
          ...base,
          name: "E-Auto",
          kind: "kfz",
          method: "linear",
          acquisitionDate: "2025-04-10",
          cost: 4_800_007,
          usefulLifeMonths: 72,
          openingDate: "2026-01-01",
          openingBookValue: 4_000_001,
          privateUse: { listPrice: 5_123_400, drive: "elektro", rate: 100, vat: !ku },
        } as never);
        await assets.createAsset(actor, {
          ...base,
          name: "Regal",
          kind: "buero",
          method: "sammelposten",
          acquisitionDate: "2026-03-01",
          cost: 55_555,
          openingDate: "2026-03-01",
          openingBookValue: 55_555,
        } as never);
        await assets.createAsset(actor, {
          ...base,
          name: "Monitor",
          kind: "edv",
          method: "gwg",
          acquisitionDate: "2026-03-01",
          cost: 70_001,
          openingDate: "2026-03-01",
          openingBookValue: 70_001,
        } as never);
        await assets.createAsset(actor, {
          ...base,
          name: "Maschine",
          kind: "sonstiges",
          method: "degressiv",
          acquisitionDate: "2025-07-15",
          cost: 1_234_567,
          usefulLifeMonths: 120,
          openingDate: "2026-01-01",
          openingBookValue: 1_049_382,
        } as never);
        if (ku) await bookedDocument("2026-06-01", [{ taxRate: 1900, net: 10_000, tax: 1_900 }]);
        else await invoice("2026-06-01", [{ net: 10_000, rate: 1900 }]);
        await gleich(2026);
        await assets.bookDepreciation(actor, 2026, "2026-12-15");
        await gleich(2026);
      }, 60_000);
    }
  }
});
