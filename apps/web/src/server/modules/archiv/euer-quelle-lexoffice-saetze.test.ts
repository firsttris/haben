import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const PDF = new TextEncoder().encode("%PDF-1.4\n% RE1019 aus Lexoffice\n%%EOF\n");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);

describe.skipIf(!testDatabaseUrl)("Übernommene Lexoffice-Posten mit mehreren Steuersätzen in der EÜR aus dem Journal (Postgres)", () => {
  let legacy: typeof import("./legacy-open.ts");
  let bank: typeof import("../bank/bank.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let storage: typeof import("../../storage.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    legacy = await import("./legacy-open.ts");
    bank = await import("../bank/bank.ts");
    reports = await import("../auswertungen/reports.ts");
    storage = await import("../../storage.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  let versteuerung = "ist";
  let kontenrahmen = "SKR03";
  const reset = async () => {
    await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts, documents,
      invoice_lines, invoices, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen})`;
    await sql`insert into contacts (name, strasse, plz, ort) values ('Nordwerk Software GmbH', 'Hafenstraße 5', '20457', 'Hamburg')`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
  };

  const gleich = async (year: number) => {
    expect(await reports.euerForYear(year)).toEqual(await reports.euerAusNebenbuechern(year));
  };
  const zeile = (date: string, name: string, purpose: string, amount: string, eingang: boolean) => [
    date,
    date,
    "Gebucht",
    eingang ? name : "Testfirma",
    eingang ? "Testfirma" : name,
    purpose,
    eingang ? "Eingang" : "Ausgang",
    "DE02100100100006820101",
    amount,
    "",
    "",
    "",
  ];

  async function multiVoucher(
    direction: "einnahme" | "ausgabe",
    number: string,
    taxes: { rate: number; net: number; tax: number }[],
    file: Uint8Array,
    mime: string,
    category = "Bürobedarf",
  ) {
    const net = taxes.reduce((s, t) => s + t.net, 0);
    const tax = taxes.reduce((s, t) => s + t.tax, 0);
    const gross = net + tax;
    const [contact] = direction === "einnahme" ? await sql`select id from contacts where name = 'Nordwerk Software GmbH'` : [];
    const [row] = await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, type, direction, number, date, due_date, status, contact_id,
        contact_name, net, tax, gross, taxes, categories, payment, raw)
      values (${crypto.randomUUID()}, (select id from lexoffice_imports limit 1), ${direction === "einnahme" ? "invoice" : "purchaseinvoice"}, ${direction}, ${number},
        '2026-09-20', '2026-09-20', 'open', ${contact?.id ?? null}, ${direction === "einnahme" ? "Nordwerk Software GmbH" : "Bürobedarf Schmidt KG"},
        ${net}, ${tax}, ${gross}, ${JSON.stringify(taxes)}::jsonb,
        ${JSON.stringify(direction === "ausgabe" ? taxes.map((t) => ({ categoryId: "x", name: category, rate: t.rate, net: t.net, tax: t.tax })) : [])}::jsonb,
        ${JSON.stringify({ status: "openRevenue", openAmount: gross, paidDate: null, items: [] })}::jsonb, ${JSON.stringify({ address: { name: "" } })}::jsonb)
      returning id`;
    const sha = await storage.storeFile(file);
    await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size)
      values (${row!.id}, ${mime === "application/pdf" ? "pdf" : "anhang"}, ${number + (mime === "application/pdf" ? ".pdf" : ".jpg")}, ${mime}, ${sha}, ${file.byteLength})`;
    return row!.id as string;
  }

  for (const kr of ["SKR03", "SKR04"]) {
    for (const vs of ["ist", "soll"]) {
      for (const category of ["Bürobedarf", "Bewirtung"]) {
        it(`Teilzahlungen auf übernommene Rechnung und Beleg mit 7 % und 19 % (${kr}, ${vs}, ${category})`, async () => {
          versteuerung = vs;
          kontenrahmen = kr;
          await reset();
          const re = await multiVoucher(
            "einnahme",
            "RE7",
            [
              { rate: 700, net: 33_333, tax: 2_333 },
              { rate: 1900, net: 11_111, tax: 2_111 },
            ],
            PDF,
            "application/pdf",
          );
          const be = await multiVoucher(
            "ausgabe",
            "B-8",
            [
              { rate: 700, net: 3_333, tax: 233 },
              { rate: 1900, net: 1_111, tax: 211 },
            ],
            JPEG,
            "image/jpeg",
            category,
          );
          const ri = await legacy.takeOverLegacyItem(actor, re);
          const bi = await legacy.takeOverLegacyItem(actor, be);
          await bank.importStatement(
            actor,
            {
              bytes: dkbCsv([
                zeile("05.10.26", "Nordwerk Software GmbH", "RE7 Teil", "100,01", true),
                zeile("06.10.26", "Bürobedarf Schmidt KG", "B-8 Teil", "-11,11", false),
                zeile("07.10.26", "Nordwerk Software GmbH", "RE7 Teil2", "33,33", true),
                zeile("08.10.26", "Bürobedarf Schmidt KG", "B-8 Teil2", "-7,77", false),
              ]),
              filename: "a.csv",
            },
            null,
          );
          const txs = await sql<{ id: string; amount: number }[]>`select id, amount from bank_transactions`;
          const t = (a: number) => txs.find((x) => x.amount === a)!.id;
          await bank.allocate(actor, { kind: "invoice", transactionId: t(10_001), invoiceId: ri.id, amount: 10_001 });
          await bank.allocate(actor, { kind: "document", transactionId: t(-1_111), documentId: bi.id, amount: -1_111 });
          await bank.allocate(actor, { kind: "invoice", transactionId: t(3_333), invoiceId: ri.id, amount: 3_333 });
          await bank.allocate(actor, { kind: "document", transactionId: t(-777), documentId: bi.id, amount: -777 });
          await gleich(2026);
        }, 60_000);
      }
    }
  }
});
