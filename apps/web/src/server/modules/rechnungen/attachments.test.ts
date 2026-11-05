import nodemailer from "nodemailer";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { MAX_INVOICE_ATTACHMENTS } from "./attachment-limit.ts";

type Sent = { attachments?: { filename: string; contentType: string; content: Buffer | string }[] };

/** Kleinste Datei, die Haben am Inhalt als PDF erkennt; der Text macht jede Datei eindeutig */
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe.skipIf(!testDatabaseUrl)("Zusätzliche Anhänge an Rechnungen (Postgres)", () => {
  let attachments: typeof import("./attachments.ts");
  let invoices: typeof import("./invoices.ts");
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
    attachments = await import("./attachments.ts");
    invoices = await import("./invoices.ts");
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
    await sql`truncate mail_log, mail_settings, journal_lines, journal_entries, invoice_attachments, invoice_lines, invoices,
      invoice_number_counters, documents, contact_versions, contacts, company cascade`;
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
      email: "buchhaltung@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  });

  async function draft(format: "zugferd" | "xrechnung-cii" = "zugferd") {
    return invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-09-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format,
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
  }

  it("hängt PDF-Dateien an den Entwurf, dieselbe Datei nur einmal, und entfernt sie wieder samt Datei", async () => {
    const { id } = await draft();
    const first = await attachments.addInvoiceAttachment(actor, id, { bytes: pdf("Stundenzettel"), filename: "C:\\Projekte\\Stundenzettel September" });
    const second = await attachments.addInvoiceAttachment(actor, id, { bytes: pdf("Abnahme"), filename: "abnahme.pdf" });
    expect(first.duplicate).toBe(false);
    expect(await attachments.addInvoiceAttachment(actor, id, { bytes: pdf("Stundenzettel"), filename: "nochmal.pdf" })).toEqual({
      id: first.id,
      duplicate: true,
    });

    const list = await attachments.listInvoiceAttachments(id);
    expect(list.map((a) => a.filename)).toEqual(["Stundenzettel September.pdf", "abnahme.pdf"]);
    expect(list[0]!.size).toBe(pdf("Stundenzettel").byteLength);
    const loaded = await attachments.loadInvoiceAttachment(second.id);
    expect(loaded).toMatchObject({ filename: "abnahme.pdf", mimeType: "application/pdf" });
    expect(new TextDecoder().decode(loaded!.bytes)).toContain("Abnahme");

    const [audit] = await sql`select count(*)::int as n from audit_log where table_name = 'invoice_attachments' and action = 'INSERT'`;
    expect(audit!.n).toBe(2);

    await attachments.removeInvoiceAttachment(actor, id, second.id);
    expect((await attachments.listInvoiceAttachments(id)).map((a) => a.id)).toEqual([first.id]);
    await expect(storage.loadFile(storage.sha256Of(pdf("Abnahme")))).rejects.toThrow();
    await expect(attachments.removeInvoiceAttachment(actor, id, second.id)).rejects.toThrow("Anhang nicht gefunden.");
  });

  it("prüft Typ am Inhalt und Größe: nur PDF, nicht leer, höchstens 20 MB", async () => {
    const { id } = await draft();
    await expect(attachments.addInvoiceAttachment(actor, id, { bytes: PNG, filename: "foto.pdf" })).rejects.toThrow(
      "foto.pdf: Als Anhang sind nur PDF-Dateien erlaubt.",
    );
    await expect(attachments.addInvoiceAttachment(actor, id, { bytes: new Uint8Array(0), filename: "leer.pdf" })).rejects.toThrow(
      "leer.pdf: Die Datei ist leer.",
    );
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set(pdf("groß"));
    await expect(attachments.addInvoiceAttachment(actor, id, { bytes: big, filename: "gross.pdf" })).rejects.toThrow("gross.pdf: größer als 20 MB.");
    expect(attachments.attachmentFileProblem({ bytes: pdf("ok"), filename: "ok.pdf" })).toBeNull();
    expect(await attachments.listInvoiceAttachments(id)).toEqual([]);
  });

  it("höchstens zehn Anhänge je Rechnung", async () => {
    const { id } = await draft();
    for (let i = 0; i < MAX_INVOICE_ATTACHMENTS; i++) {
      await attachments.addInvoiceAttachment(actor, id, { bytes: pdf(`Nachweis ${i}`), filename: `nachweis-${i}.pdf` });
    }
    await expect(attachments.addInvoiceAttachment(actor, id, { bytes: pdf("elf"), filename: "elf.pdf" })).rejects.toThrow("Höchstens 10 Anhänge je Rechnung.");
  });

  it("sperrt die Anhänge mit dem Festschreiben, in der App und in der Datenbank, und versiegelt sie mit der Rechnung", async () => {
    const { id } = await draft();
    const { id: attachmentId } = await attachments.addInvoiceAttachment(actor, id, { bytes: pdf("Stundenzettel"), filename: "stundenzettel.pdf" });
    await invoices.finalizeInvoice(actor, id);

    await expect(attachments.addInvoiceAttachment(actor, id, { bytes: pdf("später"), filename: "spaeter.pdf" })).rejects.toThrow(/festgeschrieben/);
    await expect(attachments.removeInvoiceAttachment(actor, id, attachmentId)).rejects.toThrow(/festgeschrieben/);
    await expect(sql`delete from invoice_attachments where id = ${attachmentId}`).rejects.toThrow(/Anhänge sind unveränderlich/);
    await expect(sql`update invoice_attachments set filename = 'anders.pdf' where id = ${attachmentId}`).rejects.toThrow(/Anhänge sind unveränderlich/);
    await expect(
      sql`insert into invoice_attachments (invoice_id, filename, mime_type, sha256, size) values (${id}, 'x.pdf', 'application/pdf', ${"a".repeat(64)}, 1)`,
    ).rejects.toThrow(/Anhänge sind unveränderlich/);

    // Weiterhin abrufbar
    expect((await attachments.loadInvoiceAttachment(attachmentId))?.filename).toBe("stundenzettel.pdf");

    // Das Siegel der Rechnung schließt die Anhänge ein; die Integritätsprüfung findet nichts
    const [seal] = await sql`select columns from seals where table_name = 'invoices' and row_id = ${id}`;
    expect(seal!.columns).toHaveProperty("invoice_attachments");
    const problems = await sql`select * from haben_integrity_problems()`;
    expect(problems).toEqual([]);
  });

  it("ein Siegel ohne Anhänge in seinen Spalten (vor 0123) ergibt denselben Inhalt wie bisher", async () => {
    const { id } = await draft();
    await invoices.finalizeInvoice(actor, id);
    const [row] = await sql`
      select haben_seal_digest('invoices', ${id}::uuid, s.columns - 'invoice_attachments') as ohne,
             encode(sha256(convert_to(jsonb_build_object(
               'invoices', (select haben_pick(to_jsonb(i), s.columns -> 'invoices') from invoices i where i.id = ${id}),
               'invoice_lines', (select coalesce(jsonb_agg(haben_pick(to_jsonb(l), s.columns -> 'invoice_lines') order by l.id), '[]'::jsonb)
                                   from invoice_lines l where l.invoice_id = ${id}),
               'invoice_taxes', (select coalesce(jsonb_agg(haben_pick(to_jsonb(t), s.columns -> 'invoice_taxes') order by t.rate), '[]'::jsonb)
                                   from invoice_taxes t where t.invoice_id = ${id}))::text, 'UTF8')), 'hex') as bisher
        from seals s where s.table_name = 'invoices' and s.row_id = ${id}`;
    expect(row!.ohne).toBe(row!.bisher);
  });

  it("ein gelöschter Entwurf nimmt seine Anhänge und deren Dateien mit", async () => {
    const { id } = await draft();
    await attachments.addInvoiceAttachment(actor, id, { bytes: pdf("Entwurf"), filename: "entwurf.pdf" });
    await invoices.deleteDraft(actor, id);
    expect(await sql`select id from invoice_attachments`).toEqual([]);
    await expect(storage.loadFile(storage.sha256Of(pdf("Entwurf")))).rejects.toThrow();
  });

  it("die Datei bleibt liegen, solange ein Beleg sie nutzt", async () => {
    const belege = await import("../belege/index.ts");
    const bytes = pdf("geteilt");
    await belege.uploadDocument(actor, { bytes, filename: "beleg.pdf" });
    const { id } = await draft();
    const attachment = await attachments.addInvoiceAttachment(actor, id, { bytes, filename: "anhang.pdf" });
    await attachments.removeInvoiceAttachment(actor, id, attachment.id);
    expect(new TextDecoder().decode(await storage.loadFile(storage.sha256Of(bytes)))).toContain("geteilt");
  });

  it("versendet nur die ausgewählten Anhänge; das Protokoll nennt die tatsächlich versandten Dateien", async () => {
    const { id } = await draft("xrechnung-cii");
    const zettel = await attachments.addInvoiceAttachment(actor, id, { bytes: pdf("Stundenzettel"), filename: "stundenzettel.pdf" });
    await attachments.addInvoiceAttachment(actor, id, { bytes: pdf("Intern"), filename: "intern.pdf" });
    const final = await invoices.finalizeInvoice(actor, id);
    await mail.saveMailSettings(actor, {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      username: "max",
      password: "geheim",
      fromAddress: "rechnung@testfirma.example",
      reminderTo: "max@testfirma.example",
      remindersEnabled: false,
      reminderDays: [],
    });

    const mailDraft = await invoiceMail.invoiceMailDraft(id);
    expect(mailDraft.attachments).toEqual([`Rechnung-${final.number}.pdf`, `Rechnung-${final.number}-cii.xml`]);
    expect(mailDraft.extraAttachments.map((a) => a.filename)).toEqual(["stundenzettel.pdf", "intern.pdf"]);

    const result = await invoiceMail.sendInvoiceMail(actor, id, {
      to: "buchhaltung@nordwerk.example",
      subject: "Rechnung",
      body: "Anbei.",
      attachmentIds: [zettel.id],
    });
    expect(result.ok).toBe(true);
    const files = [`Rechnung-${final.number}.pdf`, `Rechnung-${final.number}-cii.xml`, "stundenzettel.pdf"];
    expect(sent[0]!.attachments!.map((a) => a.filename)).toEqual(files);
    // Der JSON-Transport von nodemailer legt den Inhalt als Base64 ab
    expect(Buffer.from(String(sent[0]!.attachments![2]!.content), "base64").toString()).toContain("Stundenzettel");
    const [log] = await invoiceMail.mailsForInvoice(id);
    expect(log!.attachments).toEqual(files);

    // Ohne Auswahl gehen nur PDF und XML
    await invoiceMail.sendInvoiceMail(actor, id, { to: "buchhaltung@nordwerk.example", subject: "Rechnung", body: "Anbei." });
    expect(sent[1]!.attachments!.map((a) => a.filename)).toEqual(files.slice(0, 2));

    // Ein Anhang einer anderen Rechnung lässt sich nicht unterschieben
    const other = await draft();
    const foreign = await attachments.addInvoiceAttachment(actor, other.id, { bytes: pdf("fremd"), filename: "fremd.pdf" });
    await expect(
      invoiceMail.sendInvoiceMail(actor, id, { to: "buchhaltung@nordwerk.example", subject: "Rechnung", body: "Anbei.", attachmentIds: [foreign.id] }),
    ).rejects.toThrow("Ein gewählter Anhang gehört nicht zu dieser Rechnung.");
    expect(sent).toHaveLength(2);
  });

  it("das Jahresarchiv enthält die Anhänge festgeschriebener Rechnungen mit anhaenge.csv, Entwürfe nicht", async () => {
    const { id } = await draft();
    await attachments.addInvoiceAttachment(actor, id, { bytes: pdf("Stundenzettel"), filename: "Stundenzettel September.pdf" });
    const final = await invoices.finalizeInvoice(actor, id);
    const open = await draft();
    await attachments.addInvoiceAttachment(actor, open.id, { bytes: pdf("Entwurf"), filename: "entwurf.pdf" });

    const { unzipSync } = await import("fflate");
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2026)) chunks.push(chunk);
    const zip = unzipSync(Buffer.concat(chunks));
    const path = `rechnungen/anhaenge/${final.number}_Stundenzettel-September.pdf`;
    expect(new TextDecoder().decode(zip[path]!)).toContain("Stundenzettel");
    expect(Object.keys(zip).filter((p) => p.startsWith("rechnungen/anhaenge/"))).toEqual([path, "rechnungen/anhaenge/anhaenge.csv"]);
    const csv = new TextDecoder().decode(zip["rechnungen/anhaenge/anhaenge.csv"]!);
    expect(csv).toContain(`${final.number};Stundenzettel September.pdf;${final.number}_Stundenzettel-September.pdf;`);
    expect(csv).toContain(storage.sha256Of(pdf("Stundenzettel")));
    expect(new TextDecoder().decode(zip["pruefsummen.sha256"]!)).toContain(path);
  });
});
