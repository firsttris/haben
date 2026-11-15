import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Kleinunternehmer mit eigener Steuerbefreiung (§ 4 Nr. 14 Buchst. a oder Nr. 21 UStG) in der Anlage EÜR:
 * Kleinunternehmer tragen ihre vollständigen Betriebseinnahmen in Zeile 12 ein, die Zeilen 15 bis 17 sind von ihnen
 * in der Regel nicht zu verwenden; die nach § 19 Abs. 2 Satz 1 Nr. 1 abzuziehenden Umsätze stehen nur nachrichtlich in
 * Zeile 13. Amtliche Anleitung zur Anlage EÜR 2025, Zeilen 12 und 13:
 * https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
 */
describe.skipIf(!testDatabaseUrl)("Kleinunternehmer mit § 4 Nr. 14 a in der EÜR (Postgres, Review #926)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let cashInvoice: typeof import("../bank/cash-invoice.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let contactId: string;
  const actor = "review-926";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    contacts = await import("../stammdaten/index.ts");
    cashInvoice = await import("../bank/cash-invoice.ts");
    reports = await import("../auswertungen/reports.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, cash_entries, allocations, journal_entries cascade`;
    await sql`insert into company (id,name,strasse,plz,ort,email,telefon,steuernummer,ust_id,bundesland,iban,kleinunternehmer,journal_ab)
      values (1,'Musterpraxis','Musterstraße 1','93047','Regensburg','praxis@example.com','0941 1','198/113/10010',
      '','BY','DE89370400440532013000',true,2026)`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Musterkunde",
        strasse: "Beispielstraße 2",
        plz: "93047",
        ort: "Regensburg",
        land: "DE",
        email: "kunde@example.com",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s/%s: bezahlte Heilbehandlung steht in Zeile 12, nicht unter den umsatzsteuerfreien Einnahmen", async (kontenrahmen, versteuerung) => {
    await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung}`;
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-10-02",
      serviceFrom: "2026-10-01",
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Heilbehandlung", quantity: 1000, unit: "Psch.", unitPrice: 100_00, taxRate: 0 }],
      taxTreatment: "steuerfrei",
      exemptionReason: "",
      ...{ taxDetails: { exemption: { number: "14", letter: "a" }, ancillary: null, foreignPlace: null, assetDisposal: false } },
    });
    const final = await invoices.finalizeInvoice(actor, draft.id);
    await cashInvoice.createCashInvoiceEntry(actor, { invoiceId: final.id, date: "2026-10-10", amount: 100_00 }, "2026-10-10");

    const euer = await reports.euerForYear(2026);
    const betrag = (key: string) => euer.einnahmen.find((l) => l.key === key)?.amount ?? 0;
    expect({ kleinunternehmer: betrag("einnahmenKleinunternehmer"), steuerfrei: betrag("einnahmenSteuerfrei") }).toEqual({
      kleinunternehmer: 100_00,
      steuerfrei: 0,
    });
  });
});
