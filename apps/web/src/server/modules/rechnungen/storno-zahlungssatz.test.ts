import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEInvoiceXml } from "@haben/einvoice";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Zahlungssatz bei Storno und Korrektur (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let bank: typeof import("../bank/index.ts");
  let contactId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    bank = await import("../bank/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate cash_entries, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, kleinunternehmer, iban)
      values (1, 'Musterwerk Testbetrieb', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', '', 'BY', true, 'DE89370400440532013000')`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001",
        name: "Beispielkunde",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "kunde@example.com",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  async function original(payment = 0, language: "de" | "en" = "de", format: "xrechnung-ubl" | "xrechnung-cii" | "zugferd" = "xrechnung-ubl", gross = 100) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-11-10",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format,
      language,
      note: "",
      taxTreatment: "kleinunternehmer",
      lines: [{ description: "Beispielleistung", quantity: 1000, unit: "Psch.", unitPrice: gross, taxRate: 0 }],
    });
    const final = await invoices.finalizeInvoice(actor, draft.id);
    if (payment > 0) await bank.createCashInvoiceEntry(actor, { invoiceId: final.id, date: "2026-11-11", amount: payment }, "2026-11-13");
    return final;
  }

  function textOf(pdf: Uint8Array) {
    return execFileSync("pdftotext", ["-", "-"], { input: pdf, encoding: "utf8" }).replace(/\s+/g, " ");
  }

  it("sagt bei unbezahltem Storno in PDF und XML keine Erstattung zu", async () => {
    const invoice = await original();
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-11-12");
    const evidence = process.env.HABEN_716_EVIDENCE_DIR;
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      writeFileSync(join(evidence, "storno-unbezahlt.pdf"), storno.pdf!);
    }
    expect(textOf(storno.pdf!)).not.toContain("Der Betrag wird Ihnen erstattet.");
    expect(storno.xml).not.toContain("Der Betrag wird Ihnen erstattet.");
    expect(textOf(storno.pdf!)).toContain("Die ursprüngliche Rechnung wird storniert.");
    expect(parseEInvoiceXml(storno.xml!).paymentTerms).toBe("Die ursprüngliche Rechnung wird storniert.");
    const [preserved] = await sql`select pdf, xml from invoices where id = ${invoice.id}`;
    expect(preserved!.pdf).toEqual(invoice.pdf);
    expect(preserved!.xml).toBe(invoice.xml);
  });

  it.each([50, 100])("bleibt bei %i Cent Zahlung in PDF und XML neutral", async (payment) => {
    const invoice = await original(payment);
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-11-12");
    expect(textOf(storno.pdf!)).toContain("Die ursprüngliche Rechnung wird storniert.");
    expect(parseEInvoiceXml(storno.xml!).paymentTerms).toBe("Die ursprüngliche Rechnung wird storniert.");
    expect(storno.xml).not.toContain("Bereits geleistete Zahlungen werden erstattet.");
    expect(textOf(storno.pdf!)).not.toContain("Der Betrag wird Ihnen erstattet.");
  });

  it("verspricht bei einer unbezahlten Rechnungskorrektur keine Auszahlung", async () => {
    const invoice = await original();
    const correction = await invoices.finalizeInvoice(actor, (await invoices.createCorrection(actor, invoice.id, "2026-11-12")).id);
    expect(textOf(correction.pdf!)).not.toContain("Der Betrag wird Ihnen erstattet.");
    expect(correction.xml).not.toContain("Der Betrag wird Ihnen erstattet.");
  });


  async function refund(invoiceId: string, amount: number) {
    const purpose = `Erstattung ${invoiceId}`;
    const value = `-${Math.floor(amount / 100)},${String(amount % 100).padStart(2, "0")}`;
    const csv = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n"13.11.26";"13.11.26";"Gebucht";"Musterwerk";"Beispielkunde";"${purpose}";"Ausgang";"DE02100100100006820101";"${value}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `${invoiceId}.csv` }, null);
    const [transaction] = await sql`select id from bank_transactions where purpose = ${purpose}`;
    await bank.allocate(actor, { kind: "invoice", transactionId: transaction!.id, invoiceId, amount: -amount });
  }

  const cases = (["xrechnung-ubl", "xrechnung-cii", "zugferd"] as const).flatMap((format) =>
    (["de", "en"] as const).flatMap((language) =>
      [
        { state: "unbezahlt", payment: 0, refunded: false },
        { state: "teilbezahlt", payment: 50, refunded: false },
        { state: "bezahlt", payment: 100, refunded: false },
        { state: "Korrektur erstattet", payment: 100, refunded: true },
      ].map((entry) => ({ ...entry, language, format })),
    ),
  );

  it.each(cases)("Storno und positives Korrekturstorno: $state, $language, $format", async ({ payment, refunded, language, format }) => {
    const invoice = await original(payment, language, format);
    const draft = await invoices.createCorrection(actor, invoice.id, "2026-11-11");
    await invoices.updateDraft(actor, draft.id, {
      contactId, issueDate: "2026-11-11", serviceFrom: null, serviceTo: null, paymentTermDays: 0, format, language, note: "", taxTreatment: "kleinunternehmer",
      lines: [{ description: "Korrektur", quantity: 1000, unit: "Psch.", unitPrice: -20, taxRate: 0 }],
    });
    const correction = await invoices.finalizeInvoice(actor, draft.id);
    if (refunded) await refund(correction.id, 20);
    await original(0, language, format, 150);
    const [before] = await sql`select (select count(*)::int from allocations) as allocations, (select count(*)::int from cash_entries) as cash`;
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-11-13");
    const [correctionStorno] = await sql<{ pdf: Buffer; xml: string; gross: number }[]>`
      select pdf, xml, gross from invoices where corrects_id = ${correction.id} and kind = 'storno'`;
    expect(correctionStorno!.gross).toBe(20);
    const sentence = language === "en" ? "The original invoice is cancelled." : "Die ursprüngliche Rechnung wird storniert.";
    for (const document of [storno, correctionStorno!]) {
      const text = textOf(document.pdf!);
      expect(text).toContain(sentence);
      expect(parseEInvoiceXml(document.xml!).paymentTerms).toBe("Die ursprüngliche Rechnung wird storniert.");
      expect(text).not.toMatch(/Kundenkonto|customer account|erstattet|refunded|Bitte überweisen|Please transfer/);
    }
    const [after] = await sql`select (select count(*)::int from allocations) as allocations, (select count(*)::int from cash_entries) as cash`;
    expect(after).toEqual(before);
    if (refunded) {
      await refund(storno.id, 100);
      for (const saved of [invoice, correction, storno]) {
        const [preserved] = await sql`select pdf, xml, pdf_sha256, xml_sha256 from invoices where id = ${saved.id}`;
        expect(preserved).toEqual({ pdf: saved.pdf, xml: saved.xml, pdf_sha256: saved.pdfSha256, xml_sha256: saved.xmlSha256 });
      }
    }
  });
});
