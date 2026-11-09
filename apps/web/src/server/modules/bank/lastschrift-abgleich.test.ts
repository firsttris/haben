import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

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
const ACCOUNTS = {
  SKR03: { bank: "1200", forderungen: "1400", ust: "1776", gebuehren: "4970" },
  SKR04: { bank: "1800", forderungen: "1200", ust: "3806", gebuehren: "6855" },
} as const;

describe.skipIf(!testDatabaseUrl)("Lastschriften im Bankabgleich: Sammelgutschrift und Rücklastschrift (Postgres, #445)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let mandates: typeof import("../stammdaten/sepa-mandate.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    mandates = await import("../stammdaten/sepa-mandate.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate sepa_direct_debit_items, sepa_direct_debits, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, invoice_lines, invoice_taxes, invoices, invoice_number_counters, sepa_mandate_files,
      sepa_mandate_revocations, sepa_mandates, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank, telefon, glaeubiger_id, kontenrahmen, versteuerung)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              ${ACCOUNT_IBAN}, 'COBADEFFXXX', 'Commerzbank', '0941 123456', 'DE98ZZZ09999999999', ${kontenrahmen}, ${versteuerung})`;
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
        signedOn: "2026-10-01",
        scheme: "CORE",
        firstSequence: "FRST",
        debtorName: "Nordwerk Software GmbH",
        debtorIban: "DE02120300000000202051",
      },
      "2026-11-09",
    );
    const invoice = async (net: number) =>
      invoices.finalizeInvoice(
        actor,
        (
          await invoices.createDraft(actor, {
            contactId,
            issueDate: "2026-11-02",
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
    const a = await invoice(25_000);
    const b = await invoice(10_000);
    await bank.createDirectDebitFile(actor, { bankAccountId: accountId, invoiceIds: [a.id, b.id] }, new Date("2026-11-09T08:00:00Z"));
    return { a, b, mandateId };
  }

  async function importRows(rows: string[][]) {
    await bank.importStatement(actor, { bytes: dkbCsv(rows), filename: `${Math.random()}.csv` }, null);
  }

  async function transactionOn(date: string) {
    const [tx] = await sql`select id from bank_transactions where booking_date = ${date}`;
    return tx!.id as string;
  }

  async function open(invoiceId: string) {
    const paid = (await bank.invoicePayments([invoiceId])).get(invoiceId) ?? 0;
    const [inv] = await sql`select gross from invoices where id = ${invoiceId}`;
    return Number(inv!.gross) - paid;
  }

  /** Summen je Konto der Buchungen zu den Zuordnungen eines Umsatzes (Soll minus Haben) */
  async function saldenFuer(transactionId: string) {
    const rows = await sql`select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join allocations a on a.id = e.source_id and e.source_type = 'allocation'
      where a.transaction_id = ${transactionId} group by l.account`;
    return Object.fromEntries(rows.map((r) => [r.account, r.saldo]));
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      describe(`${kontenrahmen}, ${versteuerung === "ist" ? "Ist" : "Soll"}`, () => {
        const k = ACCOUNTS[kontenrahmen];
        let a: Awaited<ReturnType<typeof setup>>["a"];
        let b: Awaited<ReturnType<typeof setup>>["b"];

        beforeEach(async () => {
          ({ a, b } = await setup(kontenrahmen, versteuerung));
        });

        it("teilt die Sammelgutschrift auf die Rechnungen auf und bucht jede Zahlung", async () => {
          await importRows([row("16.11.26", "SEPA-Lastschrift Sammler", "416,50", true)]);
          const txId = await transactionOn("2026-11-16");
          const detail = await bank.transactionDetail(txId);
          expect(detail?.lastschrift).toMatchObject({
            kind: "sammler",
            parts: [
              { invoiceId: a.id, number: a.number, amount: 29_750 },
              { invoiceId: b.id, number: b.number, amount: 11_900 },
            ],
          });
          await bank.allocateDirectDebitBatch(actor, txId);
          expect(await open(a.id)).toBe(0);
          expect(await open(b.id)).toBe(0);
          const salden = await saldenFuer(txId);
          expect(salden[k.bank]).toBe(41_650);
          expect(salden[k.forderungen]).toBe(-41_650);
          // Ist: Mit dem Zahlungseingang wird die Umsatzsteuer fällig (umgebucht auf das Konto der fälligen Steuer)
          if (versteuerung === "ist") expect(salden[k.ust]).toBe(-(4_750 + 1_900));
          else expect(salden[k.ust]).toBeUndefined();
          expect((await bank.transactionDetail(txId))?.lastschrift).toBeNull();
        });

        it("Rücklastschrift mit Entgelt: Rechnung wieder offen, Gebühr als Nebenkosten des Geldverkehrs, danach wieder einziehbar", async () => {
          await importRows([row("16.11.26", "SEPA-Lastschrift Sammler", "416,50", true)]);
          await bank.allocateDirectDebitBatch(actor, await transactionOn("2026-11-16"));
          await importRows([row("20.11.26", `RUECKLASTSCHRIFT AM04 KD-1042-01 Rechnung ${a.number}`, "-300,50", false)]);
          const txId = await transactionOn("2026-11-20");
          const detail = await bank.transactionDetail(txId);
          expect(detail?.lastschrift).toMatchObject({
            kind: "ruecklastschrift",
            invoiceId: a.id,
            number: a.number,
            amount: 29_750,
            fee: 300,
            reason: { code: "AM04", text: "Rückgabe mangels Deckung" },
          });
          await bank.allocateDirectDebitReturn(actor, txId);
          expect(await open(a.id)).toBe(29_750);
          expect(await open(b.id)).toBe(0);
          const salden = await saldenFuer(txId);
          expect(salden[k.bank]).toBe(-30_050);
          expect(salden[k.forderungen]).toBe(29_750);
          expect(salden[k.gebuehren]).toBe(300);
          // Ist: Die Umsatzsteuer ist mit der Rückgabe nicht mehr vereinnahmt und geht zurück
          if (versteuerung === "ist") expect(salden[k.ust]).toBe(4_750);
          else expect(salden[k.ust]).toBeUndefined();
          // Die Rechnung steht wieder unter Lastschriften, jetzt als Folgelastschrift
          const candidates = await bank.directDebitCandidates("2026-11-20");
          expect(candidates.map((c) => [c.invoiceId, c.sequence])).toEqual([[a.id, "RCUR"]]);
          expect((await bank.transactionDetail(txId))?.lastschrift).toBeNull();
        });

        it("Aufheben der Rücklastschrift: die Rechnung ist wieder bezahlt und wird nicht neu eingezogen", async () => {
          await importRows([row("16.11.26", "SEPA-Lastschrift Sammler", "416,50", true)]);
          await bank.allocateDirectDebitBatch(actor, await transactionOn("2026-11-16"));
          await importRows([row("20.11.26", `Rücklastschrift Rechnung ${a.number}`, "-297,50", false)]);
          const txId = await transactionOn("2026-11-20");
          await bank.allocateDirectDebitReturn(actor, txId);
          const [allocation] = await sql`select id from allocations where transaction_id = ${txId} and reverses_id is null`;
          await bank.reverseAllocation(actor, allocation!.id);
          expect(await open(a.id)).toBe(0);
          expect(await bank.directDebitCandidates("2026-11-20")).toEqual([]);
        });
      });
    }
  }

  it("lehnt eine Rücklastschrift ab, die nicht zum Umsatz passt", async () => {
    const { a } = await setup("SKR03", "ist");
    await importRows([row("16.11.26", "Überweisung", "-50,00", false)]);
    await expect(bank.allocateDirectDebitReturn(actor, await transactionOn("2026-11-16"))).rejects.toThrow(
      "Zu diesem Umsatz passt keine zurückgegebene Lastschrift.",
    );
    expect(await open(a.id)).toBe(29_750);
  });
});
