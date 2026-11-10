import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

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

describe.skipIf(!testDatabaseUrl)("Stichjahr: saubere Jahre bleiben vorziehbar (Postgres)", () => {
  let sql: postgres.Sql;
  let stichjahr: typeof import("./stichjahr.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let assets: typeof import("../buchhaltung/assets.ts");
  let bank: typeof import("../bank/bank.ts");
  const actor = "test-user";
  const today = "2026-10-04";
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    stichjahr = await import("./stichjahr.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    assets = await import("../buchhaltung/assets.ts");
    bank = await import("../bank/bank.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kr: "SKR03" | "SKR04", v: "ist" | "soll", klein = false) {
    await sql`truncate asset_depreciations, assets, vat_return_submissions, vat_returns, write_offs, allocations, bank_transactions,
      bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, kleinunternehmer, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${v}, ${kr}, ${klein}, 2027)`;
  }
  async function invoice(issueDate: string, taxRate: 1900 | 0 = 1900) {
    const c = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "a@b.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const d = await invoices.createDraft(actor, {
      contactId: c.id,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      ...(taxRate === 0 ? { taxTreatment: "kleinunternehmer" } : {}),
      lines: [{ description: "L", quantity: 1000, unit: "Psch." as const, unitPrice: 10_000, taxRate }],
    } as never);
    return invoices.finalizeInvoice(actor, d.id);
  }
  async function pay(invoiceId: string, date: string, amount: string) {
    const purpose = crypto.randomUUID();
    await bank.importStatement(actor, { bytes: dkbCsv([eingang(date, purpose, amount)]), filename: `${purpose}.csv` }, null);
    const [tx] = await sql`select id, amount from bank_transactions where purpose = ${purpose}`;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId, amount: Number(tx!.amount) });
  }
  async function beleg(date: string, net: number, tax: number, taxRate = 1900) {
    docSeq++;
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq, 7, 9]), filename: `b${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: "",
      invoiceNumber: `R${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: "edv",
      payment: "privat",
      note: "",
      amounts: [{ taxRate: taxRate as 1900 | 700 | 0, net, tax }],
      privateShare: 0,
      reverseCharge: null,
    });
    await documents.bookDocument(actor, id);
  }
  async function auto(drive: "verbrenner" | "elektro") {
    await assets.createAsset(actor, {
      name: `Wagen ${drive}`,
      kind: "kfz",
      method: "linear",
      acquisitionDate: "2023-01-10",
      cost: 3_600_000,
      usefulLifeMonths: 72,
      openingDate: "2025-01-01",
      openingBookValue: 2_400_000,
      disposalDate: null,
      privateUse: { listPrice: 5_000_000, drive, rate: 100, vat: true },
      note: "",
    } as never);
  }
  const expectVorziehbar = async () => expect((await stichjahr.stichjahrStand(today)).gruende).toEqual([]);

  for (const kr of ["SKR03", "SKR04"] as const) {
    for (const v of ["ist", "soll"] as const) {
      it(`leeres Jahr (${kr}, ${v})`, async () => {
        await reset(kr, v);
        await expectVorziehbar();
      }, 60_000);
      it(`Rechnung im Vorjahr, Zahlung im Jahr, Beleg (${kr}, ${v})`, async () => {
        await reset(kr, v);
        const inv = await invoice("2025-12-10");
        await pay(inv.id, "05.02.2026", "119,00");
        const inv2 = await invoice("2026-03-10");
        await pay(inv2.id, "20.03.2026", "60,00");
        await beleg("2026-04-02", 10_000, 1_900);
        await expectVorziehbar();
      }, 60_000);
      it(`Firmenwagen mit Privatnutzung, AfA Vorjahr gebucht (${kr}, ${v})`, async () => {
        await reset(kr, v);
        await auto("verbrenner");
        await auto("elektro");
        await assets.bookDepreciation(actor, 2025, "2025-12-15");
        const inv = await invoice("2026-06-01");
        await pay(inv.id, "10.06.2026", "119,00");
        await expectVorziehbar();
      }, 60_000);
      it(`Dezember: AfA des Jahres gebucht, Firmenwagen (${kr}, ${v})`, async () => {
        await reset(kr, v);
        await auto("verbrenner");
        await auto("elektro");
        await assets.bookDepreciation(actor, 2025, "2025-12-15");
        const inv = await invoice("2026-06-01");
        await pay(inv.id, "10.06.2026", "119,00");
        await assets.bookDepreciation(actor, 2026, "2026-12-05");
        expect((await stichjahr.stichjahrStand("2026-12-06")).gruende).toEqual([]);
      }, 60_000);
      it(`Storno im Jahr einer Rechnung aus dem Vorjahr (${kr}, ${v})`, async () => {
        await reset(kr, v);
        const inv = await invoice("2025-12-10");
        await invoices.cancelInvoice(actor, inv.id, "2026-02-03");
        const inv2 = await invoice("2026-03-10");
        await pay(inv2.id, "20.03.2026", "119,00");
        await invoices.cancelInvoice(actor, inv2.id, "2026-04-03");
        await expectVorziehbar();
      }, 60_000);
    }
    it(`Kleinunternehmer (${kr})`, async () => {
      await reset(kr, "ist", true);
      const inv = await invoice("2026-02-01", 0);
      await pay(inv.id, "15.02.2026", "100,00");
      await beleg("2026-03-02", 10_000, 1_900);
      await expectVorziehbar();
    }, 60_000);
  }
});
