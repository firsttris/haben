import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

type Sent = { text: string; html: string };

/** Text eines PDFs mit pdftotext (poppler-utils), Leerraum zusammengefasst; ohne das Werkzeug null */
function pdfText(pdf: Uint8Array): string | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-35a-"));
  try {
    writeFileSync(join(dir, "beleg.pdf"), pdf);
    return execFileSync("pdftotext", [join(dir, "beleg.pdf"), "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PFLICHTANGABEN = "Sitz der Gesellschaft: Regensburg · Registergericht: Amtsgericht Regensburg, HRB 4711 · Geschäftsführung: Max Mustermann";

/** Pflichtangaben einer GmbH oder UG auf Rechnung, Mahnung und E-Mail (§ 35a Abs. 1 GmbHG) */
describe.skipIf(!testDatabaseUrl)("Geschäftsbriefe nach § 35a GmbHG (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./invoices.ts");
  let invoiceMail: typeof import("./invoice-mail.ts");
  let dunning: typeof import("./dunning.ts");
  let mail: typeof import("../mail/mail.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  const actor = "test-user";
  const sent: Sent[] = [];
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    invoiceMail = await import("./invoice-mail.ts");
    dunning = await import("./dunning.ts");
    mail = await import("../mail/mail.ts");
    contacts = await import("../stammdaten/contacts.ts");
    stammdaten = await import("../stammdaten/index.ts");
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

  /** Firmendaten mit Rechtsform und Kontenrahmen; beide stehen ab der ersten Buchung fest, also vor dem Festschreiben */
  async function company(rechtsform: "einzelunternehmen" | "gmbh" | "ug", kontenrahmen: "SKR03" | "SKR04", angaben = true) {
    const name = rechtsform === "einzelunternehmen" ? "Max Mustermann IT" : "Testfirma GmbH";
    await sql`insert into company (id, name, rechtsform, kontenrahmen, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank,
        registergericht, registernummer, geschaeftsfuehrer)
      values (1, ${name}, ${rechtsform}, ${kontenrahmen}, 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank',
              ${angaben ? "Amtsgericht Regensburg" : ""}, ${angaben ? "HRB 4711" : ""}, ${angaben ? "Max Mustermann" : ""})`;
  }

  async function finalInvoice(format: "zugferd" | "xrechnung-cii" = "zugferd") {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-09-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format,
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    expect(await invoices.finalizeIssues(draft.id)).toEqual([]);
    return invoices.finalizeInvoice(actor, draft.id);
  }

  beforeEach(async () => {
    sent.length = 0;
    await leeren(sql)`truncate mail_log, mail_settings, dunnings, journal_lines, journal_entries, invoice_lines, invoices, recurring_invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    contactId = (
      await contacts.createContact(actor, {
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
      })
    ).id;
  });

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`GmbH (${kontenrahmen}): Pflichtangaben im Absender der Rechnung, im PDF und als BT-30 und BT-33 im XML`, async () => {
      await company("gmbh", kontenrahmen);
      expect(stammdaten.letterIssues(await stammdaten.loadCompany())).toEqual([]);
      const final = await finalInvoice("xrechnung-cii");
      expect(final.seller?.legalInfo).toEqual({
        seat: "Regensburg",
        registerCourt: "Amtsgericht Regensburg",
        registerNumber: "HRB 4711",
        managingDirectors: ["Max Mustermann"],
      });
      expect(final.xml).toContain(`<ram:Description>${PFLICHTANGABEN}</ram:Description>`);
      expect(final.xml).toMatch(/<ram:SpecifiedLegalOrganization>\s*<ram:ID>HRB 4711<\/ram:ID>/);
      const text = pdfText(final.pdf!);
      if (text !== null) expect(text).toContain("Geschäftsführung: Max Mustermann");
    });
  }

  it("UG ohne Registerangaben: Hinweis, aber keine Sperre beim Festschreiben", async () => {
    await company("ug", "SKR04", false);
    const firma = await stammdaten.loadCompany();
    expect(stammdaten.letterIssues(firma)).toEqual(["Registergericht fehlt", "Registernummer fehlt", "Geschäftsführer fehlt"]);
    // „Testfirma GmbH“ nennt nicht die Rechtsform der UG, also steht sie im Fuß
    const final = await finalInvoice();
    expect(final.seller?.legalInfo).toEqual({
      legalForm: "UG (haftungsbeschränkt)",
      seat: "Regensburg",
      registerCourt: "",
      registerNumber: "",
      managingDirectors: [],
    });
    expect(final.status).toBe("final");
  });

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`Einzelunternehmen (${kontenrahmen}): Absender, XML und E-Mail ohne Pflichtangaben`, async () => {
      await company("einzelunternehmen", kontenrahmen);
      expect(stammdaten.letterIssues(await stammdaten.loadCompany())).toEqual([]);
      const final = await finalInvoice("xrechnung-cii");
      expect(final.seller).not.toHaveProperty("legalInfo");
      expect(final.xml).not.toContain("SpecifiedLegalOrganization");
      await mail.saveMailSettings(actor, { ...mailSettings });
      expect((await invoiceMail.invoiceMailDraft(final.id)).signature).toBe("");
      await invoiceMail.sendInvoiceMail(actor, final.id, { to: "a@example.com", subject: "Rechnung", body: "Guten Tag" });
      expect(sent[0]!.text).toBe("Guten Tag");
    });
  }

  it("E-Mail: die Pflichtangaben stehen als Signatur unter dem Text", async () => {
    await company("gmbh", "SKR03");
    const final = await finalInvoice();
    await mail.saveMailSettings(actor, { ...mailSettings });
    const draft = await invoiceMail.invoiceMailDraft(final.id);
    expect(draft.signature).toBe(
      "-- \nTestfirma GmbH\nSitz der Gesellschaft: Regensburg\nRegistergericht: Amtsgericht Regensburg, HRB 4711\nGeschäftsführung: Max Mustermann",
    );
    // Der Text bleibt frei; die Signatur hängt Haben erst beim Senden an
    expect(draft.body).not.toContain("Registergericht");
    await invoiceMail.sendInvoiceMail(actor, final.id, { to: "a@example.com", subject: "Rechnung", body: "Guten Tag" });
    expect(sent[0]!.text).toBe(`Guten Tag\n\n${draft.signature}`);
    expect(sent[0]!.html).toContain("Geschäftsführung: Max Mustermann");
  });

  it("festgeschriebene Rechnung bleibt unverändert; die Mahnung trägt die Angaben von heute", async () => {
    await company("gmbh", "SKR03", false);
    const final = await finalInvoice();
    await sql`update company set registergericht = 'Amtsgericht Regensburg', registernummer = 'HRB 4711', geschaeftsfuehrer = 'Max Mustermann' where id = 1`;
    const [after] = await sql`select seller, pdf_sha256 from invoices where id = ${final.id}`;
    expect(after!.seller.legalInfo.managingDirectors).toEqual([]);
    expect(after!.pdf_sha256).toBe(final.pdfSha256);

    const created = await dunning.createDunning(
      actor,
      { invoiceId: final.id, level: 1, dueDate: "2026-10-25", fee: 0, flatFee: false, interest: null, intro: "Bitte zahlen.", closing: "" },
      "2026-10-15",
    );
    const text = pdfText((await dunning.loadDunningPdf(created.id))!.pdf);
    if (text !== null) expect(text).toContain("Geschäftsführung: Max Mustermann");
  });

  const mailSettings = {
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
});
