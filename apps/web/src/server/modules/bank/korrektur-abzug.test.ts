import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

// Der Kunde zahlt „Rechnung minus Korrektur“ (#1398): Die offene Korrektur steht an der Rechnung, die Aufteilung auf
// beide macht Rechnung und Korrektur bezahlt
describe.skipIf(!testDatabaseUrl)("Zahlung „Rechnung minus Korrektur“ im Abgleich (Postgres, #1398)", () => {
  let bank: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  let contactId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Testkunde",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "kunde@example.com",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  });

  const draft = (unitPrice: number, issueDate: string) => ({
    contactId,
    issueDate,
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines: [{ description: "Wartung", quantity: 1000, unit: "Psch.", unitPrice, taxRate: 1900 as const }],
  });

  function statement(amount: string) {
    const head = '"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom 20.11.2026:";"95,20 €"\n""\n';
    const columns =
      '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n';
    const row = ["16.11.26", "16.11.26", "Gebucht", "Testkunde", "Testfirma", "Zahlung Wartung", "Eingang", "", amount, "", "", ""];
    return new TextEncoder().encode(`﻿${head}${columns}${row.map((v) => `"${v}"`).join(";")}\n`);
  }

  async function rechnungMitKorrektur() {
    const rechnung = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft(10_000, "2026-11-02"))).id, kleinunternehmerStand);
    const entwurf = await invoices.createDraft(actor, draft(-2000, "2026-11-05"), { kind: "korrektur", correctsId: rechnung.id });
    const korrektur = await invoices.finalizeInvoice(actor, entwurf.id, kleinunternehmerStand);
    return { rechnung, korrektur };
  }

  it("liefert die offene Korrektur an der Rechnung mit, mit dem Vorzeichen der Erstattung", async () => {
    const { rechnung, korrektur } = await rechnungMitKorrektur();
    const items = await bank.openItems();
    const original = items.find((item) => item.id === rechnung.id);
    expect(original?.openCorrections).toEqual([{ id: korrektur.id, number: korrektur.number, open: -2380 }]);
    expect(items.find((item) => item.id === korrektur.id)?.openCorrections).toBeUndefined();
  }, 30_000);

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)(
    "ordnet die Zahlung auf Rechnung und Korrektur auf (%s, %s); danach ist beides bezahlt und nichts ausgebucht",
    async (kontenrahmen, versteuerung) => {
      await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung}`;
      const { rechnung, korrektur } = await rechnungMitKorrektur();
      await bank.importStatement(actor, { bytes: statement("95,20"), filename: "a.csv" }, null);
      const [payment] = await sql`select id from bank_transactions where amount = 9520`;
      await bank.allocateSplit(actor, {
        transactionId: payment!.id,
        parts: [
          { kind: "invoice", invoiceId: rechnung.id, amount: 11_900 },
          { kind: "invoice", invoiceId: korrektur.id, amount: -2380 },
        ],
      });
      const offen = (await bank.openItems()).filter((item) => item.id === rechnung.id || item.id === korrektur.id);
      expect(offen).toEqual([]);
      expect(await sql`select id from write_offs`).toHaveLength(0);
    },
    30_000,
  );

  it("liefert eine schon bezahlte Korrektur nicht mehr an der Rechnung", async () => {
    const { rechnung, korrektur } = await rechnungMitKorrektur();
    await bank.importStatement(actor, { bytes: statement("-23,80"), filename: "b.csv" }, null);
    const [refund] = await sql`select id from bank_transactions where amount = -2380`;
    await bank.allocate(actor, { kind: "invoice", transactionId: refund!.id, invoiceId: korrektur.id, amount: -2380 });
    const original = (await bank.openItems()).find((item) => item.id === rechnung.id);
    expect(original?.openCorrections).toBeUndefined();
  }, 30_000);
});
