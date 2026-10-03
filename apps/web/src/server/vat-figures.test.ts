import { FakeElsterClient } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n") + "\n");
}

const row = (date: string, name: string, purpose: string, amount: string, type = "Eingang") =>
  type === "Eingang"
    ? [date, date, "Gebucht", name, "Tristan Teufel", purpose, "Eingang", "DE02100100100006820101", amount, "", "", ""]
    : [date, date, "Gebucht", "Tristan Teufel", name, purpose, "Ausgang", "DE02100100100006820101", amount, "", "", ""];

describe.skipIf(!testDatabaseUrl)("Voranmeldung aus Buchungen (Postgres)", () => {
  let figures: typeof import("./vat-figures.ts");
  let vat: typeof import("./vat.ts");
  let bank: typeof import("./bank.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("./contacts.ts");
  let documents: typeof import("./documents.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const october = { year: 2026, month: 10 };

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("./vat-figures.ts");
    vat = await import("./vat.ts");
    bank = await import("./bank.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("./contacts.ts");
    documents = await import("./documents.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate vat_return_submissions, vat_returns, elster_certificates, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
  });

  async function invoice(lines: { net: number; rate: 1900 | 700 }[], issueDate = "2026-09-20") {
    const contact = await contacts.createContact(actor, {
      kundennummer: "", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
      email: "a@b.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id, issueDate, serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd", note: "",
      lines: lines.map((l) => ({ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: l.net, taxRate: l.rate })),
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function bookedDocument(date: string, net: number, tax: number) {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, net % 256, tax % 256, 1]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: "b.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Hetzner Online GmbH", supplierUstId: "", invoiceNumber: "R1", documentDate: date, dueDate: null,
      category: "edv", payment: "bank", note: "", amounts: [{ taxRate: 1900, net, tax }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  it("Ist: Umsatzsteuer nach Zahlungseingang, anteilig, Vorsteuer nach Belegdatum", async () => {
    const inv = await invoice([{ net: 400_000, rate: 1900 }, { net: 100_000, rate: 700 }]);
    await bookedDocument("2026-10-05", 3_240, 616);
    await bookedDocument("2026-09-28", 1_000, 190);
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([row("01.10.26", "Nordwerk", `RE ${inv.number} Teil 1`, "3.000,00"), row("28.09.26", "Nordwerk", "Abschlag", "500,00")]), filename: "a.csv" },
      null,
    );
    const txs = await sql`select id, booking_date from bank_transactions order by booking_date desc`;
    await bank.allocate(actor, { kind: "invoice", transactionId: txs[0]!.id, invoiceId: inv.id, amount: 300_000 });
    await bank.allocate(actor, { kind: "invoice", transactionId: txs[1]!.id, invoiceId: inv.id, amount: 50_000 });

    const oct = await figures.computeVatFigures(october);
    // 3.000 € von 5.830 € brutto: anteilig auf 19 % und 7 %
    expect(oct.kz81 + oct.tax81 + oct.kz86 + oct.tax86).toBe(300_000);
    expect(oct.tax81).toBe(Math.round((76_000 * 300_000) / 583_000));
    expect(oct.revenue.every((r) => r.type === "payment" && r.date === "2026-10-01")).toBe(true);
    expect(oct.kz66).toBe(616);
    expect(oct.inputTax).toHaveLength(1);

    const sep = await figures.computeVatFigures({ year: 2026, month: 9 });
    expect(sep.kz81 + sep.tax81 + sep.kz86 + sep.tax86).toBe(50_000);
    expect(sep.kz66).toBe(190);

    // Aufheben der Zuordnung nimmt die Umsatzsteuer wieder heraus
    const [allocation] = await sql`select id from allocations where amount = 300000`;
    await bank.reverseAllocation(actor, allocation!.id);
    const after = await figures.computeVatFigures(october);
    expect(after.kz81 + after.tax81 + after.kz86 + after.tax86).toBe(0);
  }, 30_000);

  it("Soll: Umsatzsteuer nach Rechnungsdatum", async () => {
    await sql`update company set versteuerung = 'soll'`;
    await invoice([{ net: 400_000, rate: 1900 }], "2026-10-02");
    await invoice([{ net: 100_000, rate: 1900 }], "2026-09-30");
    const oct = await figures.computeVatFigures(october);
    expect(oct).toMatchObject({ versteuerung: "soll", kz81: 400_000, tax81: 76_000, kz86: 0 });
    expect(oct.revenue[0]).toMatchObject({ type: "invoice", date: "2026-10-02" });
  }, 30_000);

  it("Vorprüfung meldet offene Umsätze, ungebuchte Belege und Entwürfe", async () => {
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([row("03.10.26", "Telekom", "Mobilfunk", "-45,90", "Ausgang"), row("04.10.26", "Kunde", "Zahlung", "100,00")]), filename: "a.csv" },
      null,
    );
    await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]), filename: "neu.jpg" });
    await invoices.createDraft(actor, {
      contactId: null, issueDate: "2026-10-10", serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd", note: "", lines: [],
    });
    const issues = await figures.preflight(october, await figures.computeVatFigures(october));
    expect(issues.map((i) => i.text)).toEqual([
      "1 Ausgabe im Zeitraum ohne Beleg oder Zuordnung. Ohne Beleg wird keine Vorsteuer angesetzt.",
      "1 Zahlungseingang im Zeitraum noch nicht zugeordnet; bei Ist-Versteuerung fehlt sonst Umsatzsteuer.",
      "1 Beleg ist noch nicht gebucht.",
      "1 Rechnungsentwurf mit Datum im Zeitraum.",
    ]);
  });

  it("berechneter Entwurf wird vor dem Senden aktualisiert, manuelle Werte bleiben mit Begründung", async () => {
    await bookedDocument("2026-10-05", 3_240, 616);
    const draft = await vat.saveDraft(actor, october, { mode: "berechnet" });
    expect(draft).toMatchObject({ source: "berechnet", kz66: 616, kz83: -616, computed: { kz66: 616 } });

    await bookedDocument("2026-10-06", 1_000, 190);
    let xml = "";
    const spy = { validate: async (body: string) => ((xml = body), new FakeElsterClient().validate(body)), send: new FakeElsterClient().send, fetchPostfach: new FakeElsterClient().fetchPostfach, fetchBelege: new FakeElsterClient().fetchBelege };
    await vat.submitReturn(actor, draft.id, spy, { kind: "validate" });
    expect(xml).toContain("<Kz66>8,06</Kz66>");
    const [stored] = await sql`select kz66 from vat_returns where id = ${draft.id}`;
    expect(stored?.kz66).toBe(806);

    const manual = await vat.saveDraft(actor, october, { mode: "manuell", kz81: 100_000, kz86: 0, kz66: 0, reason: "Testweise von Hand" });
    expect(manual).toMatchObject({ source: "manuell", overrideReason: "Testweise von Hand", kz81: 100_000, computed: { kz66: 806 } });
    await vat.submitReturn(actor, manual.id, spy, { kind: "validate" });
    expect(xml).toContain("<Kz81>1000</Kz81>");
  }, 30_000);

  async function specialInvoice(taxTreatment: "reverse_charge" | "drittland" | "steuerfrei", land: string, ustId: string, issueDate: string) {
    const contact = await contacts.createContact(actor, {
      kundennummer: "", name: "Alpenblick GmbH", strasse: "Ring 1", plz: "1010", ort: "Wien", land,
      email: "a@b.example", ustId, iban: "", leitwegId: "", defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id, issueDate, serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd", note: "",
      taxTreatment, exemptionReason: taxTreatment === "steuerfrei" ? "Steuerfrei nach § 4 Nr. 21 UStG" : "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch." as const, unitPrice: 500_000, taxRate: 0 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  it("Reverse Charge im Rechnungsmonat (auch bei Ist), Drittland und steuerfrei nach Zahlung", async () => {
    const rc = await specialInvoice("reverse_charge", "AT", "ATU12345678", "2026-10-15");
    const ch = await specialInvoice("drittland", "CH", "", "2026-09-15");
    await specialInvoice("steuerfrei", "DE", "", "2026-10-01");
    const [line] = await sql`select l.account, l.tax_code from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${rc.id} and l.credit > 0`;
    expect(line).toMatchObject({ account: "8336", tax_code: "RC" });

    await bank.importStatement(actor, { bytes: dkbCsv([row("02.10.26", "Matterhorn", `RE ${ch.number}`, "5.000,00")]), filename: "a.csv" }, null);
    const [tx] = await sql`select id from bank_transactions`;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: ch.id, amount: 500_000 });

    const result = await figures.computeVatFigures(october);
    expect(result).toMatchObject({ kz21: 500_000, kz45: 500_000, kz48: 0, kz81: 0, steuerfrei: 0 });
    const draft = await vat.saveDraft(actor, october, { mode: "berechnet" });
    expect(draft).toMatchObject({ kz21: 500_000, kz45: 500_000, kz83: 0 });
    let xml = "";
    const spy = { validate: async (body: string) => ((xml = body), new FakeElsterClient().validate(body)), send: new FakeElsterClient().send, fetchPostfach: new FakeElsterClient().fetchPostfach, fetchBelege: new FakeElsterClient().fetchBelege };
    await vat.submitReturn(actor, draft.id, spy, { kind: "validate" });
    expect(xml).toContain("<Kz21>5000</Kz21>");
    expect(xml).toContain("<Kz45>5000</Kz45>");
  }, 30_000);

  it("Reverse Charge ohne USt-IdNr. des Kunden lässt sich nicht festschreiben", async () => {
    await expect(specialInvoice("reverse_charge", "AT", "", "2026-10-15")).rejects.toThrow("USt-IdNr. des Kunden");
  }, 30_000);

  it("Kleinunternehmer: Belege ohne Vorsteuer, Rechnungen nur ohne Umsatzsteuer", async () => {
    await sql`update company set kleinunternehmer = true`;
    const doc = await bookedDocument("2026-10-05", 3_240, 616);
    const lines = await sql`select l.account, l.debit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${doc} and l.debit > 0`;
    expect(lines.map((l) => ({ ...l }))).toEqual([{ account: "4806", debit: 3_856 }]);
    expect((await figures.computeVatFigures(october)).kz66).toBe(0);

    expect((await invoices.newDraftDefaults("2026-10-01")).taxTreatment).toBe("kleinunternehmer");
    await expect(invoice([{ net: 100_000, rate: 1900 }])).rejects.toThrow("Kleinunternehmer");
  }, 30_000);

  it("manuelle Werte dürfen negativ sein", async () => {
    const manual = await vat.saveDraft(actor, october, { mode: "manuell", kz81: -50_000, kz86: 0, kz66: 0, reason: "Gutschrift überwiegt" });
    expect(manual).toMatchObject({ kz81: -50_000, kz83: -9_500 });
  });

  it("Kontenrahmen, Versteuerung und Kleinunternehmer sind nach Buchungen im Jahr gesperrt", async () => {
    const guard = await import("./settings-guard.ts");
    const { loadCompany } = await import("./company.ts");
    expect(await guard.settingsLocks("2026-10-02")).toEqual({ kontenrahmen: null, versteuerung: null, kleinunternehmer: null });

    await invoice([{ net: 100_000, rate: 1900 }], "2025-12-20");
    const locks = await guard.settingsLocks("2026-01-05");
    // Keine Buchung im neuen Jahr, aber eine offene Rechnung: nur die Versteuerung bleibt gesperrt
    expect(locks.kontenrahmen).toBeNull();
    expect(locks.kleinunternehmer).toBeNull();
    expect(locks.versteuerung).toContain("1 Rechnung ist noch offen");

    const current = await loadCompany();
    const input = { ...current, bundesland: current.bundesland, kontenrahmen: "SKR04" as const };
    const yearLocks = await guard.settingsLocks("2025-12-30");
    expect(guard.lockedChange(current, input, yearLocks)).toContain("Im Jahr 2025 gibt es schon Buchungen");
    expect(guard.lockedChange(current, { ...current, kleinunternehmer: false }, yearLocks)).toBeNull();
  }, 30_000);
});
