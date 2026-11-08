import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** Was die Entwurfs-Builder bekommen haben; das PDF selbst prüft packages/einvoice (entwurf.test.ts) */
const seen = vi.hoisted(() => ({ invoice: [] as unknown[], quote: [] as unknown[], dunning: [] as unknown[] }));

vi.mock("@haben/einvoice", async (importOriginal) => {
  const original = await importOriginal<typeof import("@haben/einvoice")>();
  return {
    ...original,
    renderInvoiceDraftPdf: (doc: Parameters<typeof original.renderInvoiceDraftPdf>[0]) => {
      seen.invoice.push(doc);
      return original.renderInvoiceDraftPdf(doc);
    },
    buildQuoteDraftPdf: (doc: Parameters<typeof original.buildQuoteDraftPdf>[0]) => {
      seen.quote.push(doc);
      return original.buildQuoteDraftPdf(doc);
    },
    buildDunningDraftPdf: (doc: Parameters<typeof original.buildDunningDraftPdf>[0]) => {
      seen.dunning.push(doc);
      return original.buildDunningDraftPdf(doc);
    },
  };
});

const last = <T>(list: unknown[]) => list.at(-1) as T;

/** Angemeldetes Konto für die API-Routen; ohne echte Sitzung (Better Auth) */
const session = vi.hoisted(() => ({ role: "inhaber" as "inhaber" | "steuerberatung" }));
vi.mock("../../auth.ts", () => ({
  auth: () => ({ api: { getSession: async () => ({ user: { id: "konto", name: "Konto", email: "konto@example.com", role: session.role } }) } }),
}));

describe.skipIf(!testDatabaseUrl)("Entwürfe als PDF (Postgres, Issue #342)", () => {
  let drafts: typeof import("./draft-pdf.ts");
  let invoices: typeof import("./invoices.ts");
  let quotes: typeof import("./quotes.ts");
  let dunning: typeof import("./dunning.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  const invoiceDraft = (overrides = {}) => ({
    contactId,
    issueDate: "2026-09-01",
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines: [{ description: "Beratung", quantity: 1000, unit: "Std." as const, unitPrice: 100_000, taxRate: 1900 as const }],
    ...overrides,
  });

  const quoteDraft = (overrides = {}) => ({
    contactId,
    issueDate: "2026-10-01",
    validUntil: "2026-10-31",
    serviceFrom: null,
    serviceTo: null,
    note: "",
    lines: [{ description: "Workshop", quantity: 2000, unit: "Std." as const, unitPrice: 9500, taxRate: 1900 as const }],
    ...overrides,
  });

  /** Was in der Datenbank bleiben muss, wenn nur ein Entwurfs-PDF entsteht */
  const untouched = async () => ({
    journal: (await sql`select count(*)::int as n from journal_entries`)[0]!.n,
    invoiceCounters: (await sql`select count(*)::int as n from invoice_number_counters`)[0]!.n,
    quoteCounters: (await sql`select count(*)::int as n from quote_number_counters`)[0]!.n,
    dunnings: (await sql`select count(*)::int as n from dunnings`)[0]!.n,
    mails: (await sql`select count(*)::int as n from mail_log`)[0]!.n,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    drafts = await import("./draft-pdf.ts");
    invoices = await import("./invoices.ts");
    quotes = await import("./quotes.ts");
    dunning = await import("./dunning.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    seen.invoice.length = 0;
    seen.quote.length = 0;
    seen.dunning.length = 0;
    await sql`truncate mail_log, dunnings, quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines,
      invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank, dunning)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank',
              '{"baseRate": 127, "fees": {"1": 0, "2": 500, "3": 1000}, "deadlineDays": 10}'::jsonb)`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "rechnung@nordwerk.example",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  }, 30_000);

  describe("Rechnung", () => {
    it("PDF aus dem gespeicherten Entwurf, ohne Nummer, Buchung, Versand oder Änderung am Entwurf", async () => {
      const draft = await invoices.createDraft(actor, invoiceDraft());
      const before = await untouched();
      const file = await drafts.invoiceDraftPdf(draft.id);
      expect(file?.filename).toBe("Rechnung-Entwurf-2026-09-01.pdf");
      expect(Buffer.from(file!.pdf).subarray(0, 5).toString()).toBe("%PDF-");
      expect(last<{ buyer: { name: string }; totals: { gross: number } }>(seen.invoice)).toMatchObject({
        buyer: { name: "Nordwerk Software GmbH" },
        totals: { gross: 119_000 },
      });
      expect(await untouched()).toEqual(before);
      const [row] =
        await sql`select status, number, pdf, xml, updated_at = ${draft.updatedAt.toISOString()}::timestamptz as unchanged from invoices where id = ${draft.id}`;
      expect(row).toMatchObject({ status: "draft", number: null, pdf: null, xml: null, unchanged: true });
      // Festschreiben vergibt danach die erste Nummer: Der Entwurf hat keine verbraucht
      expect((await invoices.finalizeInvoice(actor, draft.id)).number).toBe("2026-001");
    });

    it("ein weiterer Download zeigt den neuen Stand", async () => {
      const draft = await invoices.createDraft(actor, invoiceDraft());
      await drafts.invoiceDraftPdf(draft.id);
      await invoices.updateDraft(
        actor,
        draft.id,
        invoiceDraft({ lines: [{ description: "Workshop", quantity: 2000, unit: "Std.", unitPrice: 50_000, taxRate: 700 }] }),
      );
      await drafts.invoiceDraftPdf(draft.id);
      expect(last<{ lines: { description: string }[]; totals: { gross: number } }>(seen.invoice)).toMatchObject({
        lines: [{ description: "Workshop" }],
        totals: { gross: 107_000 },
      });
    });

    it("Korrektur geht an die Anschrift der ursprünglichen Rechnung und nennt sie", async () => {
      const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft())).id);
      await sql`update contacts set name = 'Nordwerk Neu GmbH' where id = ${contactId}`;
      const correction = await invoices.createCorrection(actor, original.id, "2026-10-05");
      const file = await drafts.invoiceDraftPdf(correction.id);
      expect(file?.filename).toBe("Rechnungskorrektur-Entwurf-2026-10-05.pdf");
      expect(last<object>(seen.invoice)).toMatchObject({
        kind: "korrektur",
        buyer: { name: "Nordwerk Software GmbH" },
        corrects: { number: original.number, issueDate: original.issueDate },
      });
    });

    it("keine für festgeschriebene oder unbekannte Rechnungen, ohne Kunden eine Meldung", async () => {
      const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft())).id);
      expect(await drafts.invoiceDraftPdf(final.id)).toBeNull();
      expect(await drafts.invoiceDraftPdf("00000000-0000-4000-8000-000000000000")).toBeNull();
      const empty = await invoices.createDraft(actor, invoiceDraft({ contactId: null }));
      await expect(drafts.invoiceDraftPdf(empty.id)).rejects.toThrow("Für das Entwurfs-PDF fehlt noch der Kunde.");
    });
  });

  describe("Zugriff", () => {
    // Entwürfe sind Arbeitsstand des Inhabers: Die Steuerberatung sieht sie weder in der Liste noch im Detail
    // (getInvoices, getInvoiceDetail in server/functions/invoices.ts), also auch nicht als Entwurfs-PDF (Issue #342:
    // „Berechtigungen für Entwurfszugriff bleiben gewahrt“)
    const get = async (id: string) => {
      const { Route } = await import("../../../routes/api/entwurf/rechnung.$id.ts");
      const handlers = (Route.options.server as { handlers: { GET: (ctx: { request: Request; params: { id: string } }) => Promise<Response> } }).handlers;
      return handlers.GET({ request: new Request(`http://localhost/api/entwurf/rechnung/${id}`), params: { id } });
    };

    it("Rechnungsentwurf als PDF nur für den Inhaber, nicht für die Steuerberatung", async () => {
      const draft = await invoices.createDraft(actor, invoiceDraft());
      session.role = "inhaber";
      expect((await get(draft.id)).status).toBe(200);
      session.role = "steuerberatung";
      const response = await get(draft.id);
      expect(response.headers.get("Content-Type")).not.toBe("application/pdf");
      expect(response.status).toBe(403);
      session.role = "inhaber";
    });
  });

  describe("Angebot", () => {
    it("PDF aus dem Entwurf ohne Nummer; das festgeschriebene hat keins", async () => {
      const draft = await quotes.createQuoteDraft(actor, quoteDraft());
      const before = await untouched();
      const file = await drafts.quoteDraftPdf(draft.id);
      expect(file?.filename).toBe("Angebot-Entwurf-2026-10-01.pdf");
      expect(last<object>(seen.quote)).toMatchObject({ validUntil: "2026-10-31", totals: { gross: 22_610 } });
      expect(await untouched()).toEqual(before);
      expect((await sql`select status, number from quotes where id = ${draft.id}`)[0]).toMatchObject({ status: "draft", number: null });
      const final = await quotes.finalizeQuote(actor, draft.id);
      expect(final.number).toBe("AN-2026-001");
      expect(await drafts.quoteDraftPdf(final.id)).toBeNull();
    });

    it("ohne Kunden eine Meldung", async () => {
      const draft = await quotes.createQuoteDraft(actor, quoteDraft({ contactId: null }));
      await expect(drafts.quoteDraftPdf(draft.id)).rejects.toThrow("Für das Entwurfs-PDF fehlt noch der Kunde.");
    });
  });

  describe("Mahnung", () => {
    const input = (invoiceId: string, overrides = {}) => ({
      invoiceId,
      level: 1 as const,
      dueDate: "2026-10-25",
      fee: 0,
      flatFee: false,
      interest: null,
      intro: "Bitte zahlen.",
      closing: "",
      ...overrides,
    });

    it("PDF mit den Beträgen der Mahnung, ohne sie zu speichern", async () => {
      const invoice = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft())).id);
      const before = await untouched();
      const file = await dunning.dunningDraftPdf(input(invoice.id, { fee: 500, interest: "geschaeftskunde" }), "2026-10-15");
      expect(file.filename).toBe("Zahlungserinnerung-Entwurf-2026-10-15.pdf");
      const doc = last<{ amounts: { open: number; fee: number; interest: number; total: number }; invoice: { number: string } }>(seen.dunning);
      expect(doc.invoice.number).toBe(invoice.number);
      expect(doc.amounts).toMatchObject({ open: 119_000, fee: 500 });
      expect(doc.amounts.interest).toBeGreaterThan(0);
      expect(await untouched()).toEqual(before);
      // Die Mahnung selbst rechnet dasselbe
      const created = await dunning.createDunning(actor, input(invoice.id, { fee: 500, interest: "geschaeftskunde" }), "2026-10-15");
      expect(created).toMatchObject({ open: doc.amounts.open, fee: doc.amounts.fee, interest: doc.amounts.interest, total: doc.amounts.total });
    });

    it("prüft wie beim Erstellen: fällig, Frist, Mahnstufe", async () => {
      const invoice = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft())).id);
      await expect(dunning.dunningDraftPdf(input(invoice.id), "2026-09-10")).rejects.toThrow("noch nicht fällig");
      await expect(dunning.dunningDraftPdf(input(invoice.id, { dueDate: "2026-10-15" }), "2026-10-15")).rejects.toThrow("in der Zukunft");
      await dunning.createDunning(actor, input(invoice.id), "2026-10-15");
      await expect(dunning.dunningDraftPdf(input(invoice.id), "2026-10-16")).rejects.toThrow(/Als Nächstes folgt „1. Mahnung“/);
      expect((await dunning.dunningDraftPdf(input(invoice.id, { level: 2 }), "2026-10-16")).filename).toBe("Mahnung-Entwurf-2026-10-16.pdf");
    });
  });
});
