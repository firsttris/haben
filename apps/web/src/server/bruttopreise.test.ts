import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n") + "\n");
}

describe.skipIf(!testDatabaseUrl)("Bruttopreise und gespeicherte Steuerzeilen (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("./contacts.ts");
  let quotes: typeof import("./quotes.ts");
  let recurring: typeof import("./recurring.ts");
  let articles: typeof import("./articles.ts");
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("./bank.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  const line = (unitPrice: number, taxRate: 1900 | 700 | 0 = 1900, quantity = 1000) => ({
    description: "Abzug 13 × 18 cm",
    quantity,
    unit: "Stk." as const,
    unitPrice,
    taxRate,
  });

  const draft = (lines = [line(980)], priceMode: "netto" | "brutto" = "brutto") => ({
    contactId,
    issueDate: "2026-10-02",
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "xrechnung-ubl" as const,
    note: "",
    priceMode,
    lines,
  });

  const final = async (input: Parameters<typeof invoices.createDraft>[1]) => invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input)).id);

  const storedTaxes = async (invoiceId: string) =>
    (await sql`select rate, base, tax from invoice_taxes where invoice_id = ${invoiceId} order by rate desc`).map((r) => ({ ...r }));

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    contacts = await import("./contacts.ts");
    quotes = await import("./quotes.ts");
    recurring = await import("./recurring.ts");
    articles = await import("./articles.ts");
    figures = await import("./vat-figures.ts");
    bank = await import("./bank.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate allocations, bank_transactions, bank_imports, bank_accounts, quote_lines, quotes, quote_number_counters,
      recurring_invoices, articles, journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', 'soll', 'SKR03')`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "", name: "Familie Berger", strasse: "Gartenweg 2", plz: "93049", ort: "Regensburg", land: "DE",
      email: "berger@example.com", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
    });
    contactId = contact.id;
  });

  it("Endpreis 9,80 € bleibt 9,80 €: Steuer herausgerechnet, je Satz gespeichert", async () => {
    const created = await invoices.createDraft(actor, draft());
    expect(created).toMatchObject({ priceMode: "brutto", net: 824, tax: 156, gross: 980 });
    expect(await storedTaxes(created.id)).toEqual([{ rate: 1900, base: 824, tax: 156 }]);
    const [stored] = await sql`select unit_price, net from invoice_lines where invoice_id = ${created.id}`;
    expect({ ...stored }).toEqual({ unit_price: 980, net: 824 });

    // Gemischte Sätze: Netto der Zeilen ergibt je Satz genau die Bemessungsgrundlage
    const mixed = await invoices.updateDraft(actor, created.id, draft([line(24_900), line(980, 1900, 7000), line(3_990, 700, 3000)]));
    expect(mixed).toMatchObject({ net: 37_876, tax: 5_854, gross: 43_730 });
    expect(await storedTaxes(created.id)).toEqual([
      { rate: 1900, base: 26_689, tax: 5_071 },
      { rate: 700, base: 11_187, tax: 783 },
    ]);
    const sums = await sql`select tax_rate, sum(net)::int as net from invoice_lines where invoice_id = ${created.id} group by tax_rate order by tax_rate desc`;
    expect(sums.map((r) => [r.tax_rate, r.net])).toEqual([
      [1900, 26_689],
      [700, 11_187],
    ]);
  });

  it("Festschreiben: XML mit Netto-Einzelpreis, Buchung und Voranmeldung aus den gespeicherten Werten", async () => {
    const invoice = await final(draft([line(980, 1900, 7000)]));
    expect(invoice).toMatchObject({ status: "final", net: 5_765, tax: 1_095, gross: 6_860 });
    expect(invoice.xml).toContain('<cbc:PayableAmount currencyID="EUR">68.60</cbc:PayableAmount>');
    expect(invoice.xml).toContain('<cbc:PriceAmount currencyID="EUR">8.236</cbc:PriceAmount>');

    const posted = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${invoice.id} order by l.debit desc, l.account`;
    expect(posted.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["1400", 6_860, 0],
      ["1776", 0, 1_095],
      ["8400", 0, 5_765],
    ]);

    // 9,80 €: aus 8,24 € netto nachgerechnet wären es 1,57 € Steuer; gemeldet wird die Steuer der Rechnung, 1,56 €
    await final(draft());
    const oct = await figures.computeVatFigures({ year: 2026, month: 10 });
    expect(oct).toMatchObject({ kz81: 5_765 + 824, tax81: 1_095 + 156 });

    // Steuerzeilen festgeschriebener Rechnungen sind gesperrt
    await expect(sql`update invoice_taxes set tax = 1096 where invoice_id = ${invoice.id}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`delete from invoice_taxes where invoice_id = ${invoice.id}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`insert into invoice_taxes (invoice_id, rate, base, tax) values (${invoice.id}, 700, 1, 0)`).rejects.toThrow(/festgeschrieben/);
  }, 30_000);

  it("Zahlung bei Ist-Versteuerung teilt nach den gespeicherten Steuerzeilen auf", async () => {
    await sql`update company set versteuerung = 'ist'`;
    const invoice = await final(draft());
    const row = ["01.10.26", "01.10.26", "Gebucht", "Familie Berger", "Testfirma", `RE ${invoice.number}`, "Eingang", "DE02100100100006820101", "9,80", "", "", ""];
    await bank.importStatement(actor, { bytes: dkbCsv([row]), filename: "a.csv" }, null);
    const [transaction] = await sql`select id from bank_transactions`;
    await bank.allocate(actor, { kind: "invoice", transactionId: transaction!.id, invoiceId: invoice.id, amount: 980 });
    const oct = await figures.computeVatFigures({ year: 2026, month: 10 });
    expect(oct).toMatchObject({ kz81: 824, tax81: 156 });
  }, 30_000);

  it("Storno und Korrektur übernehmen den Preismodus und heben exakt auf", async () => {
    const original = await final(draft([line(24_900), line(980, 1900, 7000), line(3_990, 700, 3000)]));
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-10-05");
    expect(storno).toMatchObject({ priceMode: "brutto", net: -original.net, tax: -original.tax, gross: -original.gross });
    expect(await storedTaxes(storno.id)).toEqual((await storedTaxes(original.id)).map((t) => ({ ...t, base: -t.base, tax: -t.tax })));

    const second = await final(draft());
    const correction = await invoices.createCorrection(actor, second.id, "2026-10-05");
    expect(correction.priceMode).toBe("brutto");
    // Auch wenn der Editor netto schickt: die Korrektur rechnet wie die Rechnung
    const changed = await invoices.updateDraft(actor, correction.id, { ...draft([line(-490)], "netto") });
    expect(changed).toMatchObject({ priceMode: "brutto", gross: -490 });
  }, 30_000);

  it("ohne Steuerausweis gibt es keine Bruttopreise", async () => {
    const created = await invoices.createDraft(actor, { ...draft([line(10_000, 0)]), taxTreatment: "steuerfrei", exemptionReason: "§ 4 Nr. 21 UStG" });
    expect(created).toMatchObject({ priceMode: "netto", net: 10_000, tax: 0, gross: 10_000 });
  });

  it("Schlussrechnung mit Bruttopreisen zieht die Abschläge brutto ab", async () => {
    const abschlag = await final({ ...draft([line(119_000)]), variant: "abschlag" });
    expect(abschlag).toMatchObject({ net: 100_000, tax: 19_000, gross: 119_000 });
    const schluss = await invoices.createDraft(actor, { ...draft([line(595_000)]), variant: "schluss", deducts: [abschlag.id] });
    expect(schluss).toMatchObject({ net: 400_000, tax: 76_000, gross: 476_000 });
    const lines = (await invoices.getInvoice(schluss.id))!.lines;
    expect(lines.map((l) => [l.unitPrice, l.net, l.deductionOf])).toEqual([
      [595_000, 500_000, null],
      [-119_000, -100_000, abschlag.id],
    ]);
    expect(lines[1]!.description).toMatch(/netto 1\.000,00\s€, USt 190,00\s€/);
    const finalSchluss = await invoices.finalizeInvoice(actor, schluss.id);
    expect(finalSchluss.xml).toContain('<cbc:PayableAmount currencyID="EUR">4760.00</cbc:PayableAmount>');
  }, 30_000);

  it("Angebot mit Bruttopreisen wird zur Rechnung mit Bruttopreisen", async () => {
    const quote = await quotes.createQuoteDraft(actor, {
      contactId, issueDate: "2026-10-01", validUntil: "2026-10-31", serviceFrom: null, serviceTo: null, note: "",
      priceMode: "brutto", lines: [line(980, 1900, 2000)],
    });
    expect(quote).toMatchObject({ priceMode: "brutto", net: 1_647, tax: 313, gross: 1_960 });
    await quotes.finalizeQuote(actor, quote.id);
    const invoice = await quotes.quoteToInvoice(actor, quote.id, "2026-10-05");
    expect(invoice).toMatchObject({ priceMode: "brutto", gross: 1_960 });
    expect(await storedTaxes(invoice.id)).toEqual([{ rate: 1900, base: 1_647, tax: 313 }]);
  }, 30_000);

  it("wiederkehrende Rechnung behält ihren Preismodus", async () => {
    await recurring.createRecurring(actor, {
      name: "Fotoabo", active: true, contactId, format: "zugferd", paymentTermDays: 14, note: "", taxTreatment: "regulaer",
      exemptionReason: "", priceMode: "brutto", lines: [{ description: "Abo {monat}", quantity: 1000, unit: "Monat", unitPrice: 2_990, taxRate: 1900 }],
      intervalMonths: 1, nextDate: "2026-10-01", endDate: null, servicePeriod: "laufend", mode: "entwurf",
    });
    await recurring.runDueRecurring("2026-10-02");
    const [created] = await sql`select price_mode, gross, net, tax from invoices`;
    expect({ ...created }).toEqual({ price_mode: "brutto", gross: 2_990, net: 2_513, tax: 477 });
  });

  it("Artikel merken sich, ob der Preis die Umsatzsteuer enthält", async () => {
    const article = await articles.createArticle(actor, { description: "Abzug 13 × 18 cm", unit: "Stk.", unitPrice: 980, taxRate: 1900, priceIncludesTax: true });
    expect(article.priceIncludesTax).toBe(true);
    const plain = await articles.createArticle(actor, { description: "Beratung", unit: "Std.", unitPrice: 9_500, taxRate: 1900 });
    expect(plain.priceIncludesTax).toBe(false);
  });
});
