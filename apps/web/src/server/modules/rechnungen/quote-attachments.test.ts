import nodemailer from "nodemailer";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { MAX_INVOICE_ATTACHMENTS } from "./attachment-limit.ts";

type Sent = { attachments?: { filename: string; contentType: string; content: Buffer | string }[] };

/** Kleinste Datei, die Haben am Inhalt als PDF erkennt; der Text macht jede Datei eindeutig */
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe.skipIf(!testDatabaseUrl)("Zusätzliche Anhänge an Angeboten (Postgres, #415)", () => {
  let attachments: typeof import("./quote-attachments.ts");
  let quotes: typeof import("./quotes.ts");
  let invoiceMail: typeof import("./invoice-mail.ts");
  let mail: typeof import("../mail/mail.ts");
  let storage: typeof import("../../storage.ts");
  let exporter: typeof import("../archiv/export.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const sent: Sent[] = [];
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    attachments = await import("./quote-attachments.ts");
    quotes = await import("./quotes.ts");
    invoiceMail = await import("./invoice-mail.ts");
    mail = await import("../mail/mail.ts");
    storage = await import("../../storage.ts");
    exporter = await import("../archiv/export.ts");
    mail.setMailTransportForTests(() => {
      const transport = nodemailer.createTransport({ jsonTransport: true });
      return {
        sendMail: async (message: Sent) => {
          sent.push(message);
          return transport.sendMail(message);
        },
      } as unknown as ReturnType<typeof nodemailer.createTransport>;
    });
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    sent.length = 0;
    await leeren(sql)`truncate mail_log, mail_settings, quote_attachments, quote_lines, quotes, quote_number_counters, invoice_attachments,
      invoice_lines, invoices, invoice_number_counters, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
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

  async function mailSettings() {
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
  }

  it("hängt PDF-Dateien an den Entwurf, dieselbe Datei nur einmal, und entfernt sie wieder samt Datei", async () => {
    const { id } = await draft();
    const agb = await attachments.addQuoteAttachment(actor, id, { bytes: pdf("AGB"), filename: "C:\\Vorlagen\\AGB 2026" });
    const leistung = await attachments.addQuoteAttachment(actor, id, { bytes: pdf("Leistung"), filename: "leistungsbeschreibung.pdf" });
    expect(agb.duplicate).toBe(false);
    expect(await attachments.addQuoteAttachment(actor, id, { bytes: pdf("AGB"), filename: "nochmal.pdf" })).toEqual({ id: agb.id, duplicate: true });

    const list = await attachments.listQuoteAttachments(id);
    expect(list.map((a) => a.filename)).toEqual(["AGB 2026.pdf", "leistungsbeschreibung.pdf"]);
    expect(list[0]!.size).toBe(pdf("AGB").byteLength);
    const loaded = await attachments.loadQuoteAttachment(leistung.id);
    expect(loaded).toMatchObject({ filename: "leistungsbeschreibung.pdf", mimeType: "application/pdf" });
    expect(new TextDecoder().decode(loaded!.bytes)).toContain("Leistung");

    // Neue Tabelle mit Audit-Trigger
    const [audit] = await sql`select count(*)::int as n from audit_log where table_name = 'quote_attachments' and action = 'INSERT'`;
    expect(audit!.n).toBe(2);

    await attachments.removeQuoteAttachment(actor, id, leistung.id);
    expect((await attachments.listQuoteAttachments(id)).map((a) => a.id)).toEqual([agb.id]);
    await expect(storage.loadFile(storage.sha256Of(pdf("Leistung")))).rejects.toThrow();
    await expect(attachments.removeQuoteAttachment(actor, id, leistung.id)).rejects.toThrow("Anhang nicht gefunden.");
  });

  it("prüft Typ am Inhalt und Größe wie bei Rechnungen, höchstens zehn je Angebot", async () => {
    const { id } = await draft();
    await expect(attachments.addQuoteAttachment(actor, id, { bytes: PNG, filename: "foto.pdf" })).rejects.toThrow(
      "foto.pdf: Als Anhang sind nur PDF-Dateien erlaubt.",
    );
    await expect(attachments.addQuoteAttachment(actor, id, { bytes: new Uint8Array(0), filename: "leer.pdf" })).rejects.toThrow(
      "leer.pdf: Die Datei ist leer.",
    );
    for (let i = 0; i < MAX_INVOICE_ATTACHMENTS; i++) {
      await attachments.addQuoteAttachment(actor, id, { bytes: pdf(`Anlage ${i}`), filename: `anlage-${i}.pdf` });
    }
    await expect(attachments.addQuoteAttachment(actor, id, { bytes: pdf("elf"), filename: "elf.pdf" })).rejects.toThrow("Höchstens 10 Anhänge je Angebot.");
  });

  it("sperrt die Anhänge mit dem Festschreiben, in der App und in der Datenbank; abrufbar bleiben sie", async () => {
    const { id } = await draft();
    const { id: attachmentId } = await attachments.addQuoteAttachment(actor, id, { bytes: pdf("AGB"), filename: "agb.pdf" });
    await quotes.finalizeQuote(actor, id);

    await expect(attachments.addQuoteAttachment(actor, id, { bytes: pdf("später"), filename: "spaeter.pdf" })).rejects.toThrow(/festgeschrieben/);
    await expect(attachments.removeQuoteAttachment(actor, id, attachmentId)).rejects.toThrow(/festgeschrieben/);
    await expect(sql`delete from quote_attachments where id = ${attachmentId}`).rejects.toThrow(/Anhänge sind unveränderlich/);
    await expect(sql`update quote_attachments set filename = 'anders.pdf' where id = ${attachmentId}`).rejects.toThrow(/Anhänge sind unveränderlich/);
    await expect(
      sql`insert into quote_attachments (quote_id, filename, mime_type, sha256, size) values (${id}, 'x.pdf', 'application/pdf', ${"a".repeat(64)}, 1)`,
    ).rejects.toThrow(/Anhänge sind unveränderlich/);
    // Auch nicht an ein anderes, festgeschriebenes Angebot umhängen
    const other = await draft();
    const { id: movable } = await attachments.addQuoteAttachment(actor, other.id, { bytes: pdf("Entwurf"), filename: "entwurf.pdf" });
    await expect(sql`update quote_attachments set quote_id = ${id} where id = ${movable}`).rejects.toThrow(/Anhänge sind unveränderlich/);

    expect((await attachments.loadQuoteAttachment(attachmentId))?.filename).toBe("agb.pdf");
    // Antwort des Kunden bleibt möglich
    await quotes.setQuoteDecision(actor, id, "angenommen");
  });

  it("ein gelöschter Entwurf nimmt seine Anhänge und deren Dateien mit, eine geteilte Datei bleibt", async () => {
    const shared = pdf("geteilt");
    const { id } = await draft();
    const keep = await draft();
    await attachments.addQuoteAttachment(actor, id, { bytes: pdf("Entwurf"), filename: "entwurf.pdf" });
    await attachments.addQuoteAttachment(actor, id, { bytes: shared, filename: "agb.pdf" });
    await attachments.addQuoteAttachment(actor, keep.id, { bytes: shared, filename: "agb.pdf" });
    await quotes.deleteQuoteDraft(actor, id);
    expect(await sql`select quote_id from quote_attachments`).toEqual([{ quote_id: keep.id }]);
    await expect(storage.loadFile(storage.sha256Of(pdf("Entwurf")))).rejects.toThrow();
    expect(new TextDecoder().decode(await storage.loadFile(storage.sha256Of(shared)))).toContain("geteilt");
  });

  it("die Datei eines Rechnungsanhangs bleibt liegen, wenn derselbe Angebotsanhang entfernt wird", async () => {
    const invoices = await import("./invoices.ts");
    const invoiceAttachments = await import("./attachments.ts");
    const bytes = pdf("AGB gemeinsam");
    const invoice = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-10-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    await invoiceAttachments.addInvoiceAttachment(actor, invoice.id, { bytes, filename: "agb.pdf" });
    const { id } = await draft();
    const attachment = await attachments.addQuoteAttachment(actor, id, { bytes, filename: "agb.pdf" });
    await attachments.removeQuoteAttachment(actor, id, attachment.id);
    expect(new TextDecoder().decode(await storage.loadFile(storage.sha256Of(bytes)))).toContain("AGB gemeinsam");
    // Und umgekehrt: Der Angebotsanhang hält die Datei, wenn der Rechnungsentwurf gelöscht wird
    await attachments.addQuoteAttachment(actor, id, { bytes, filename: "agb.pdf" });
    await invoices.deleteDraft(actor, invoice.id);
    expect(new TextDecoder().decode(await storage.loadFile(storage.sha256Of(bytes)))).toContain("AGB gemeinsam");
  });

  it("Kopieren nimmt die Anhänge in den neuen Entwurf mit", async () => {
    const { id } = await draft();
    await attachments.addQuoteAttachment(actor, id, { bytes: pdf("AGB"), filename: "agb.pdf" });
    await attachments.addQuoteAttachment(actor, id, { bytes: pdf("Vereinbarung"), filename: "vereinbarung.pdf" });
    await quotes.finalizeQuote(actor, id);
    const copy = await quotes.copyQuote(actor, id, "2026-11-02");
    expect((await attachments.listQuoteAttachments(copy.id)).map((a) => a.filename)).toEqual(["agb.pdf", "vereinbarung.pdf"]);
    // Im Entwurf frei änderbar, das Original bleibt
    const [first] = await attachments.listQuoteAttachments(copy.id);
    await attachments.removeQuoteAttachment(actor, copy.id, first!.id);
    expect(await attachments.listQuoteAttachments(id)).toHaveLength(2);
    expect(new TextDecoder().decode(await storage.loadFile(storage.sha256Of(pdf("AGB"))))).toContain("AGB");
  });

  it("versendet nur die ausgewählten Anhänge; das Protokoll nennt die tatsächlich versandten Dateien", async () => {
    const { id } = await draft();
    const agb = await attachments.addQuoteAttachment(actor, id, { bytes: pdf("AGB"), filename: "agb.pdf" });
    await attachments.addQuoteAttachment(actor, id, { bytes: pdf("Intern"), filename: "intern.pdf" });
    const final = await quotes.finalizeQuote(actor, id);
    await mailSettings();

    const mailDraft = await invoiceMail.quoteMailDraft(id);
    expect(mailDraft.attachments).toEqual([`Angebot-${final.number}.pdf`]);
    expect(mailDraft.extraAttachments.map((a) => a.filename)).toEqual(["agb.pdf", "intern.pdf"]);

    const result = await invoiceMail.sendQuoteMail(actor, id, { to: "einkauf@nordwerk.example", subject: "Angebot", body: "Anbei.", attachmentIds: [agb.id] });
    expect(result.ok).toBe(true);
    const files = [`Angebot-${final.number}.pdf`, "agb.pdf"];
    expect(sent[0]!.attachments!.map((a) => a.filename)).toEqual(files);
    expect(Buffer.from(String(sent[0]!.attachments![1]!.content), "base64").toString()).toContain("AGB");
    const [log] = await invoiceMail.mailsForQuote(id);
    expect(log!.attachments).toEqual(files);

    // Ohne Auswahl geht nur das Angebot
    await invoiceMail.sendQuoteMail(actor, id, { to: "einkauf@nordwerk.example", subject: "Angebot", body: "Anbei." });
    expect(sent[1]!.attachments!.map((a) => a.filename)).toEqual(files.slice(0, 1));

    // Ein Anhang eines anderen Angebots lässt sich nicht unterschieben
    const other = await draft();
    const foreign = await attachments.addQuoteAttachment(actor, other.id, { bytes: pdf("fremd"), filename: "fremd.pdf" });
    await expect(
      invoiceMail.sendQuoteMail(actor, id, { to: "einkauf@nordwerk.example", subject: "Angebot", body: "Anbei.", attachmentIds: [foreign.id] }),
    ).rejects.toThrow("Ein gewählter Anhang gehört nicht zu diesem Angebot.");
    expect(sent).toHaveLength(2);
  });

  it("das Jahresarchiv enthält die Anhänge festgeschriebener Angebote mit anhaenge.csv, Entwürfe nicht", async () => {
    const { id } = await draft();
    await attachments.addQuoteAttachment(actor, id, { bytes: pdf("AGB"), filename: "AGB Stand 2026.pdf" });
    const final = await quotes.finalizeQuote(actor, id);
    const open = await draft();
    await attachments.addQuoteAttachment(actor, open.id, { bytes: pdf("Entwurf"), filename: "entwurf.pdf" });

    const { unzipSync } = await import("fflate");
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2026)) chunks.push(chunk);
    const zip = unzipSync(Buffer.concat(chunks));
    const path = `angebote/anhaenge/${final.number}_AGB-Stand-2026.pdf`;
    expect(new TextDecoder().decode(zip[path]!)).toContain("AGB");
    expect(Object.keys(zip).filter((p) => p.startsWith("angebote/anhaenge/"))).toEqual([path, "angebote/anhaenge/anhaenge.csv"]);
    const csv = new TextDecoder().decode(zip["angebote/anhaenge/anhaenge.csv"]!);
    expect(csv.split(/\r?\n/)[0]).toContain("Angebot;Dateiname;Datei;");
    expect(csv).toContain(`${final.number};AGB Stand 2026.pdf;${final.number}_AGB-Stand-2026.pdf;`);
    expect(csv).toContain(storage.sha256Of(pdf("AGB")));
    expect(new TextDecoder().decode(zip["pruefsummen.sha256"]!)).toContain(path);
    expect(new TextDecoder().decode(zip["LIESMICH.txt"]!)).toMatch(/angebote\/[\s\S]*anhaenge\//);
  });
});
