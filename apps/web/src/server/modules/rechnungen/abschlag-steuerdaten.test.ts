import type { OutgoingTaxDetails, TaxTreatment } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Steuerzuordnung von Abschlag und Schlussrechnung (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let contactId: string;
  const actor = "abschlag-steuerdaten-test";
  const details = (exemption: OutgoingTaxDetails["exemption"], country?: string): OutgoingTaxDetails => ({
    exemption,
    ancillary: null,
    foreignPlace: country ? { country, noForeignVat: true } : null,
    assetDisposal: false,
  });
  const heilbehandlung = details({ number: "14", letter: "a" });
  const unterricht = details({ number: "21", letter: null });

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries cascade`;
    await sql`insert into company (id,name,strasse,plz,ort,email,telefon,steuernummer,ust_id,bundesland,iban,journal_ab)
      values (1,'Musterbetrieb','Musterstraße 1','93047','Regensburg','firma@example.com','0941 1','198/113/10010',
      'DE123456789','BY','DE89370400440532013000',2026)`;
    const contacts = await import("../stammdaten/index.ts");
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001",
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

  const input = (taxDetails: OutgoingTaxDetails | null, taxTreatment: TaxTreatment = "steuerfrei", amount = 10_000) => ({
    contactId,
    issueDate: "2026-10-02",
    serviceFrom: "2026-10-01",
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    taxTreatment,
    exemptionReason: "Steuerfreie Leistung laut bisherigem Belegtext.",
    taxDetails,
    lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: amount, taxRate: 0 as const }],
  });
  const advance = async (taxDetails: OutgoingTaxDetails | null, treatment?: TaxTreatment) => {
    const draft = await invoices.createDraft(actor, { ...input(taxDetails, treatment), variant: "abschlag" });
    return invoices.finalizeInvoice(actor, draft.id);
  };
  const finalInput = (id: string, taxDetails: OutgoingTaxDetails | null, treatment?: TaxTreatment) => ({
    ...input(taxDetails, treatment, 50_000),
    variant: "schluss" as const,
    deducts: [id],
  });

  it.each([unterricht, details({ number: "14", letter: "b" })])("vermischt einen §-4-Abschlag nicht mit der anderen Vorschrift %j", async (other) => {
    const original = await advance(heilbehandlung);
    await expect(invoices.createDraft(actor, finalInput(original.id, other))).rejects.toThrow(/andere.*Befreiungsvorschrift/);
    expect((await sql`select id from invoices`).map((r) => r.id)).toEqual([original.id]);
  });

  it("behält beim abgewiesenen Wechsel im Schlussrechnungsentwurf die bisherige Vorschrift", async () => {
    const original = await advance(heilbehandlung);
    const draft = await invoices.createDraft(actor, finalInput(original.id, heilbehandlung));
    await expect(invoices.updateDraft(actor, draft.id, finalInput(original.id, unterricht))).rejects.toThrow(/andere.*Befreiungsvorschrift/);
    expect((await invoices.getInvoice(draft.id))!.invoice.taxDetails).toEqual(heilbehandlung);
  });

  it("prüft die Vorschrift auch beim Festschreiben und erzeugt bei einem Widerspruch weder Nummer noch Buchung", async () => {
    const original = await advance(heilbehandlung);
    const draft = await invoices.createDraft(actor, finalInput(original.id, heilbehandlung));
    // Eine Entwurfsänderung außerhalb der normalen Maske darf die erneute Prüfung nicht umgehen.
    await sql`update invoices set tax_details = ${JSON.stringify(unterricht)}::jsonb where id = ${draft.id}`;
    expect((await invoices.finalizeIssues(draft.id)).some((issue) => /andere.*Befreiungsvorschrift/.test(issue))).toBe(true);
    await expect(invoices.finalizeInvoice(actor, draft.id)).rejects.toThrow(/andere.*Befreiungsvorschrift/);
    const [stored] = await sql`select status, number from invoices where id = ${draft.id}`;
    expect(stored).toEqual({ status: "draft", number: null });
    expect(await sql`select id from journal_entries where source_id = ${draft.id}`).toHaveLength(0);
  });

  it("zieht einen Abschlag mit derselben Vorschrift ab und lässt das festgeschriebene Original unverändert", async () => {
    const original = await advance(heilbehandlung);
    const [before] = await sql`select to_jsonb(i) as row from invoices i where id = ${original.id}`;
    const draft = await invoices.createDraft(actor, finalInput(original.id, heilbehandlung));
    expect(await invoices.finalizeIssues(draft.id)).toEqual([]);
    const final = await invoices.finalizeInvoice(actor, draft.id);
    expect(final).toMatchObject({ status: "final", taxDetails: heilbehandlung, net: 40_000, tax: 0, gross: 40_000 });
    expect((await sql`select to_jsonb(i) as row from invoices i where id = ${original.id}`)[0]).toEqual(before);
  });

  it("vermischt bei gleicher EU-Behandlung nicht zwei ausdrücklich erfasste Leistungsorte", async () => {
    const original = await advance(details(null, "AT"), "eu_sonstige");
    await expect(invoices.createDraft(actor, finalInput(original.id, details(null, "FR"), "eu_sonstige"))).rejects.toThrow(/anderen.*Leistungsort/);
  });

  it("lässt den ungeklärten Altabschlag abziehen, ohne seine Vorschrift aus Freitext oder Schlussrechnung zu ergänzen", async () => {
    const original = await advance(null);
    const [before] = await sql`select to_jsonb(i) as row from invoices i where id = ${original.id}`;
    const draft = await invoices.createDraft(actor, finalInput(original.id, unterricht));
    const final = await invoices.finalizeInvoice(actor, draft.id);
    expect(final).toMatchObject({ status: "final", taxDetails: unterricht, gross: 40_000 });
    expect((await sql`select to_jsonb(i) as row from invoices i where id = ${original.id}`)[0]).toEqual(before);
    expect((await invoices.getInvoice(original.id))!.invoice.taxDetails).toBeNull();
  });
});
