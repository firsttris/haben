import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n") + "\n");
}

describe.skipIf(!testDatabaseUrl)("Review: Storno und Korrektur (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  const line = (unitPrice: number, taxRate: 1900 | 700 | 0 = 1900, quantity = 1000) => ({
    description: "Frontend-Entwicklung",
    quantity,
    unit: "Std." as const,
    unitPrice,
    taxRate,
  });

  const draft = (lines = [line(100_000)], extra: Record<string, unknown> = {}) => ({
    contactId,
    issueDate: "2026-10-02",
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines,
    ...extra,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, versteuerung)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', 'soll')`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
        email: "buchhaltung@nordwerk.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
      })
    ).id;
  });

  async function corrected() {
    // 1.000 € + 190 € = 1.190 €, fällig am 16.10.2026; Korrektur um 200 € + 38 € = 238 €
    const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft())).id);
    const correction = await invoices.createCorrection(actor, original.id, "2026-10-05");
    await invoices.updateDraft(actor, correction.id, { ...draft([line(-20_000)]), issueDate: "2026-10-05", paymentTermDays: 0 });
    return { original, correction: await invoices.finalizeInvoice(actor, correction.id) };
  }

  async function pay(invoiceId: string, amount: number, date: string) {
    const bank = await import("../bank/bank.ts");
    const label = `Zahlung ${invoiceId.slice(0, 8)} ${amount}`;
    const euros = (Math.abs(amount) / 100).toFixed(2).replace(".", ",");
    await bank.importStatement(actor, { bytes: dkbCsv([[date, date, "Gebucht", "Nordwerk", "Testfirma", label, amount < 0 ? "Ausgang" : "Eingang", "DE02100100100006820101", `${amount < 0 ? "-" : ""}${euros}`, "", "", ""]]), filename: `${label}.csv` }, null);
    const [tx] = await sql`select id from bank_transactions where purpose = ${label}`;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId, amount });
  }

  it("Storno einer korrigierten Rechnung nimmt den Rest zurück: Umsatz, Steuer und offene Beträge gehen auf 0", async () => {
    const { original, correction } = await corrected();
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-10-06");
    // Rechnung + Korrektur + Storno: weder Umsatz noch Steuer bleiben übrig
    const [sum] = await sql`select sum(net)::int as net, sum(tax)::int as tax from invoices where status = 'final'`;
    expect(sum).toEqual({ net: 0, tax: 0 });
    expect(storno.gross).toBe(-95_200);
    // Die Korrektur ist mit storniert, nichts mehr offen
    const list = await invoices.listInvoices("2026-10-29");
    const byId = new Map(list.map((i) => [i.id, i]));
    expect(byId.get(correction.id)).toMatchObject({ listStatus: "storniert", open: 0 });
    expect(byId.get(original.id)).toMatchObject({ listStatus: "storniert", open: 0 });
    expect(byId.get(storno.id)!.open).toBe(0);
  }, 60_000);

  it("nach einer vollständigen Korrektur bleibt dem Storno nichts zurückzunehmen", async () => {
    const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft())).id);
    await invoices.finalizeInvoice(actor, (await invoices.createCorrection(actor, original.id, "2026-10-05")).id);
    await expect(invoices.cancelInvoice(actor, original.id, "2026-10-06")).rejects.toThrow(/vollständig gemindert/);
  }, 60_000);

  it("Storno einer bezahlten, korrigierten Rechnung: zu erstatten ist, was gezahlt wurde, einmal", async () => {
    const bank = await import("../bank/bank.ts");
    const { original, correction } = await corrected();
    await pay(original.id, 119_000, "07.10.26");
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-10-08");
    const list = await invoices.listInvoices("2026-10-29");
    const open = new Map(list.filter((i) => i.open !== 0).map((i) => [i.id, i.open]));
    // 1.190 € gezahlt, nichts erstattet: genau 1.190 € zurück, nicht zusätzlich die 238 € der Korrektur
    expect(open).toEqual(new Map([[storno.id, -119_000]]));
    const items = (await bank.openItems()).filter((i) => i.type === "invoice");
    expect(new Map(items.map((i) => [i.id, i.open]))).toEqual(open);
    // Die Korrektur nimmt keine Zahlung mehr an; die Erstattung gehört zur Stornorechnung
    const label = "Erstattung Korrektur";
    await bank.importStatement(actor, { bytes: dkbCsv([["09.10.26", "09.10.26", "Gebucht", "Nordwerk", "Testfirma", label, "Ausgang", "DE02100100100006820101", "-238,00", "", "", ""]]), filename: "e.csv" }, null);
    const [tx] = await sql`select id from bank_transactions where purpose = ${label}`;
    await expect(bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: correction.id, amount: -23_800 })).rejects.toThrow(/storniert/);
  }, 60_000);

  it("Mahnung einer korrigierten Rechnung fordert nur den geminderten Betrag", async () => {
    const dunning = await import("./dunning.ts");
    const { original } = await corrected();
    const proposal = await dunning.dunningDraft(original.id, "2026-10-29");
    // Der Kunde schuldet nach der Korrektur 952 €
    expect(proposal.invoice.open).toBe(95_200);
    expect((await dunning.overdueInvoices("2026-10-29")).find((i) => i.id === original.id)?.open).toBe(95_200);
  }, 60_000);

  it("eine vollständig korrigierte Rechnung ist nicht zu mahnen", async () => {
    const dunning = await import("./dunning.ts");
    const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft())).id);
    await invoices.finalizeInvoice(actor, (await invoices.createCorrection(actor, original.id, "2026-10-05")).id);
    expect((await dunning.overdueInvoices("2026-10-29")).map((i) => i.id)).not.toContain(original.id);
    await expect(dunning.dunningDraft(original.id, "2026-10-29")).rejects.toThrow(/nichts offen/);
  }, 60_000);

  it("Mehrere Korrekturen mindern eine Rechnung höchstens bis auf 0", async () => {
    const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft())).id);
    const first = await invoices.createCorrection(actor, original.id, "2026-10-05");
    await invoices.updateDraft(actor, first.id, { ...draft([line(-80_000)]), issueDate: "2026-10-05", paymentTermDays: 0 });
    await invoices.finalizeInvoice(actor, first.id);
    const second = await invoices.createCorrection(actor, original.id, "2026-10-06");
    await invoices.updateDraft(actor, second.id, { ...draft([line(-80_000)]), issueDate: "2026-10-06", paymentTermDays: 0 });
    // 1.000 € − 800 € − 800 € = −600 €: die Rechnung wäre unter 0 gemindert
    await expect(invoices.finalizeInvoice(actor, second.id)).rejects.toThrow();
  }, 60_000);

  it("Kleinunternehmer-Rechnung lässt sich nach dem Wechsel zur Regelbesteuerung noch stornieren", async () => {
    await sql`update company set kleinunternehmer = true`;
    const original = await invoices.finalizeInvoice(
      actor,
      (await invoices.createDraft(actor, draft([line(100_000, 0)], { taxTreatment: "kleinunternehmer", issueDate: "2025-11-03" }))).id,
    );
    // Ausschalten geht jederzeit
    await sql`update company set kleinunternehmer = false`;
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-10-06");
    expect(storno).toMatchObject({ kind: "storno", status: "final", gross: -100_000, taxTreatment: "kleinunternehmer" });
  }, 60_000);
});
