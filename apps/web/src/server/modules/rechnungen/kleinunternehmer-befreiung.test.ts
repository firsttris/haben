import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Kleinunternehmer mit eigener Steuerbefreiung (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let contactId: string;
  const actor = "steuerbefreiung-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    contacts = await import("../stammdaten/index.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries cascade`;
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

  const input = () => ({
    contactId,
    issueDate: "2026-10-02",
    serviceFrom: "2026-10-01",
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines: [{ description: "Heilbehandlung", quantity: 1000, unit: "Psch." as const, unitPrice: 10_000, taxRate: 0 as const }],
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("lässt die eigene Befreiung nach § 4 Nr. 14 a bei %s/%s zu", async (kontenrahmen, versteuerung) => {
    await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung}`;
    // § 4 Nr. 14 Buchst. a UStG: Eine entsprechend befreite Heilbehandlung verliert die eigene Befreiung nicht durch § 19.
    // https://www.gesetze-im-internet.de/ustg_1980/__4.html
    const draft = await invoices.createDraft(actor, {
      ...input(),
      taxTreatment: "steuerfrei",
      exemptionReason: "Steuerfreie Heilbehandlung nach § 4 Nr. 14 Buchst. a UStG.",
      ...{ taxDetails: { exemption: { number: "14", letter: "a" }, ancillary: null, foreignPlace: null, assetDisposal: false } },
    });

    expect(await invoices.finalizeIssues(draft.id)).toEqual([]);
  });

  it("lässt weiterhin eine gewöhnliche Rechnung nach § 19 ohne Umsatzsteuer zu", async () => {
    const draft = await invoices.createDraft(actor, { ...input(), taxTreatment: "kleinunternehmer" });
    expect(await invoices.finalizeIssues(draft.id)).toEqual([]);
  });

  it("speichert die Vorschrift getrennt vom bisherigen freien Hinweis", async () => {
    const taxDetails = { exemption: { number: "21", letter: null }, ancillary: null, foreignPlace: null, assetDisposal: false };
    const draft = await invoices.createDraft(actor, { ...input(), taxTreatment: "steuerfrei", exemptionReason: "", ...{ taxDetails } });
    expect(draft).toHaveProperty("taxDetails", taxDetails);
    expect(draft.exemptionReason).toBe("Steuerfreie Leistung nach § 4 Nr. 21 UStG.");
    expect(await invoices.finalizeIssues(draft.id)).toEqual([]);
  });

  it("deutet den alten freien §-4-Hinweis nicht automatisch als strukturierte Vorschrift um", async () => {
    const draft = await invoices.createDraft(actor, {
      ...input(),
      taxTreatment: "steuerfrei",
      exemptionReason: "Steuerfreie Heilbehandlung nach § 4 Nr. 14 Buchst. a UStG.",
    });
    expect(draft).toHaveProperty("taxDetails", null);
    expect((await invoices.finalizeIssues(draft.id)).some((issue) => issue.includes("Vorschrift"))).toBe(true);
  });

  it("behält die Zuordnung beim PATCH anderer Entwurfsfelder", async () => {
    const taxDetails = { exemption: { number: "21", letter: null }, ancillary: null, foreignPlace: null, assetDisposal: false };
    const draft = await invoices.createDraft(actor, { ...input(), taxTreatment: "steuerfrei", ...{ taxDetails } });
    const { lines } = (await invoices.getInvoice(draft.id))!;
    expect(invoices.draftInputOf(draft, lines)).toHaveProperty("taxDetails", taxDetails);
  });

  it("übernimmt die eigene Befreiung vom Angebot über die Rechnung bis zum Serienlauf", async () => {
    const taxDetails = { exemption: { number: "14", letter: "a" }, ancillary: null, foreignPlace: null, assetDisposal: false };
    const source = { ...input(), taxTreatment: "steuerfrei" as const, taxDetails };
    const quote = await invoices.createQuoteDraft(actor, { ...source, validUntil: "2026-11-01" });
    expect(await invoices.quoteIssues(quote.id)).toEqual([]);
    await invoices.finalizeQuote(actor, quote.id);
    const fromQuote = await invoices.quoteToInvoice(actor, quote.id, "2026-10-03");
    expect(fromQuote.taxDetails).toEqual(taxDetails);
    const final = await invoices.finalizeInvoice(actor, fromQuote.id);
    expect(final.exemptionReason).toBe("Steuerfreie Leistung nach § 4 Nr. 14 Buchst. a UStG.");
    expect(final.xml).toContain("Steuerfreie Leistung nach § 4 Nr. 14 Buchst. a UStG.");
    expect(final.pdf?.length).toBeGreaterThan(0);
    await expect(sql`update invoices set tax_details = null where id = ${final.id}`).rejects.toThrow();

    const recurring = await import("./recurring.ts");
    const series = await recurring.createRecurring(actor, {
      ...source,
      name: "Heilbehandlung monatlich",
      active: true,
      exemptionReason: "",
      intervalMonths: 1,
      nextDate: "2026-11-01",
      endDate: null,
      servicePeriod: "keiner",
      mode: "festschreiben",
    });
    expect(recurring.invoiceForDate(series, "2026-11-01").taxDetails).toEqual(taxDetails);
    expect((await recurring.runDueRecurring("2026-11-01")).created).toBe(1);
    const [row] = await sql`select status, tax_details, exemption_reason from invoices where recurring_id = ${series.id}`;
    expect(row?.status).toBe("final");
    expect(row?.tax_details).toEqual(taxDetails);
  });

  it("verhindert einen Umsatzsteuerausweis auch beim eigenen §-4-Angebot", async () => {
    const taxDetails = { exemption: { number: "14", letter: "a" }, ancillary: null, foreignPlace: null, assetDisposal: false };
    const quote = await invoices.createQuoteDraft(actor, {
      ...input(),
      validUntil: "2026-11-01",
      taxTreatment: "steuerfrei",
      taxDetails,
      lines: [{ ...input().lines[0]!, taxRate: 1900 }],
    });
    expect((await invoices.quoteIssues(quote.id)).some((issue) => issue.includes("0 %"))).toBe(true);
  });

  it("erlaubt dem Kleinunternehmer weiterhin keinen regulären Umsatzsteuerausweis", async () => {
    const draft = await invoices.createDraft(actor, {
      ...input(),
      taxTreatment: "regulaer",
      lines: [{ ...input().lines[0]!, taxRate: 1900 }],
    });
    expect((await invoices.finalizeIssues(draft.id)).some((issue) => issue.includes("Als Kleinunternehmer"))).toBe(true);
  });
});
