import type { OutgoingTaxDetails, TaxTreatment } from "@haben/core";
import { sql as query } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Produktgrenze aus https://github.com/firsttris/haben/issues/433#issuecomment-6853419682:
// keine verschiedenen bekannten Befreiungen in einer Schlussrechnung, auch bei ungeklärten Altdaten.
// § 4 Nr. 14 a und Nr. 21: https://www.gesetze-im-internet.de/ustg_1980/__4.html
// Daraus folgt kein allgemeines gesetzliches Mischungsverbot.
describe.skipIf(!testDatabaseUrl)("Review #926: Konflikte zwischen mehreren Abschlägen", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let contactId: string;
  const actor = "review-926-abschlag";
  const details = (number: string, letter: string | null): OutgoingTaxDetails => ({
    exemption: { number, letter },
    ancillary: null,
    foreignPlace: null,
    assetDisposal: false,
  });
  const partial: OutgoingTaxDetails = { exemption: null, ancillary: false, foreignPlace: null, assetDisposal: false };
  const foreign = (country: string): OutgoingTaxDetails => ({ ...partial, foreignPlace: { country, noForeignVat: true } });
  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries cascade`;
    await sql`insert into company(id,name,strasse,plz,ort,email,telefon,steuernummer,ust_id,bundesland,iban,journal_ab)
      values(1,'Testbetrieb','Testweg 1','93047','Regensburg','firma@example.com','0941 1','198/113/10010',
      'DE123456789','BY','DE89370400440532013000',2026)`;
    const contacts = await import("../stammdaten/index.ts");
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001",
        name: "Testkunde",
        strasse: "Testweg 2",
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

  const input = (taxDetails: OutgoingTaxDetails | null, amount: number, taxTreatment: TaxTreatment = "steuerfrei") => ({
    contactId,
    issueDate: "2026-10-02",
    serviceFrom: "2026-10-01",
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    taxTreatment,
    exemptionReason: "Steuerfreie Leistung gemäß vorhandenem Belegtext.",
    taxDetails,
    lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: amount, taxRate: 0 as const }],
  });

  async function advance(taxDetails: OutgoingTaxDetails | null, treatment?: TaxTreatment) {
    const draft = await invoices.createDraft(actor, { ...input(taxDetails, 10_000, treatment), variant: "abschlag" });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function advances() {
    const first = await advance(details("14", "a"));
    const second = await advance(details("21", null));
    return { ...input(null, 50_000), variant: "schluss" as const, deducts: [first.id, second.id] };
  }

  it("lehnt zwei bekannte verschiedene Vorschriften auch bei ungeklärter Schlussvorschrift ab", async () => {
    await expect(invoices.createDraft(actor, await advances())).rejects.toThrow(/andere.*Befreiungsvorschrift/);
  });

  it("schreibt die widersprüchlichen Abschläge auch bei ungeklärter Schlussvorschrift nicht fest", async () => {
    const all = await advances();
    const final = await invoices.createDraft(actor, { ...all, deducts: [all.deducts[0]!] });
    // Vorhandener Legacy-Entwurf: Die Fixture durchläuft nicht den zu prüfenden Create-Guard.
    // Nur Entwurf und seine gespeicherten Summen ergänzen; die festgeschriebenen Abschläge bleiben unverändert.
    const { withActor } = await import("../../db/actor.ts");
    await withActor(actor, async (tx) => {
      await tx.execute(query`insert into invoice_lines
        (invoice_id, position, description, quantity, unit, unit_price, tax_rate, net, deduction_of)
        select l.invoice_id, l.position + 1, replace(l.description, a.number, b.number),
          l.quantity, l.unit, l.unit_price, l.tax_rate, l.net, b.id
        from invoice_lines l
        join invoices a on a.id = l.deduction_of
        join invoices b on b.id = ${all.deducts[1]!}
        where l.invoice_id = ${final.id} and l.deduction_of = ${all.deducts[0]!}`);
      await tx.execute(query`update invoices set net = net - 10000, gross = gross - 10000 where id = ${final.id}`);
      await tx.execute(query`update invoice_taxes set base = base - 10000 where invoice_id = ${final.id} and rate = 0`);
    });
    expect((await invoices.getInvoice(final.id))!.invoice).toMatchObject({ status: "draft", net: 30_000, tax: 0, gross: 30_000 });
    const error: unknown = await invoices.finalizeInvoice(actor, final.id).catch((caught: unknown) => caught);
    expect({ rejected: error instanceof invoices.InvoiceError, status: (await invoices.getInvoice(final.id))!.invoice.status }).toEqual({
      rejected: true,
      status: "draft",
    });
    expect((await invoices.finalizeIssues(final.id)).some((issue) => /andere.*Befreiungsvorschrift/.test(issue))).toBe(true);
    expect((await invoices.getInvoice(final.id))!.invoice.number).toBeNull();
    expect(await sql`select id from journal_entries where source_id = ${final.id}`).toHaveLength(0);
  });

  it("behält beim abgewiesenen Hinzufügen eines widersprüchlichen Abschlags den bisherigen Entwurf", async () => {
    const all = await advances();
    const draft = await invoices.createDraft(actor, { ...all, deducts: [all.deducts[0]!] });
    const before = await invoices.getInvoice(draft.id);
    await expect(invoices.updateDraft(actor, draft.id, all)).rejects.toThrow(/andere.*Befreiungsvorschrift/);
    expect(await invoices.getInvoice(draft.id)).toEqual(before);
  });

  it.each([null, partial])("lässt ungeklärte Angaben %j vor zwei bekannten Vorschriften den Konflikt nicht verdecken", async (unknown) => {
    const legacy = await advance(unknown);
    const all = await advances();
    await expect(invoices.createDraft(actor, { ...all, taxDetails: unknown, deducts: [legacy.id, ...all.deducts] })).rejects.toThrow(
      /andere.*Befreiungsvorschrift/,
    );
  });

  it("vergleicht bekannte Leistungsorte auch bei ungeklärten Angaben der Schlussrechnung und des ersten Abschlags", async () => {
    const { withActor } = await import("../../db/actor.ts");
    await withActor(actor, (tx) => tx.execute(query`update contacts set land = 'CH' where id = ${contactId}`));
    const legacy = await advance(partial, "drittland");
    const first = await advance(foreign("CH"), "drittland");
    const second = await advance(foreign("US"), "drittland");
    await expect(
      invoices.createDraft(actor, { ...input(partial, 50_000, "drittland"), variant: "schluss", deducts: [legacy.id, first.id, second.id] }),
    ).rejects.toThrow(/anderen.*Leistungsort/);
  });

  it.each([
    { name: "ungeklärter Altabschlag", first: null, final: null },
    { name: "gleiche bekannte Vorschriften", first: details("14", "a"), final: null },
    { name: "nur Hilfsumsatz bekannt", first: partial, final: partial },
    { name: "bekannte Schlussvorschrift", first: null, final: details("14", "a") },
  ])("erhält kompatible Abschläge bei Erstellung, Änderung und Festschreibung: $name", async ({ first, final }) => {
    const original = await advance(first);
    const known = await advance(details("14", "a"));
    const before = await sql`select to_jsonb(i) as row from invoices i where id in (${original.id}, ${known.id}) order by id`;
    const all = { ...input(final, 50_000), variant: "schluss" as const, deducts: [original.id, known.id] };
    const draft = await invoices.createDraft(actor, all);
    await invoices.updateDraft(actor, draft.id, { ...all, note: "Ergänzte Notiz" });
    expect(await invoices.finalizeIssues(draft.id)).toEqual([]);
    expect(await invoices.finalizeInvoice(actor, draft.id)).toMatchObject({ status: "final", taxDetails: final, net: 30_000, tax: 0, gross: 30_000 });
    expect(await sql`select to_jsonb(i) as row from invoices i where id in (${original.id}, ${known.id}) order by id`).toEqual(before);
    expect((await invoices.getInvoice(original.id))!.invoice.taxDetails).toEqual(first);
  });
});
