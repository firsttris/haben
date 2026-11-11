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

/*
 * EÜR ab dem Stichjahr aus dem Journal (#542, docs/adr/journal-als-quelle.md, Entscheidung 3): euerForYear rechnet aus dem
 * Journal (euer-quelle.ts), die Nebenbücher sind die Gegenprobe im Abgleich. Gleiche Zeilen, gleicher Gewinn, gleiche Monate.
 */
describe.skipIf(!testDatabaseUrl)("EÜR aus dem Journal: nur im Einzelunternehmen, ohne leere Zeilen (Postgres)", () => {
  let reports: typeof import("./reports.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    reports = await import("./reports.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
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

  for (const [kr, konto, rueckstellung] of [
    ["SKR03", "4955", "0970"],
    ["SKR04", "6830", "3070"],
  ] as const) {
    it(`GmbH: Rückstellung im Jahresabschluss (manuelle Buchung) ist keine Ausgabe nach Zahlung (${kr})`, async () => {
      await reset("soll", kr, false, "gmbh");
      await manual.createManualEntry(
        actor,
        {
          date: "2026-12-31",
          description: "Rückstellung Abschlusskosten",
          lines: [
            { account: konto, debit: 150_000, credit: 0 },
            { account: rueckstellung, debit: 0, credit: 150_000 },
          ],
        },
        "2027-01-15",
      );
      const euer = await reports.euerForYear(2026);
      expect(euer.ausgaben.map((l) => l.key)).not.toContain("ausgabe:buchfuehrung");
      expect(euer.gewinn).toBe(0);
      expect(euer.monthly.ausgaben[11]).toBe(0);
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
    await bank.reverseAllocation(actor, alloc!.id);
    const euer = await reports.euerForYear(2026);
    expect(euer.einnahmen.map((l) => l.key)).not.toContain("einnahmenKleinunternehmer");
  }, 60_000);
});
