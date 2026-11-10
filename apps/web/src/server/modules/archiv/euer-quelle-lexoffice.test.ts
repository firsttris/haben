import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const PDF = new TextEncoder().encode("%PDF-1.4\n% RE1019 aus Lexoffice\n%%EOF\n");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);

describe.skipIf(!testDatabaseUrl)("Übernommene Lexoffice-Posten in der EÜR aus dem Journal (Postgres)", () => {
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

  async function legacyVoucher(values: {
    type: string;
    direction: "einnahme" | "ausgabe";
    number: string;
    date: string;
    net: number;
    tax: number;
    rate?: number;
    status?: string;
    openAmount?: number | null;
    /** Zahlungen laut Lexoffice; mit Zahlungen ist der Beleg heute so weit bezahlt */
    payments?: { date: string; amount: number; type?: string }[];
    file?: Uint8Array;
    mime?: string;
    contact?: string;
    category?: string;
  }) {
    const rate = values.rate ?? 1900;
    const gross = values.net + values.tax;
    const items = (values.payments ?? []).map((p) => ({ type: p.type ?? "partPaymentFinancialTransaction", date: p.date, amount: p.amount }));
    const paid = items.reduce((s, i) => s + Math.abs(i.amount), 0);
    const payment =
      values.openAmount === null
        ? null
        : { status: paid >= gross ? "balanced" : "openRevenue", openAmount: values.openAmount ?? gross - paid, paidDate: null, items };
    const [contact] = values.contact ? await sql`select id from contacts where name = ${values.contact}` : [];
    const [row] = await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, type, direction, number, date, due_date, status, contact_id,
        contact_name, net, tax, gross, taxes, categories, payment, raw)
      values (${crypto.randomUUID()}, (select id from lexoffice_imports limit 1), ${values.type}, ${values.direction}, ${values.number},
        ${values.date}, ${values.date}, ${values.status ?? "open"}, ${contact?.id ?? null}, ${values.contact ?? "Bürobedarf Schmidt KG"},
        ${values.net}, ${values.tax}, ${gross}, ${JSON.stringify([{ rate, net: values.net, tax: values.tax }])}::jsonb,
        ${JSON.stringify(values.direction === "ausgabe" ? [{ categoryId: "x", name: values.category ?? "Bürobedarf", rate, net: values.net, tax: values.tax }] : [])}::jsonb,
        ${payment ? JSON.stringify(payment) : null}::jsonb, ${JSON.stringify({ address: { name: values.contact ?? "" } })}::jsonb)
      returning id`;
    if (values.file) {
      const sha = await storage.storeFile(values.file);
      await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size)
        values (${row!.id}, ${values.mime === "application/pdf" ? "pdf" : "anhang"}, ${values.number + (values.mime === "application/pdf" ? ".pdf" : ".jpg")},
          ${values.mime ?? "application/pdf"}, ${sha}, ${values.file.byteLength})`;
    }
    return row!.id as string;
  }

  let versteuerung = "ist";
  let kontenrahmen = "SKR03";
  const reset = async () => {
    await sql`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts, documents,
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

  for (const kr of ["SKR03", "SKR04"]) {
    for (const vs of ["ist", "soll"]) {
      it(`Teilzahlungen mit krummen Beträgen auf übernommene Rechnung und übernommenen Beleg, auch über den Jahreswechsel (${kr}, ${vs})`, async () => {
        versteuerung = vs;
        kontenrahmen = kr;
        await reset();
        const re = await legacyVoucher({
          type: "invoice",
          direction: "einnahme",
          number: "RE7",
          date: "2026-09-20",
          net: 33_333,
          tax: 6_333,
          file: PDF,
          contact: "Nordwerk Software GmbH",
        });
        const be = await legacyVoucher({
          type: "purchaseinvoice",
          direction: "ausgabe",
          number: "B-8",
          date: "2026-09-25",
          net: 5_001,
          tax: 950,
          file: JPEG,
          mime: "image/jpeg",
          category: "Bewirtung",
        });
        const ri = await legacy.takeOverLegacyItem(actor, re);
        const bi = await legacy.takeOverLegacyItem(actor, be);
        await bank.importStatement(
          actor,
          {
            bytes: dkbCsv([
              zeile("05.10.26", "Nordwerk Software GmbH", "RE7 Teil", "100,01", true),
              zeile("06.10.26", "Bürobedarf Schmidt KG", "B-8 Teil", "-33,33", false),
              zeile("05.01.27", "Nordwerk Software GmbH", "RE7 Rest", "296,65", true),
              zeile("06.01.27", "Bürobedarf Schmidt KG", "B-8 Rest", "-26,18", false),
            ]),
            filename: "a.csv",
          },
          null,
        );
        const txs = await sql<{ id: string; amount: number }[]>`select id, amount from bank_transactions`;
        const t = (a: number) => txs.find((x) => x.amount === a)!.id;
        await bank.allocate(actor, { kind: "invoice", transactionId: t(10_001), invoiceId: ri.id, amount: 10_001 });
        await bank.allocate(actor, { kind: "document", transactionId: t(-3_333), documentId: bi.id, amount: -3_333 });
        await bank.allocate(actor, { kind: "invoice", transactionId: t(29_665), invoiceId: ri.id, amount: 29_665 });
        await bank.allocate(actor, { kind: "document", transactionId: t(-2_618), documentId: bi.id, amount: -2_618 });
        await gleich(2026);
        await gleich(2027);
      }, 60_000);
    }
  }

  for (const vs of ["ist", "soll"]) {
    it(`Teilzahlung und Skonto auf übernommene Rechnung und übernommenen Beleg (${vs})`, async () => {
      versteuerung = vs;
      kontenrahmen = "SKR04";
      await reset();
      const re = await legacyVoucher({
        type: "invoice",
        direction: "einnahme",
        number: "RE9",
        date: "2026-09-20",
        net: 33_333,
        tax: 6_333,
        file: PDF,
        contact: "Nordwerk Software GmbH",
      });
      const be = await legacyVoucher({
        type: "purchaseinvoice",
        direction: "ausgabe",
        number: "B-9",
        date: "2026-09-25",
        net: 5_001,
        tax: 950,
        file: JPEG,
        mime: "image/jpeg",
      });
      const ri = await legacy.takeOverLegacyItem(actor, re);
      const bi = await legacy.takeOverLegacyItem(actor, be);
      await bank.importStatement(
        actor,
        {
          bytes: dkbCsv([
            zeile("05.10.26", "Nordwerk Software GmbH", "RE9", "387,77", true),
            zeile("06.10.26", "Bürobedarf Schmidt KG", "B-9", "-58,31", false),
          ]),
          filename: "s.csv",
        },
        null,
      );
      const txs = await sql<{ id: string; amount: number }[]>`select id, amount from bank_transactions`;
      const t = (a: number) => txs.find((x) => x.amount === a)!.id;
      await bank.allocate(actor, { kind: "invoice", transactionId: t(38_777), invoiceId: ri.id, amount: 38_777 });
      await bank.writeOff(actor, { kind: "skonto", invoiceId: ri.id, date: "2026-10-05" });
      await bank.allocate(actor, { kind: "document", transactionId: t(-5_831), documentId: bi.id, amount: -5_831 });
      await bank.writeOff(actor, { kind: "skontoErhalten", documentId: bi.id, date: "2026-10-06" });
      await gleich(2026);
    }, 60_000);
  }
});
