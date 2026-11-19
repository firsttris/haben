import type postgres from "postgres";
import type { DeliveryNoteDocument, QuoteDocument } from "@haben/einvoice";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

const seen = vi.hoisted(() => ({ confirmations: [] as unknown[], deliveryNotes: [] as unknown[] }));
vi.mock("@haben/einvoice", async (importOriginal) => {
  const original = await importOriginal<typeof import("@haben/einvoice")>();
  return {
    ...original,
    buildConfirmationPdf: (...args: Parameters<typeof original.buildConfirmationPdf>) => {
      seen.confirmations.push(args[0]);
      return original.buildConfirmationPdf(...args);
    },
    buildDeliveryNotePdf: (...args: Parameters<typeof original.buildDeliveryNotePdf>) => {
      seen.deliveryNotes.push(args[0]);
      return original.buildDeliveryNotePdf(...args);
    },
  };
});

describe.skipIf(!testDatabaseUrl)("Auftragsbestätigung und Lieferschein (Postgres)", () => {
  let docs: typeof import("./order-documents.ts");
  let quotes: typeof import("./quotes.ts");
  let invoices: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;
  const lines = [{ description: "Workshop Architektur", quantity: 2000, unit: "Tag" as const, unitPrice: 120_000, taxRate: 1900 as const }];

  beforeAll(async () => {
    sql = await setupTestDb();
    docs = await import("./order-documents.ts");
    quotes = await import("./quotes.ts");
    invoices = await import("./index.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  it("Auftragsbestätigung und Lieferschein erst zum angenommenen Angebot", async () => {
    const quote = await quotes.finalizeQuote(
      actor,
      (
        await quotes.createQuoteDraft(actor, {
          contactId,
          issueDate: "2026-10-01",
          validUntil: "2026-10-31",
          serviceFrom: null,
          serviceTo: null,
          note: "",
          lines,
        })
      ).id,
    );
    await expect(docs.confirmationPdf(quote.id)).rejects.toThrow(/nicht als angenommen/);
    await quotes.setQuoteDecision(actor, quote.id, "angenommen");
    const confirmation = await docs.confirmationPdf(quote.id);
    expect(confirmation.filename).toBe("Auftragsbestaetigung-AN-2026-001.pdf");
    expect(Buffer.from(confirmation.pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect((await docs.deliveryNotePdf("angebot", quote.id)).filename).toBe("Lieferschein-AN-2026-001.pdf");
    // Nichts gebucht, nichts gespeichert
    expect(await sql`select 1 from journal_entries`).toHaveLength(0);
  });

  it("Lieferschein zur Rechnung, nicht zur Stornorechnung", async () => {
    const invoice = await invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          contactId,
          issueDate: "2026-10-02",
          serviceFrom: null,
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd",
          note: "",
          lines,
        })
      ).id,
      kleinunternehmerStand,
    );
    const note = await docs.deliveryNotePdf("rechnung", invoice.id);
    expect(note.filename).toBe("Lieferschein-2026-001.pdf");
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-10-03");
    await expect(docs.deliveryNotePdf("rechnung", storno.id)).rejects.toThrow(/nur zu festgeschriebenen Rechnungen/);
  });

  it("Absender und Kunde stehen mit der heutigen Anschrift auf den Dokumenten, die übrigen Angaben wie auf dem Beleg", async () => {
    const quote = await quotes.finalizeQuote(
      actor,
      (
        await quotes.createQuoteDraft(actor, {
          contactId,
          issueDate: "2026-10-01",
          validUntil: "2026-10-31",
          serviceFrom: null,
          serviceTo: null,
          note: "",
          lines,
        })
      ).id,
    );
    await quotes.setQuoteDecision(actor, quote.id, "angenommen");
    const invoice = await invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          contactId,
          issueDate: "2026-10-02",
          serviceFrom: null,
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd",
          note: "",
          lines,
        })
      ).id,
      kleinunternehmerStand,
    );
    await contacts.updateContact(actor, contactId, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Speicherstraße 9",
      plz: "20457",
      ort: "Hamburg-Mitte",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    await sql`update company set strasse = 'Neuer Weg 2', plz = '93049', ort = 'Regensburg a. D.', bank = 'Sparkasse' where id = 1`;

    const before = [seen.confirmations.length, seen.deliveryNotes.length] as const;
    await docs.confirmationPdf(quote.id);
    await docs.deliveryNotePdf("angebot", quote.id);
    await docs.deliveryNotePdf("rechnung", invoice.id);

    const shown = [...seen.confirmations.slice(before[0]), ...seen.deliveryNotes.slice(before[1])] as (QuoteDocument | DeliveryNoteDocument)[];
    expect(shown).toHaveLength(3);
    for (const doc of shown) {
      expect(doc.buyer).toMatchObject({ name: "Nordwerk Software GmbH", strasse: "Speicherstraße 9", ort: "Hamburg-Mitte" });
      expect(doc.seller).toMatchObject({ strasse: "Neuer Weg 2", plz: "93049", ort: "Regensburg a. D.", bank: "Commerzbank" });
    }
  });
});
