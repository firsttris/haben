import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

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
  let annual: typeof import("../jahreserklaerung/annual.ts");
  const actor = "review-926";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    contacts = await import("../stammdaten/index.ts");
    cashInvoice = await import("../bank/cash-invoice.ts");
    reports = await import("../auswertungen/reports.ts");
    annual = await import("../jahreserklaerung/annual.ts");
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
    const final = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    await cashInvoice.createCashInvoiceEntry(actor, { invoiceId: final.id, date: "2026-10-10", amount: 100_00 }, "2026-10-10");

    expect((await annual.euerYear(2026)).figures).toMatchObject({ kleinunternehmer: 100_00, kleinunternehmerAbzuege: 100_00 });
    const euer = await reports.euerForYear(2026);
    const betrag = (key: string) => euer.einnahmen.find((l) => l.key === key)?.amount ?? 0;
    expect({ kleinunternehmer: betrag("einnahmenKleinunternehmer"), steuerfrei: betrag("einnahmenSteuerfrei") }).toEqual({
      kleinunternehmer: 100_00,
      steuerfrei: 0,
    });
  });

  it.each([
    ["steuerfrei", "DE", { number: "21" }],
    ["drittland", "US", null],
    ["reverse_charge", "FR", null],
    ["eu_sonstige", "FR", null],
  ] as const)("%s: Zeilen 12 und 13 mit tatsächlichem Zufluss", async (treatment, country, exemption) => {
    await sql`update company set ust_id = 'DE123456789'`;
    await sql`update contacts set land = ${country}, ust_id = ${treatment === "reverse_charge" ? "FR40303265045" : ""} where id = ${contactId}`;
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-10-02",
      serviceFrom: "2026-10-01",
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment: treatment,
      exemptionReason: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch.", unitPrice: 100_00, taxRate: 0 }],
      taxDetails: { exemption, ancillary: null, foreignPlace: country === "DE" ? null : { country, noForeignVat: true }, assetDisposal: false },
    });
    const final = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    await cashInvoice.createCashInvoiceEntry(actor, { invoiceId: final.id, date: "2026-10-10", amount: 100_00 }, "2026-10-10");
    const result = await annual.euerYear(2026);
    expect(result.figures).toMatchObject({ kleinunternehmer: 100_00, kleinunternehmerAbzuege: 100_00 });
    expect(result.figures.steuerfrei ?? 0).toBe(0);
    expect(result.einnahmen).toBe(100_00);
    expect(result.gewinn).toBe(100_00);
  });

  it("Teilzahlungen über den Jahreswechsel behalten den jeweiligen KU-Stand", async () => {
    // Das Protokoll datiert den Wechsel auf den heutigen Tag. Das Vorjahr liegt sicher davor, das Folgejahr danach.
    const year = new Date().getUTCFullYear();
    await sql`update company set kleinunternehmer = false`;
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: `${year - 1}-10-02`,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment: "steuerfrei",
      exemptionReason: "",
      lines: [{ description: "Heilbehandlung", quantity: 1000, unit: "Psch.", unitPrice: 100_00, taxRate: 0 }],
      taxDetails: { exemption: { number: "14", letter: "a" }, ancillary: null, foreignPlace: null, assetDisposal: false },
    });
    const final = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    for (const [date, amount] of [
      [`${year - 1}-10-10`, 30_00],
      [`${year + 1}-01-10`, 70_00],
    ] as const)
      await cashInvoice.createCashInvoiceEntry(actor, { invoiceId: final.id, date, amount }, date);
    const before = await annual.euerYear(year - 1);
    const after = await annual.euerYear(year + 1);
    expect(before.figures).toMatchObject({ kleinunternehmer: 30_00, kleinunternehmerAbzuege: 30_00 });
    expect(before.figures.steuerfrei ?? 0).toBe(0);
    expect(after.figures.steuerfrei).toBe(70_00);
    expect(after.figures.kleinunternehmer ?? 0).toBe(0);
    expect(after.figures.kleinunternehmerAbzuege ?? 0).toBe(0);
    expect(before.gewinn + after.gewinn).toBe(100_00);
  });
});
