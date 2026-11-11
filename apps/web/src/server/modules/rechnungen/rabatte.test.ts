import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Rabatte auf der Rechnung: Positionsrabatt (Prozent oder Betrag) und Gesamtrabatt je Steuersatz. Gebucht wird das Netto
 * nach Rabatt auf das Erlöskonto, die Steuer auf die rabattierte Bemessungsgrundlage; für SKR03 und SKR04, Soll und Ist.
 */
describe.skipIf(!testDatabaseUrl)("Rabatte (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  const line = (unitPrice: number, taxRate: 1900 | 700 = 1900, quantity = 1000, discount: { kind: "prozent" | "betrag"; value: number } | null = null) => ({
    description: "Beratung",
    quantity,
    unit: "Std." as const,
    unitPrice,
    taxRate,
    discount,
  });

  /** 10 Std. à 95 € mit 10 % Positionsrabatt, Wartung 499 € abzüglich 49 €, Fachbuch 3 × 49,90 € zu 7 %; Gesamtrabatt 5 % */
  const draft = (overrides: Record<string, unknown> = {}) => ({
    contactId,
    issueDate: "2026-10-02",
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "xrechnung-ubl" as const,
    note: "",
    lines: [line(9500, 1900, 10_000, { kind: "prozent", value: 1000 }), line(49_900, 1900, 1000, { kind: "betrag", value: 4900 }), line(4990, 700, 3000)],
    discount: { kind: "prozent" as const, value: 500 },
    ...overrides,
  });

  const storedTaxes = async (invoiceId: string) =>
    (await sql`select rate, base, tax from invoice_taxes where invoice_id = ${invoiceId} order by rate desc`).map((r) => ({ ...r }));

  const posting = async (invoiceId: string) =>
    (
      await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
        where e.source_id = ${invoiceId} order by l.debit desc, l.account`
    ).map((l) => [l.account, l.debit, l.credit]);

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  const setup = async (kontenrahmen: "SKR03" | "SKR04", versteuerung: "soll" | "ist") => {
    await leeren(sql)`truncate journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', ${versteuerung}, ${kontenrahmen})`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Beispiel GmbH",
      strasse: "Hafenweg 3",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@beispiel.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  };

  // Erlöse, Umsatzsteuer (Soll) bzw. Umsatzsteuer nicht fällig (Ist) je Satz, Forderungen
  const ACCOUNTS = {
    SKR03: { forderung: "1400", erloes19: "8400", erloes7: "8300", soll: { 1900: "1776", 700: "1771" }, ist: { 1900: "1766", 700: "1761" } },
    SKR04: { forderung: "1200", erloes19: "4400", erloes7: "4300", soll: { 1900: "3806", 700: "3801" }, ist: { 1900: "3816", 700: "3811" } },
  } as const;

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["soll", "ist"] as const) {
      describe(`${kontenrahmen}, ${versteuerung === "soll" ? "Soll" : "Ist"}`, () => {
        beforeEach(() => setup(kontenrahmen, versteuerung));

        it("bucht Netto und Steuer nach Positions- und Gesamtrabatt je Satz", async () => {
          const created = await invoices.createDraft(actor, draft());
          // 19 %: 855,00 + 450,00 = 1.305,00 − 5 % (65,25) = 1.239,75; 7 %: 149,70 − 7,49 = 142,21
          expect(await storedTaxes(created.id)).toEqual([
            { rate: 1900, base: 123_975, tax: 23_555 },
            { rate: 700, base: 14_221, tax: 995 },
          ]);
          expect(created).toMatchObject({ net: 138_196, tax: 24_550, gross: 162_746, discountPercent: 500, discountAmount: null });
          const lines = await sql`select net, discount_percent, discount_amount from invoice_lines where invoice_id = ${created.id} order by position`;
          expect(lines.map((l) => [l.net, l.discount_percent, l.discount_amount])).toEqual([
            [85_500, 1000, null],
            [45_000, null, 4900],
            [14_970, null, null],
          ]);

          const final = await invoices.finalizeInvoice(actor, created.id);
          const a = ACCOUNTS[kontenrahmen];
          const tax = a[versteuerung];
          expect(await posting(final.id)).toEqual(
            [
              [a.forderung, 162_746, 0],
              [tax[1900], 0, 23_555],
              [tax[700], 0, 995],
              [a.erloes19, 0, 123_975],
              [a.erloes7, 0, 14_221],
            ].sort((x, y) => (y[1] as number) - (x[1] as number) || String(x[0]).localeCompare(String(y[0]))),
          );
          expect(final.xml).toContain('<cbc:AllowanceTotalAmount currencyID="EUR">72.74</cbc:AllowanceTotalAmount>');
          expect(final.xml).toContain('<cbc:PayableAmount currencyID="EUR">1627.46</cbc:PayableAmount>');
          // Gesperrt und gesiegelt, auch die Rabatte
          await expect(sql`update invoices set discount_percent = 1000 where id = ${final.id}`).rejects.toThrow(/festgeschrieben/);
          await expect(sql`update invoice_lines set discount_amount = 1 where invoice_id = ${final.id}`).rejects.toThrow(/festgeschrieben/);
          const [seal] = await sql`select columns from seals where table_name = 'invoices' and row_id = ${final.id}`;
          expect(seal!.columns.invoices).toContain("discount_percent");
          expect(seal!.columns.invoice_lines).toContain("discount_amount");
          const [check] = await sql`select s.digest = haben_seal_digest('invoices', s.row_id, s.columns) as ok from seals s
            where s.table_name = 'invoices' and s.row_id = ${final.id}`;
          expect(check!.ok).toBe(true);
        }, 30_000);

        it("Storno hebt die rabattierte Rechnung auf den Cent auf, auch mit festem Gesamtrabatt", async () => {
          const original = await invoices.finalizeInvoice(
            actor,
            (await invoices.createDraft(actor, draft({ discount: { kind: "betrag", value: 10_001 }, priceMode: "brutto" }))).id,
          );
          const storno = await invoices.cancelInvoice(actor, original.id, "2026-10-05");
          expect(storno).toMatchObject({ net: -original.net, tax: -original.tax, gross: -original.gross, discountAmount: -10_001 });
          expect(await storedTaxes(storno.id)).toEqual((await storedTaxes(original.id)).map((t) => ({ ...t, base: -t.base, tax: -t.tax })));
          const balance = await sql`select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l join journal_entries e on e.id = l.entry_id
            where e.source_id in (${original.id}, ${storno.id}) group by l.account having sum(l.debit - l.credit) <> 0`;
          expect(balance).toEqual([]);
        }, 30_000);
      });
    }
  }

  describe("Prüfungen", () => {
    beforeEach(() => setup("SKR03", "soll"));

    it("Rabatt höher als die Position oder die Summe wird nicht gespeichert", () => {
      expect(invoices.draftSchema.safeParse(draft({ lines: [line(1000, 1900, 1000, { kind: "betrag", value: 1001 })] })).success).toBe(false);
      const tooHigh = invoices.draftSchema.safeParse(draft({ lines: [line(1000)], discount: { kind: "betrag", value: 1001 } }));
      expect(tooHigh.error?.issues.map((i) => i.message)).toEqual(["Der Gesamtrabatt ist höher als die Summe der Positionen"]);
      expect(invoices.draftSchema.safeParse(draft({ discount: { kind: "prozent", value: 10_001 } })).success).toBe(false);
    });

    it("Korrektur übernimmt die Rabatte mit umgekehrtem Vorzeichen", async () => {
      const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft({ discount: { kind: "betrag", value: 5000 } }))).id);
      const correction = await invoices.createCorrection(actor, original.id, "2026-10-06");
      expect(correction).toMatchObject({ discountAmount: -5000, net: -original.net });
      const lines = await sql`select discount_percent, discount_amount from invoice_lines where invoice_id = ${correction.id} order by position`;
      expect(lines.map((l) => [l.discount_percent, l.discount_amount])).toEqual([
        [1000, null],
        [null, -4900],
        [null, null],
      ]);
    }, 30_000);

    it("Rechnungen ohne Rabatt bleiben wie bisher", async () => {
      const created = await invoices.createDraft(actor, draft({ lines: [line(9500, 1900, 10_000)], discount: null }));
      const final = await invoices.finalizeInvoice(actor, created.id);
      expect(final).toMatchObject({ net: 95_000, tax: 18_050, discountPercent: null, discountAmount: null });
      expect(final.xml).not.toContain("AllowanceCharge");
    }, 30_000);
  });
});
