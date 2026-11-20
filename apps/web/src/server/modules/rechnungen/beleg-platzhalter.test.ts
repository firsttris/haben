import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

// Platzhalter in Einleitung und Hinweis (#1334): im Entwurf als Text, beim Festschreiben aufgelöst in Rechnung, PDF und XML
describe.skipIf(!testDatabaseUrl)("Platzhalter in Einleitung und Hinweis (Postgres, #1334)", () => {
  let invoices: typeof import("./index.ts");
  let quotes: typeof import("./quotes.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  let contactId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    quotes = await import("./quotes.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate mail_log, quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', 14)`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
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

  const zeile = { description: "Wartung", quantity: 1000, unit: "Psch." as const, unitPrice: 10_000, taxRate: 1900 as const };
  const einleitung = "Leistungen {leistungszeitraum} für {kunde}:";
  const hinweis = "Bitte {betrag} bis {faellig} auf {iban} (BIC {bic}) mit {art} {nummer} vom {datum} überweisen. {unbekannt} bleibt.";

  it("löst die Platzhalter beim Festschreiben einer Rechnung auf; Rechnung, PDF und XML tragen die Werte", async () => {
    const entwurf = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-11-02",
      serviceFrom: "2026-10-01",
      serviceTo: "2026-10-31",
      paymentTermDays: 14,
      format: "zugferd",
      intro: einleitung,
      note: hinweis,
      lines: [zeile],
    });
    // Im Entwurf bleiben die Platzhalter stehen
    expect((await sql`select intro, note from invoices where id = ${entwurf.id}`)[0]).toEqual({ intro: einleitung, note: hinweis });

    const rechnung = await invoices.finalizeInvoice(actor, entwurf.id, kleinunternehmerStand);
    const erwartet = {
      intro: "Leistungen 01.10.2026 – 31.10.2026 für Nordwerk Software GmbH:",
      note: `Bitte 119,00 € bis 16.11.2026 auf DE89 3704 0044 0532 0130 00 (BIC COBADEFFXXX) mit Rechnung ${rechnung.number} vom 02.11.2026 überweisen. {unbekannt} bleibt.`,
    };
    expect({ intro: rechnung.intro, note: rechnung.note }).toEqual(erwartet);
    expect(rechnung.xml).toContain(`Rechnung ${rechnung.number} vom 02.11.2026`);
    expect(rechnung.xml).not.toContain("{nummer}");
  }, 60_000);

  it("löst sie beim Festschreiben eines Angebots auf, mit {gueltig}", async () => {
    const entwurf = await quotes.createQuoteDraft(actor, {
      contactId,
      issueDate: "2026-11-02",
      validUntil: "2026-11-30",
      serviceFrom: "2026-12-01",
      serviceTo: null,
      intro: "{art} {nummer} für {kunde}, Leistung am {leistungszeitraum}:",
      note: "Gültig bis {gueltig}, Summe {betrag}.",
      lines: [zeile],
    });
    const angebot = await quotes.finalizeQuote(actor, entwurf.id);
    expect(angebot.intro).toBe(`Angebot ${angebot.number} für Nordwerk Software GmbH, Leistung am 01.12.2026:`);
    expect(angebot.note).toBe("Gültig bis 30.11.2026, Summe 119,00 €.");
  }, 60_000);

  it("Kopie und Rechnung aus dem Angebot bekommen die Platzhalter, nicht die Werte des Originals", async () => {
    const entwurf = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-11-02",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      intro: "Ohne Platzhalter.",
      note: hinweis,
      lines: [zeile],
    });
    const rechnung = await invoices.finalizeInvoice(actor, entwurf.id, kleinunternehmerStand);
    // Die Vorlage hält den Text mit Platzhaltern nur dort, wo etwas eingesetzt wurde
    expect((await sql`select intro_vorlage, note_vorlage from invoices where id = ${rechnung.id}`)[0]).toEqual({ intro_vorlage: "", note_vorlage: hinweis });
    const kopie = await invoices.copyInvoice(actor, rechnung.id, "2026-12-01");
    expect({ intro: kopie.intro, note: kopie.note }).toEqual({ intro: "Ohne Platzhalter.", note: hinweis });

    const angebotsEntwurf = await quotes.createQuoteDraft(actor, {
      contactId,
      issueDate: "2026-11-02",
      validUntil: "2026-11-30",
      serviceFrom: null,
      serviceTo: null,
      intro: "Gemäß {art} {nummer}:",
      note: "",
      lines: [zeile],
    });
    const angebot = await quotes.finalizeQuote(actor, angebotsEntwurf.id);
    expect((await quotes.copyQuote(actor, angebot.id, "2026-12-01")).intro).toBe("Gemäß {art} {nummer}:");
    await quotes.setQuoteDecision(actor, angebot.id, "angenommen");
    const ausAngebot = await quotes.quoteToInvoice(actor, angebot.id, "2026-12-01");
    expect((await sql`select intro from invoices where id = ${ausAngebot.id}`)[0]?.intro).toBe("Gemäß {art} {nummer}:");
  }, 60_000);
});
