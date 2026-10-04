import nodemailer from "nodemailer";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

type Sent = { to: string; bcc?: string; subject: string; text: string; html: string; attachments?: { filename: string; contentType: string }[] };

describe.skipIf(!testDatabaseUrl)("Rechnungen und Mahnungen per E-Mail (Postgres)", () => {
  let invoiceMail: typeof import("./invoice-mail.ts");
  let mail: typeof import("./mail.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("./contacts.ts");
  let dunning: typeof import("./dunning.ts");
  let recurring: typeof import("./recurring.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const sent: Sent[] = [];
  let fail = false;
  let contactId: string;
  let invoiceId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoiceMail = await import("./invoice-mail.ts");
    mail = await import("./mail.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("./contacts.ts");
    dunning = await import("./dunning.ts");
    recurring = await import("./recurring.ts");
    mail.setMailTransportForTests(() => {
      const transport = nodemailer.createTransport({ jsonTransport: true });
      return {
        sendMail: async (message: Sent) => {
          if (fail) throw new Error("Postfach voll");
          sent.push(message);
          return transport.sendMail(message);
        },
      } as unknown as ReturnType<typeof nodemailer.createTransport>;
    });
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  const settings = {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    username: "max",
    password: "geheim",
    fromAddress: "rechnung@testfirma.example",
    reminderTo: "max@testfirma.example",
    remindersEnabled: false,
    reminderDays: [],
  };

  async function finalInvoice(format: "zugferd" | "xrechnung-cii" = "zugferd") {
    const draft = await invoices.createDraft(actor, {
      contactId, issueDate: "2026-09-01", serviceFrom: null, serviceTo: null, paymentTermDays: 14, format, note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    return (await invoices.finalizeInvoice(actor, draft.id)).id;
  }

  beforeEach(async () => {
    sent.length = 0;
    fail = false;
    await sql`truncate mail_log, mail_settings, dunnings, quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices, recurring_invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
      email: "buchhaltung@nordwerk.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
    });
    contactId = contact.id;
    invoiceId = await finalInvoice();
  }, 30_000);

  it("füllt Vorlage und Empfänger vor und schickt das PDF mit Blindkopie", async () => {
    const before = await invoiceMail.invoiceMailDraft(invoiceId);
    expect(before.configured).toBe(false);
    await expect(invoiceMail.sendInvoiceMail(actor, invoiceId, { to: "a@example.com", subject: "x", body: "y" })).rejects.toThrow(/kein E-Mail-Zugang/);

    await mail.saveMailSettings(actor, settings);
    const draft = await invoiceMail.invoiceMailDraft(invoiceId);
    expect(draft).toMatchObject({
      to: "buchhaltung@nordwerk.example",
      subject: "Rechnung 2026-001 von Testfirma",
      attachments: ["Rechnung-2026-001.pdf"],
      configured: true,
    });
    expect(draft.body).toMatch(/unsere Rechnung 2026-001 vom 01\.09\.2026 über 1\.190,00\s€, zahlbar bis zum 15\.09\.2026\./);

    const result = await invoiceMail.sendInvoiceMail(actor, invoiceId, { to: "buchhaltung@nordwerk.example; chef@nordwerk.example", subject: draft.subject, body: draft.body, copyToMe: true });
    expect(result).toEqual({ ok: true, error: null });
    expect(sent[0]).toMatchObject({ to: "buchhaltung@nordwerk.example, chef@nordwerk.example", bcc: "rechnung@testfirma.example", subject: "Rechnung 2026-001 von Testfirma" });
    expect(sent[0]!.attachments!.map((a) => [a.filename, a.contentType])).toEqual([["Rechnung-2026-001.pdf", "application/pdf"]]);
    expect(sent[0]!.html).toContain("<p>Guten Tag,</p>");

    const history = await invoiceMail.mailsForInvoice(invoiceId);
    expect(history).toEqual([expect.objectContaining({ kind: "rechnung", recipient: "buchhaltung@nordwerk.example, chef@nordwerk.example", ok: true })]);
    expect(await invoiceMail.invoicesSentByMail()).toEqual(new Set([invoiceId]));
    const [log] = await sql`select attachments from mail_log`;
    expect(log!.attachments).toEqual(["Rechnung-2026-001.pdf"]);
  });

  it("hängt bei XRechnung das XML an, nutzt eigene Vorlagen und lehnt Entwürfe und falsche Adressen ab", async () => {
    await mail.saveMailSettings(actor, { ...settings, invoiceSubject: "{art} {nummer} für {kunde}", invoiceBody: "Hallo,\n\nanbei {nummer}{zahlbar}.\n\n{firma}" });
    const xr = await finalInvoice("xrechnung-cii");
    const draft = await invoiceMail.invoiceMailDraft(xr);
    expect(draft.subject).toBe("Rechnung 2026-002 für Nordwerk Software GmbH");
    expect(draft.body).toBe("Hallo,\n\nanbei 2026-002, zahlbar bis zum 15.09.2026.\n\nTestfirma");
    expect(draft.attachments).toEqual(["Rechnung-2026-002.pdf", "Rechnung-2026-002-cii.xml"]);

    await expect(invoiceMail.sendInvoiceMail(actor, xr, { to: "keine-adresse", subject: "s", body: "b" })).rejects.toThrow(/gültige E-Mail/);
    const entwurf = await invoices.createDraft(actor, {
      contactId, issueDate: "2026-09-02", serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd", note: "",
      lines: [{ description: "X", quantity: 1000, unit: "Psch.", unitPrice: 100, taxRate: 1900 }],
    });
    await expect(invoiceMail.invoiceMailDraft(entwurf.id)).rejects.toThrow(/festgeschriebene/);

    // Fehler des Servers landen im Protokoll, nicht als Ausnahme
    fail = true;
    expect(await invoiceMail.sendInvoiceMail(actor, xr, { to: "a@example.com", subject: "s", body: "b" })).toEqual({ ok: false, error: "Postfach voll" });
    expect((await invoiceMail.mailsForInvoice(xr))[0]).toMatchObject({ ok: false, error: "Postfach voll" });
    expect(await invoiceMail.invoicesSentByMail()).toEqual(new Set());
  });

  it("schickt Angebote mit PDF und eigenem Protokoll", async () => {
    const quotes = await import("./quotes.ts");
    const draft = await quotes.createQuoteDraft(actor, {
      contactId, issueDate: "2026-09-01", validUntil: "2026-09-30", serviceFrom: null, serviceTo: null, note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    await expect(invoiceMail.quoteMailDraft(draft.id)).rejects.toThrow(/Nur festgeschriebene Angebote/);
    const quote = await quotes.finalizeQuote(actor, draft.id);
    await mail.saveMailSettings(actor, settings);
    const prepared = await invoiceMail.quoteMailDraft(quote.id);
    expect(prepared).toMatchObject({ to: "buchhaltung@nordwerk.example", subject: "Angebot AN-2026-001 von Testfirma", attachments: ["Angebot-AN-2026-001.pdf"] });
    expect(prepared.body).toMatch(/unser Angebot AN-2026-001 vom 01\.09\.2026 über 1\.190,00\s€\. Es gilt bis zum 30\.09\.2026\./);
    expect(await invoiceMail.sendQuoteMail(actor, quote.id, { to: prepared.to, subject: prepared.subject, body: prepared.body })).toEqual({ ok: true, error: null });
    expect(sent[0]!.attachments!.map((a) => a.filename)).toEqual(["Angebot-AN-2026-001.pdf"]);
    expect(await invoiceMail.mailsForQuote(quote.id)).toEqual([expect.objectContaining({ recipient: "buchhaltung@nordwerk.example", ok: true })]);
    expect(await invoiceMail.quotesSentByMail()).toEqual(new Set([quote.id]));
    expect(await invoiceMail.mailsForInvoice(invoiceId)).toEqual([]);
  });

  it("schreibt Kunden mit Sprache Englisch auf Englisch an, vom Angebot bis zur Stornorechnung", async () => {
    const quotes = await import("./quotes.ts");
    const english = await contacts.createContact(actor, {
      kundennummer: "10002", name: "Harbour Labs Ltd", strasse: "1 Dock Road", plz: "E14 5AB", ort: "London", land: "GB",
      email: "accounts@harbour.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null, language: "en",
    });
    expect(english.language).toBe("en");
    await mail.saveMailSettings(actor, { ...settings, invoiceSubject: "{art} {nummer} für {kunde}", invoiceBody: "Hallo {kunde}" });
    const quote = await quotes.finalizeQuote(
      actor,
      (
        await quotes.createQuoteDraft(actor, {
          contactId: english.id, issueDate: "2026-09-01", validUntil: "2026-09-30", serviceFrom: null, serviceTo: null, note: "",
          taxTreatment: "drittland", language: "en",
          lines: [{ description: "Consulting", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 0 }],
        })
      ).id,
    );
    expect(quote.pdf?.subarray(0, 5).toString()).toBe("%PDF-");
    const quoteMail = await invoiceMail.quoteMailDraft(quote.id);
    expect(quoteMail.subject).toBe("Quote AN-2026-001 from Testfirma");
    expect(quoteMail.body).toContain("our quote AN-2026-001 dated 1 Sept 2026 for €1,000.00. It is valid until 30 Sept 2026.");

    const draft = await quotes.quoteToInvoice(actor, quote.id, "2026-09-10");
    expect(draft).toMatchObject({ language: "en", note: "As per our quote AN-2026-001 of 1 Sept 2026." });
    const invoice = await invoices.finalizeInvoice(actor, draft.id);
    const invoiceDraft = await invoiceMail.invoiceMailDraft(invoice.id);
    // Die eigene Vorlage ist deutsch und gilt nur für deutsche Rechnungen
    expect(invoiceDraft.subject).toBe("Invoice 2026-002 from Testfirma");
    expect(invoiceDraft.body).toContain("please find attached Invoice 2026-002 dated 10 Sept 2026 for €1,000.00, payable by 24 Sept 2026.");

    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-09-11");
    expect(storno.language).toBe("en");
    expect((await invoiceMail.invoiceMailDraft(storno.id)).subject).toBe("Cancellation invoice 2026-003 from Testfirma");
    // Deutsche Rechnungen nutzen weiter die eigene Vorlage
    expect((await invoiceMail.invoiceMailDraft(invoiceId)).subject).toBe("Rechnung 2026-001 für Nordwerk Software GmbH");
  });

  it("schickt Mahnungen mit eigenem PDF", async () => {
    await mail.saveMailSettings(actor, settings);
    const created = await dunning.createDunning(
      actor,
      { invoiceId, level: 1, dueDate: "2026-10-25", fee: 0, flatFee: false, interest: null, intro: "Bitte zahlen.", closing: "" },
      "2026-10-15",
    );
    const draft = await invoiceMail.dunningMailDraft(created.id);
    expect(draft.subject).toBe("Zahlungserinnerung zur Rechnung 2026-001");
    expect(draft.body).toContain("Betrag von 1.190,00");
    expect(draft.body).toContain("bis zum 25.10.2026");
    expect(draft.attachments).toEqual(["Zahlungserinnerung-2026-001.pdf"]);
    expect((await invoiceMail.sendDunningMail(actor, created.id, { to: draft.to, subject: draft.subject, body: draft.body })).ok).toBe(true);
    expect(sent[0]!.attachments![0]!.filename).toBe("Zahlungserinnerung-2026-001.pdf");
    expect((await invoiceMail.mailsForInvoice(invoiceId))[0]).toMatchObject({ kind: "mahnung", dunningId: created.id });
  });

  it("verschickt wiederkehrende Rechnungen nach dem Festschreiben und meldet fehlenden Versand", async () => {
    const base = {
      name: "Wartung", active: true, contactId, format: "zugferd" as const, paymentTermDays: 14, note: "", taxTreatment: "regulaer" as const,
      exemptionReason: "", lines: [{ description: "Wartung", quantity: 1000, unit: "Psch." as const, unitPrice: 10_000, taxRate: 1900 as const }],
      intervalMonths: 1 as const, nextDate: "2026-10-01", endDate: null, servicePeriod: "laufend" as const, mode: "festschreiben" as const, sendByMail: true,
    };
    const vorlage = await recurring.createRecurring(actor, base);
    // Ohne E-Mail-Zugang: festgeschrieben, aber Fehler vermerkt
    let run = await recurring.runDueRecurring("2026-10-01");
    expect(run).toMatchObject({ created: 1, finalized: 1, mailed: 0 });
    expect(run.errors[0]).toMatch(/festgeschrieben, E-Mail nicht gesendet: Es ist kein E-Mail-Zugang/);

    await mail.saveMailSettings(actor, settings);
    run = await recurring.runDueRecurring("2026-11-01");
    expect(run).toMatchObject({ created: 1, finalized: 1, mailed: 1, errors: [] });
    expect(sent[0]).toMatchObject({ to: "buchhaltung@nordwerk.example", subject: "Rechnung 2026-003 von Testfirma" });
    const [row] = await sql`select last_error from recurring_invoices where id = ${vorlage.id}`;
    expect(row!.last_error).toBeNull();

    // Entwurf-Modus schickt nie
    const draftOnly = await recurring.createRecurring(actor, { ...base, name: "Nur Entwurf", mode: "entwurf", nextDate: "2026-12-01" });
    const [stored] = await sql`select send_by_mail from recurring_invoices where id = ${draftOnly.id}`;
    expect(stored!.send_by_mail).toBe(false);
  });

  it("füllt Platzhalter und macht HTML sicher", () => {
    expect(invoiceMail.fillTemplate("{a} {b} {unbekannt}", { a: "1", b: "2" })).toBe("1 2 {unbekannt}");
    expect(invoiceMail.textToHtml("Hallo <b>\n\nZeile 1\nZeile 2")).toBe("<p>Hallo &lt;b&gt;</p>\n<p>Zeile 1<br>Zeile 2</p>");
  });
});
