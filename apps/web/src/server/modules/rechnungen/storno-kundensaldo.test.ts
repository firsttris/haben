import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const debit = "Nach dieser Stornierung übersteigen die offenen Rechnungsbeträge rechnerisch Ihr Guthaben.";
const credit = "Nach dieser Stornierung verbleibt rechnerisch ein Guthaben zu Ihren Gunsten.";
const balanced = "Nach dieser Stornierung ist der Saldo Ihrer offenen Rechnungen und Gutschriften rechnerisch ausgeglichen.";

describe.skipIf(!testDatabaseUrl)("Kundensaldo im Stornohinweis (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let bank: typeof import("../bank/index.ts");
  let contactId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    contacts = await import("../stammdaten/index.ts");
    bank = await import("../bank/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  const contact = (kundennummer: string) =>
    contacts.createContact(actor, {
      kundennummer,
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
    });

  beforeEach(async () => {
    await leeren(sql)`truncate cash_entries, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, kleinunternehmer, iban)
      values (1, 'Musterwerk Testbetrieb', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', '', 'BY', true, 'DE89370400440532013000')`;
    contactId = (await contact("10001")).id;
  });

  const input = (gross: number, customer = contactId) => ({
    contactId: customer,
    issueDate: "2026-11-10",
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "xrechnung-ubl" as const,
    note: "",
    taxTreatment: "kleinunternehmer" as const,
    lines: [{ description: "Beispielleistung", quantity: 1000, unit: "Psch." as const, unitPrice: gross, taxRate: 0 as const }],
  });

  async function original(gross = 100, payment = 0, customer = contactId) {
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input(gross, customer))).id);
    if (payment > 0) await bank.createCashInvoiceEntry(actor, { invoiceId: final.id, date: "2026-11-11", amount: payment }, "2026-11-13");
    return final;
  }

  async function correction(id: string, gross: number) {
    const draft = await invoices.createCorrection(actor, id, "2026-11-11");
    await invoices.updateDraft(actor, draft.id, { ...input(-gross), issueDate: "2026-11-11", paymentTermDays: 0 });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function transfer(invoiceId: string, amount: number) {
    const label = `Zahlung ${invoiceId} ${amount}`;
    const absolute = Math.abs(amount);
    const value = `${amount < 0 ? "-" : ""}${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
    const csv = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n"13.11.26";"13.11.26";"Gebucht";"Beispielkunde";"Musterwerk";"${label}";"${amount < 0 ? "Ausgang" : "Eingang"}";"DE02100100100006820101";"${value}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `${invoiceId}.csv` }, null);
    const [transaction] = await sql`select id from bank_transactions where purpose = ${label}`;
    await bank.allocate(actor, { kind: "invoice", transactionId: transaction!.id, invoiceId, amount });
  }

  function verify(invoice: { pdf: Buffer | null; xml: string | null }, sentence: string, evidence?: string) {
    const directory = process.env.HABEN_SALDO_EVIDENCE_DIR;
    if (directory && evidence) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, `${evidence}.pdf`), invoice.pdf!);
    }
    const text = execFileSync("pdftotext", ["-", "-"], { input: invoice.pdf!, encoding: "utf8" }).replace(/\s+/g, " ");
    expect(text).toContain(sentence);
    expect(invoice.xml).toContain(sentence);
    expect(text).not.toMatch(/wird Ihnen erstattet|Zahlungen werden erstattet|Bitte überweisen/);
    expect(invoice.xml).not.toMatch(/wird Ihnen erstattet|Zahlungen werden erstattet|Bitte überweisen/);
  }

  async function customerOpen() {
    return (await invoices.listInvoices("2026-11-13")).filter((i) => i.contactId === contactId).reduce((sum, i) => sum + i.open, 0);
  }

  it.each([
    { payment: 100, other: 150, balance: 50, sentence: debit },
    { payment: 100, other: 100, balance: 0, sentence: balanced },
    { payment: 100, other: 50, balance: -50, sentence: credit },
    { payment: 50, other: 25, balance: -25, sentence: credit },
    { payment: 0, other: 25, balance: 25, sentence: debit },
    { payment: 0, other: 0, balance: 0, sentence: balanced },
  ])("$payment Cent Zahlung und $other Cent weitere Forderung ergeben $balance Cent", async ({ payment, other, balance, sentence }) => {
    const invoice = await original(100, payment);
    if (other) await original(other);
    const [before] = await sql`select (select count(*)::int from allocations) as allocations, (select count(*)::int from cash_entries) as cash`;
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-11-12");
    verify(storno, sentence, payment === 100 && other === 150 ? "storno-soll" : undefined);
    expect(await customerOpen()).toBe(balance);
    const [after] = await sql`select (select count(*)::int from allocations) as allocations, (select count(*)::int from cash_entries) as cash`;
    expect(after).toEqual(before);
    const list = await invoices.listInvoices("2026-11-13");
    expect(list.find((i) => i.id === invoice.id)!.open).toBe(0);
    expect(list.find((i) => i.id === storno.id)!.open).toBe(0 - payment);
  });

  it("projiziert auch alle Korrekturstornos und fordert auf dem positiven Storno keine Zahlung", async () => {
    const invoice = await original(100, 100);
    const reduction = await correction(invoice.id, 20);
    await original(110);
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-11-12");
    verify(storno, debit);
    const [correctionStorno] = await sql<{ pdf: Buffer; xml: string; gross: number }[]>`
      select pdf, xml, gross from invoices where corrects_id = ${reduction.id} and kind = 'storno'`;
    expect(correctionStorno!.gross).toBe(20);
    verify(correctionStorno!, debit);
    expect(await customerOpen()).toBe(10);
  });

  it("berücksichtigt vorhandene Guthaben und schon erstattete Teilbeträge", async () => {
    const paid = await original(100, 100);
    const priorStorno = await invoices.cancelInvoice(actor, paid.id, "2026-11-12");
    await transfer(priorStorno.id, -40);
    const unpaid = await original();
    verify(await invoices.cancelInvoice(actor, unpaid.id, "2026-11-13"), credit);
    expect(await customerOpen()).toBe(-60);
  });

  it("zählt Forderungen gleichnamiger anderer Kontakte nicht mit", async () => {
    const invoice = await original(100, 100);
    const other = (await contact("10002")).id;
    await original(500, 0, other);
    await invoices.createDraft(actor, input(1000));
    verify(await invoices.cancelInvoice(actor, invoice.id, "2026-11-12"), credit);
    expect(await customerOpen()).toBe(-100);
  });

  it("summiert mehrere offene Rechnungen, Teilzahlungen und eine weitere Rechnungskorrektur", async () => {
    const invoice = await original(100, 50);
    const other = await original(80, 20);
    await correction(other.id, 30);
    await original(40);
    verify(await invoices.cancelInvoice(actor, invoice.id, "2026-11-12"), debit);
    expect(await customerOpen()).toBe(20);
  });

  it("rechnet bei Fremdwährung mit gespeicherten Eurobeträgen", async () => {
    const draft = await invoices.createDraft(actor, { ...input(200), currency: "USD", exchangeRate: "2", exchangeRateDate: "2026-11-10" });
    const invoice = await invoices.finalizeInvoice(actor, draft.id);
    expect(invoice.gross).toBe(100);
    await transfer(invoice.id, 100);
    await original(150);
    verify(await invoices.cancelInvoice(actor, invoice.id, "2026-11-13"), debit);
    expect(await customerOpen()).toBe(50);
  });

  it("hält Original und ausgestellten Storno nach späterem Zahlungsausgleich unverändert", async () => {
    const invoice = await original(100, 100);
    const other = await original(150);
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-11-12");
    verify(storno, debit);
    await transfer(other.id, 150);
    expect(await customerOpen()).toBe(-100);
    const rows = await sql<{ id: string; pdf: Buffer; xml: string; pdf_sha256: string; xml_sha256: string }[]>`
      select id, pdf, xml, pdf_sha256, xml_sha256 from invoices where id in (${invoice.id}, ${storno.id})`;
    for (const original of [invoice, storno]) {
      expect(rows.find((r) => r.id === original.id)).toEqual({
        id: original.id,
        pdf: original.pdf,
        xml: original.xml,
        pdf_sha256: original.pdfSha256,
        xml_sha256: original.xmlSha256,
      });
    }
    verify(rows.find((r) => r.id === storno.id)!, debit);
  });
});
