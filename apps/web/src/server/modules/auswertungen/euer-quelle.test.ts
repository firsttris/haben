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
describe.skipIf(!testDatabaseUrl)("EÜR ab dem Stichjahr aus dem Journal (Postgres)", () => {
  let abgleich: typeof import("./abgleich.ts");
  let reports: typeof import("./reports.ts");
  let pauschalen: typeof import("../buchhaltung/pauschalen.ts");
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
    abgleich = await import("./abgleich.ts");
    reports = await import("./reports.ts");
    pauschalen = await import("../buchhaltung/pauschalen.ts");
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
      category?: "edv" | "telefon" | "sonstiges" | "hardware" | "anlage";
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

  const pruefe = async (...years: number[]) => {
    for (const year of years) {
      const euer = await abgleich.euerAbgleich(year);
      expect(euer.hinweise, String(year)).toEqual([]);
      expect(abgleich.abweichungen(euer.zeilen), String(year)).toEqual([]);
    }
  };
  /** Ein Jahr mit Teilzahlungen über den Jahreswechsel, Beleg mit Privatanteil, Bewirtung und Pauschale */
  async function geschaeftsjahr() {
    const a = await invoice("2026-11-10", [
      { net: 33_333, rate: 1900 },
      { net: 12_345, rate: 700 },
    ]);
    const doc = await bookedDocument("2026-11-20", [{ taxRate: 1900, net: 5_001, tax: 950 }], { privateShare: 30, category: "telefon" });
    await bookedDocument("2026-12-01", [{ taxRate: 1900, net: 10_000, tax: 1_900 }], { payment: "privat" });
    await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-12", tage: 9, description: "" }, "2026-12-31");
    const txs = await transactions([
      eingang("01.12.26", `RE ${a.number} Teil 1`, "100,01"),
      eingang("10.01.27", `RE ${a.number} Rest`, `${((a.gross - 10_001) / 100).toFixed(2).replace(".", ",")}`),
      ausgang("05.12.26", "Lieferant", "-29,75"),
    ]);
    await bank.allocate(actor, { kind: "invoice", transactionId: txs.find((t) => t.amount === 10_001)!.id, invoiceId: a.id, amount: 10_001 });
    await bank.allocate(actor, {
      kind: "invoice",
      transactionId: txs.find((t) => t.booking_date === "2027-01-10")!.id,
      invoiceId: a.id,
      amount: a.gross - 10_001,
    });
    await bank.allocate(actor, { kind: "document", transactionId: txs.find((t) => t.amount === -2_975)!.id, documentId: doc, amount: -2_975 });
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`ab dem Stichjahr aus dem Journal: Zeilen, Gewinn und Monate wie aus den Nebenbüchern (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await geschaeftsjahr();
        for (const year of [2026, 2027]) {
          const journal = await reports.euerForYear(year);
          const nebenbuecher = await reports.euerAusNebenbuechern(year);
          const zeilen = (r: typeof journal) => Object.fromEntries([...r.einnahmen, ...r.ausgaben].filter((l) => l.amount !== 0).map((l) => [l.key, l.amount]));
          expect(zeilen(journal), String(year)).toEqual(zeilen(nebenbuecher));
          expect(journal.gewinn, String(year)).toBe(nebenbuecher.gewinn);
          expect(journal.monthly, String(year)).toEqual(nebenbuecher.monthly);
          expect(journal.bewirtungNichtAbziehbar).toBe(nebenbuecher.bewirtungNichtAbziehbar);
        }
        expect((await reports.euerForYear(2026)).gewinn).not.toBe(0);
        await pruefe(2026, 2027);
      }, 60_000);
    }

    it(`ab dem Stichjahr zählt, was im Journal steht; der Abgleich zeigt die Nebenbücher dagegen (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen);
      await bookedDocument("2026-03-01", [{ taxRate: 1900, net: 10_000, tax: 1_900 }], { payment: "privat" });
      // An Haben vorbei: der Aufwand im Journal um 1 € erhöht
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update journal_lines set debit = debit + 100 where debit = 10000`;
      });
      const journal = await reports.euerForYear(2026);
      const nebenbuecher = await reports.euerAusNebenbuechern(2026);
      expect(journal.gewinn).toBe(nebenbuecher.gewinn - 100);
      expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual(
        expect.arrayContaining([expect.objectContaining({ posten: "EÜR: Hosting und IT-Dienste", journal: 10_100, quelle: 10_000 })]),
      );
    }, 60_000);

    it(`vor dem Stichjahr aus den Nebenbüchern (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen, false, "einzelunternehmen", 2027);
      await bookedDocument("2026-03-01", [{ taxRate: 1900, net: 10_000, tax: 1_900 }], { payment: "privat" });
      // Auch eine Änderung an Haben vorbei im Journal ändert die EÜR vor dem Stichjahr nicht
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update journal_lines set debit = debit + 100 where debit = 10000`;
      });
      expect((await reports.euerForYear(2026)).gewinn).toBe((await reports.euerAusNebenbuechern(2026)).gewinn);
    }, 60_000);

    it(`AfA und Privatnutzung: vor dem Buchen aus dem Anlagenverzeichnis, danach aus dem Journal (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen);
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
        privateUse: { listPrice: 4_000_000, drive: "elektro", rate: 100, vat: true },
        note: "",
      });
      await invoice("2025-06-01", [{ net: 10_000, rate: 1900 }]);
      const vorher = await reports.euerForYear(2025);
      expect(vorher.ausgaben.find((l) => l.key === "afa")!.amount).toBeGreaterThan(0);
      expect(vorher.gewinn).toBe((await reports.euerAusNebenbuechern(2025)).gewinn);
      await assets.bookDepreciation(actor, 2025, "2025-12-15");
      const nachher = await reports.euerForYear(2025);
      expect(nachher.gewinn).toBe(vorher.gewinn);
      expect([...nachher.einnahmen, ...nachher.ausgaben].map((l) => [l.key, l.amount])).toEqual(
        [...vorher.einnahmen, ...vorher.ausgaben].map((l) => [l.key, l.amount]),
      );
    }, 60_000);
  }
});
