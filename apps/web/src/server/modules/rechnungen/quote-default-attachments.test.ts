import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { MAX_INVOICE_ATTACHMENTS } from "./attachment-limit.ts";

/** Kleinste Datei, die Haben am Inhalt als PDF erkennt; der Text macht jede Datei eindeutig */
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe.skipIf(!testDatabaseUrl)("Standardanhänge für Angebote (Postgres, #415)", () => {
  let defaults: typeof import("./quote-default-attachments.ts");
  let attachments: typeof import("./quote-attachments.ts");
  let quotes: typeof import("./quotes.ts");
  let invoiceMail: typeof import("./invoice-mail.ts");
  let mail: typeof import("../mail/mail.ts");
  let storage: typeof import("../../storage.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    defaults = await import("./quote-default-attachments.ts");
    attachments = await import("./quote-attachments.ts");
    quotes = await import("./quotes.ts");
    invoiceMail = await import("./invoice-mail.ts");
    mail = await import("../mail/mail.ts");
    storage = await import("../../storage.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate mail_log, mail_settings, quote_default_attachments, quote_attachments, quote_lines, quotes, quote_number_counters,
      documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'angebot@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    const stammdaten = await import("../stammdaten/index.ts");
    const contact = await stammdaten.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "einkauf@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  });

  const draft = () =>
    quotes.createQuoteDraft(actor, {
      contactId,
      issueDate: "2026-10-01",
      validUntil: "2026-10-31",
      serviceFrom: null,
      serviceTo: null,
      note: "",
      lines: [{ description: "Workshop Architektur", quantity: 8000, unit: "Std.", unitPrice: 12_000, taxRate: 1900 }],
    });

  it("hinterlegt PDFs in den Einstellungen, dieselbe Datei nur einmal, mit Audit; Entfernen nimmt die ungenutzte Datei mit", async () => {
    const agb = await defaults.addQuoteDefaultAttachment(actor, { bytes: pdf("AGB"), filename: "AGB 2026" });
    await defaults.addQuoteDefaultAttachment(actor, { bytes: pdf("Widerruf"), filename: "widerrufsbelehrung.pdf" });
    expect(await defaults.addQuoteDefaultAttachment(actor, { bytes: pdf("AGB"), filename: "agb-kopie.pdf" })).toEqual({ id: agb.id, duplicate: true });
    expect((await defaults.listQuoteDefaultAttachments()).map((a) => a.filename)).toEqual(["AGB 2026.pdf", "widerrufsbelehrung.pdf"]);
    expect((await defaults.loadQuoteDefaultAttachment(agb.id))?.filename).toBe("AGB 2026.pdf");
    const [audit] = await sql`select count(*)::int as n from audit_log where table_name = 'quote_default_attachments' and action = 'INSERT'`;
    expect(audit!.n).toBe(2);

    await defaults.removeQuoteDefaultAttachment(actor, agb.id);
    expect((await defaults.listQuoteDefaultAttachments()).map((a) => a.filename)).toEqual(["widerrufsbelehrung.pdf"]);
    await expect(storage.loadFile(storage.sha256Of(pdf("AGB")))).rejects.toThrow();
    await expect(defaults.removeQuoteDefaultAttachment(actor, agb.id)).rejects.toThrow("Anhang nicht gefunden.");
  });

  it("prüft Typ, Größe und Höchstzahl wie bei den Anhängen am Angebot", async () => {
    await expect(defaults.addQuoteDefaultAttachment(actor, { bytes: PNG, filename: "foto.pdf" })).rejects.toThrow(
      "foto.pdf: Als Anhang sind nur PDF-Dateien erlaubt.",
    );
    for (let i = 0; i < MAX_INVOICE_ATTACHMENTS; i++) {
      await defaults.addQuoteDefaultAttachment(actor, { bytes: pdf(`Anlage ${i}`), filename: `anlage-${i}.pdf` });
    }
    await expect(defaults.addQuoteDefaultAttachment(actor, { bytes: pdf("elf"), filename: "elf.pdf" })).rejects.toThrow("Höchstens 10 Standardanhänge.");
  });

  it("ein neues Angebot bekommt die Standardanhänge, beim Senden vorausgewählt; im Entwurf lassen sie sich entfernen", async () => {
    await defaults.addQuoteDefaultAttachment(actor, { bytes: pdf("AGB"), filename: "agb.pdf" });
    await defaults.addQuoteDefaultAttachment(actor, { bytes: pdf("Widerruf"), filename: "widerruf.pdf" });
    const { id } = await draft();
    const list = await attachments.listQuoteAttachments(id);
    expect(list.map((a) => a.filename)).toEqual(["agb.pdf", "widerruf.pdf"]);

    // Im Entwurf abwählbar wie jeder Anhang; die Einstellung bleibt
    await attachments.removeQuoteAttachment(actor, id, list[1]!.id);
    expect((await defaults.listQuoteDefaultAttachments()).map((a) => a.filename)).toEqual(["agb.pdf", "widerruf.pdf"]);
    expect(new TextDecoder().decode(await storage.loadFile(storage.sha256Of(pdf("Widerruf"))))).toContain("Widerruf");

    await quotes.finalizeQuote(actor, id);
    await mail.saveMailSettings(actor, {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      username: "max",
      password: "geheim",
      fromAddress: "angebot@testfirma.example",
      reminderTo: "max@testfirma.example",
      remindersEnabled: false,
      reminderDays: [],
    });
    expect((await invoiceMail.quoteMailDraft(id)).extraAttachments.map((a) => a.filename)).toEqual(["agb.pdf"]);
  });

  it("eine spätere Änderung der Standardanhänge lässt bestehende Angebote, wie sie sind; die Datei bleibt, solange ein Angebot sie nutzt", async () => {
    const agb = await defaults.addQuoteDefaultAttachment(actor, { bytes: pdf("AGB alt"), filename: "agb.pdf" });
    const { id } = await draft();
    await quotes.finalizeQuote(actor, id);
    await defaults.removeQuoteDefaultAttachment(actor, agb.id);
    await defaults.addQuoteDefaultAttachment(actor, { bytes: pdf("AGB neu"), filename: "agb.pdf" });

    const [kept] = await attachments.listQuoteAttachments(id);
    expect(kept!.sha256).toBe(storage.sha256Of(pdf("AGB alt")));
    expect(new TextDecoder().decode(await storage.loadFile(kept!.sha256))).toContain("AGB alt");
    // Das nächste Angebot bekommt die neue Fassung
    const next = await draft();
    const [fresh] = await attachments.listQuoteAttachments(next.id);
    expect(fresh!.sha256).toBe(storage.sha256Of(pdf("AGB neu")));
  });

  it("Kopieren übernimmt die Anhänge des Originals, ohne die Standardanhänge ein zweites Mal anzuhängen", async () => {
    const { id } = await draft();
    await defaults.addQuoteDefaultAttachment(actor, { bytes: pdf("AGB"), filename: "agb.pdf" });
    await attachments.addQuoteAttachment(actor, id, { bytes: pdf("Vereinbarung"), filename: "vereinbarung.pdf" });
    const copy = await quotes.copyQuote(actor, id, "2026-11-02");
    expect((await attachments.listQuoteAttachments(copy.id)).map((a) => a.filename)).toEqual(["vereinbarung.pdf"]);
  });

  it("die Datei eines Standardanhangs bleibt, wenn ein Angebot mit ihr gelöscht wird", async () => {
    await defaults.addQuoteDefaultAttachment(actor, { bytes: pdf("AGB"), filename: "agb.pdf" });
    const { id } = await draft();
    await quotes.deleteQuoteDraft(actor, id);
    expect(new TextDecoder().decode(await storage.loadFile(storage.sha256Of(pdf("AGB"))))).toContain("AGB");
  });
});
