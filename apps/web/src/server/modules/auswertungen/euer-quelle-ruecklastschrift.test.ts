import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const ACCOUNT_IBAN = "DE89370400440532013000";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE89 3704 0044 0532 0130 00"\n""\n"Kontostand vom 20.11.2026:";"1.000,00 €"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
  return new TextEncoder().encode(`﻿${header}${columns}${body}\n`);
}

const row = (date: string, purpose: string, amount: string, incoming: boolean) => [
  date,
  date,
  "Gebucht",
  incoming ? "SEPA Lastschrifteinzug" : "Testfirma",
  incoming ? "Testfirma" : "Nordwerk Software GmbH",
  purpose,
  incoming ? "Eingang" : "Ausgang",
  incoming ? "" : "DE02120300000000202051",
  amount,
  "",
  "",
  "",
];

/** Konten je Kontenrahmen: Bank, Forderungen, Umsatzsteuer 19 %, Nebenkosten des Geldverkehrs */
describe.skipIf(!testDatabaseUrl)("EÜR aus dem Journal: Rücklastschrift im Stichjahr, mit und ohne Wechsel der Versteuerung (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let mandates: typeof import("../stammdaten/sepa-mandate.ts");
  let reports: typeof import("./reports.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    mandates = await import("../stammdaten/sepa-mandate.ts");
    reports = await import("./reports.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const [vorher, nachher] of [
      ["soll", "ist"],
      ["ist", "soll"],
      ["ist", "ist"],
      ["soll", "soll"],
    ] as const) {
      it(`${vorher} → ${nachher}: Lastschrift im Vorjahr, Rücklastschrift mit Entgelt und neue Zahlung im Stichjahr (${kontenrahmen})`, async () => {
        await leeren(sql)`truncate sepa_direct_debit_items, sepa_direct_debits, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
          journal_lines, journal_entries, invoice_lines, invoice_taxes, invoices, invoice_number_counters, sepa_mandate_files,
          sepa_mandate_revocations, sepa_mandates, contact_versions, contacts, company cascade`;
        await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank, telefon, glaeubiger_id, kontenrahmen, versteuerung, journal_ab)
          values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
                  ${ACCOUNT_IBAN}, 'COBADEFFXXX', 'Commerzbank', '0941 123456', 'DE98ZZZ09999999999', ${kontenrahmen}, ${vorher}, 2026)`;
        const accountId = (await bank.createAccount(actor, { name: "Geschäftskonto", iban: ACCOUNT_IBAN })).id;
        const contactId = (
          await contacts.createContact(actor, {
            kundennummer: "",
            name: "Nordwerk Software GmbH",
            strasse: "Hafenstraße 5",
            plz: "20457",
            ort: "Hamburg",
            land: "DE",
            email: "rechnung@nordwerk.example",
            ustId: "",
            iban: "DE02120300000000202051",
            leitwegId: "",
            defaultFormat: null,
          })
        ).id;
        const mandateId = await mandates.createMandate(
          actor,
          contactId,
          {
            reference: "KD-1042-01",
            signedOn: "2025-10-01",
            scheme: "CORE",
            firstSequence: "FRST",
            debtorName: "Nordwerk Software GmbH",
            debtorIban: "DE02120300000000202051",
          },
          "2025-11-09",
        );
        const invoice = async (net: number) =>
          invoices.finalizeInvoice(
            actor,
            (
              await invoices.createDraft(actor, {
                contactId,
                issueDate: "2025-11-02",
                serviceFrom: null,
                serviceTo: null,
                paymentTermDays: 14,
                format: "zugferd",
                note: "",
                lines: [{ description: "Wartung", quantity: 1000, unit: "Monat", unitPrice: net, taxRate: 1900 }],
                paymentMethod: "lastschrift",
                sepaMandateId: mandateId,
              })
            ).id,
          );
        const a = await invoice(25_001);
        const b = await invoice(10_000);
        await bank.createDirectDebitFile(actor, { bankAccountId: accountId, invoiceIds: [a.id, b.id] }, new Date("2025-11-09T08:00:00Z"));
        const imp = async (rows: string[][]) => bank.importStatement(actor, { bytes: dkbCsv(rows), filename: `${Math.random()}.csv` }, null);
        const on = async (date: string) => (await sql`select id from bank_transactions where booking_date = ${date}`)[0]!.id as string;
        await imp([row("16.11.25", "SEPA-Lastschrift Sammler", "416,51", true)]);
        await bank.allocateDirectDebitBatch(actor, await on("2025-11-16"));
        await sql`update company set versteuerung = ${nachher} where id = 1`;
        await imp([row("12.01.26", `RUECKLASTSCHRIFT AM04 KD-1042-01 Rechnung ${a.number}`, "-300,51", false)]);
        await bank.allocateDirectDebitReturn(actor, await on("2026-01-12"));
        await imp([row("20.02.26", `Rechnung ${a.number} Teil`, "100,01", true)]);
        await bank.allocate(actor, { kind: "invoice", transactionId: await on("2026-02-20"), invoiceId: a.id, amount: 10_001 });
        expect(await reports.euerForYear(2026)).toEqual(await reports.euerAusNebenbuechern(2026));
      }, 60_000);
    }
  }
});
