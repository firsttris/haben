import { ACCOUNTS } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/**
 * Bareinnahme auf eine Ausgangsrechnung im Kassenbuch: gebucht wie die Zuordnung eines Bankumsatzes (Kasse statt Bank),
 * Teilzahlung, Überzahlung abgelehnt, Skonto wie im Bankabgleich, Storno als Gegenzeile; in SKR03 und SKR04, Ist und Soll.
 */
describe.skipIf(!testDatabaseUrl)("Bareinnahme auf eine Rechnung (Postgres)", () => {
  let cash: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let auswertungen: typeof import("../auswertungen/index.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let mahnwesen: typeof import("../rechnungen/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const today = "2026-10-06";

  beforeAll(async () => {
    sql = await setupTestDb();
    cash = await import("./index.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    vat = await import("../umsatzsteuer/index.ts");
    auswertungen = await import("../auswertungen/index.ts");
    reports = await import("../auswertungen/reports.ts");
    mahnwesen = await import("../rechnungen/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Firma, Zahlungsziel 14 Tage, ohne Skonto (skonto: Vorgabe für neue Rechnungen) */
  async function company(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", skonto: { days: number; percent: number }[] = []) {
    await sql`truncate write_offs, allocations, cash_entries, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
                                   payment_term_days, skonto)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, 14, ${JSON.stringify(skonto)}::jsonb)`;
  }

  /** Rechnung vom 25.09.2026 über 4.000,00 € netto, 4.760,00 € brutto */
  async function finalInvoice(issueDate = "2026-09-25") {
    const { id: contactId } = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Bäckerei Kranz",
      strasse: "Marktplatz 3",
      plz: "93047",
      ort: "Regensburg",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      ...(await invoices.newDraftDefaults(issueDate)),
      contactId,
      lines: [{ description: "Leistungen September", quantity: 1000, unit: "Psch.", unitPrice: 400_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function balances() {
    return Object.fromEntries(
      (await sql`select account, sum(debit - credit)::int as saldo from journal_lines group by account having sum(debit - credit) <> 0 order by 1`).map((r) => [
        r.account,
        r.saldo,
      ]),
    );
  }

  const listed = async (id: string, on = today) => (await invoices.listInvoices(on)).find((i) => i.id === id);

  async function noDeviations() {
    for (const month of [9, 10]) {
      const abgleich = await auswertungen.vatAbgleich({ year: 2026, month });
      expect(abgleich.zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);
    }
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      const a = ACCOUNTS[kontenrahmen];
      const kasse = a.kasse;
      const forderungen = a.forderungen;
      const ust = a.ust[1900];
      const nichtFaellig = a.ustNichtFaellig[1900];
      const erloese = a.erloese[1900];

      it(`${kontenrahmen}, ${versteuerung}: Teilzahlung und Rest bar, Überzahlung abgelehnt, Storno als Gegenzeile`, async () => {
        await company(kontenrahmen, versteuerung);
        const invoice = await finalInvoice();

        // Teilzahlung: Kasse an Forderungen, Rechnung teilweise bezahlt
        const first = await cash.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-09-28", amount: 100_000 }, today);
        expect(first).toMatchObject({
          number: 1,
          kind: "rechnung",
          amount: 100_000,
          invoiceId: invoice.id,
          text: `Rechnung ${invoice.number} · Bäckerei Kranz`,
        });
        expect(await listed(invoice.id)).toMatchObject({ listStatus: "teilbezahlt", paid: 100_000, open: 376_000 });
        // Offene Posten und Mahnwesen sehen nur noch den Rest; fällig ist die Rechnung am 09.10.2026
        expect((await auswertungen.openPositions(today)).receivables.map((r) => [r.id, r.open])).toEqual([[invoice.id, 376_000]]);
        expect((await mahnwesen.overdueInvoices("2026-10-20")).map((i) => [i.id, i.open])).toEqual([[invoice.id, 376_000]]);
        // Steueranteil der Teilzahlung: 1.000,00 € × 760/4.760
        expect(first.taxShares).toEqual([{ rate: 1900, base: 84_034, tax: 15_966 }]);

        // Mehr als offen, vor dem Rechnungsdatum, in der Zukunft: abgelehnt
        await expect(cash.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-10-02", amount: 376_001 }, today)).rejects.toThrow(
          new RegExp(`Rechnung ${invoice.number} ist nur noch über 3\\.760,00\\s€ offen; mehr lässt sich nicht bar kassieren\\.`),
        );
        await expect(cash.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-09-24", amount: 100 }, today)).rejects.toThrow(
          "Die Bareinnahme liegt vor dem Rechnungsdatum (25.09.2026).",
        );
        await expect(cash.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-10-07", amount: 100 }, today)).rejects.toThrow(/Zukunft/);
        await expect(cash.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-10-02", amount: 376_000, skonto: true }, today)).rejects.toThrow(
          /kein Rest/,
        );

        const rest = await cash.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-10-02", amount: 376_000, text: "Quittung 17" }, today);
        expect(await listed(invoice.id)).toMatchObject({ listStatus: "bezahlt", open: 0 });
        expect((await cash.openItems()).some((i) => i.id === invoice.id)).toBe(false);
        expect((await auswertungen.openPositions(today)).receivables).toEqual([]);
        expect(await mahnwesen.overdueInvoices("2026-10-20")).toEqual([]);
        await expect(cash.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-10-02", amount: 1 }, today)).rejects.toThrow(/nicht mehr offen/);

        // Journal: wie eine Zahlung über die Bank, nur Kasse; bei Ist ist die Umsatzsteuer ganz fällig
        expect(await balances()).toEqual({ [kasse]: 476_000, [ust]: -76_000, [erloese]: -400_000 });
        const september = await vat.computeVatFigures({ year: 2026, month: 9 });
        const october = await vat.computeVatFigures({ year: 2026, month: 10 });
        if (versteuerung === "ist") {
          // Ist: Umsatzsteuer mit der Bareinnahme, anteilig im Monat der jeweiligen Bareinnahme
          expect(september).toMatchObject({ kz81: 84_034, tax81: 15_966 });
          expect(october).toMatchObject({ kz81: 315_966, tax81: 60_034 });
        } else {
          expect(september).toMatchObject({ kz81: 400_000, tax81: 76_000 });
          expect(october).toMatchObject({ kz81: 0, tax81: 0 });
        }
        await noDeviations();
        // EÜR: Zufluss am Tag der Bareinnahme
        const euer = (await reports.euerPayments(2026)).filter((p) => p.kind === "invoice");
        expect(euer.map((p) => [p.date, p.kind === "invoice" ? p.paid : 0]).sort()).toEqual([
          ["2026-09-28", 100_000],
          ["2026-10-02", 376_000],
        ]);
        expect((await cash.invoicePaymentList(invoice.id)).map((p) => [p.via, p.date, p.amount, p.cashNumber, p.reversed])).toEqual([
          ["bar", "2026-09-28", 100_000, 1, false],
          ["bar", "2026-10-02", 376_000, 2, false],
        ]);

        // Storno der Restzahlung: Gegenzeile mit neuer Nummer und heutigem Datum, Rechnung wieder offen
        const storno = await cash.reverseCashEntry(actor, rest.id, today);
        expect(storno).toMatchObject({ number: 3, date: today, amount: -376_000, kind: "rechnung", invoiceId: invoice.id, reversesId: rest.id });
        expect(storno.text).toBe("Storno Nr. 2: Quittung 17");
        await expect(cash.reverseCashEntry(actor, rest.id, today)).rejects.toThrow(/bereits storniert/);
        expect(await listed(invoice.id)).toMatchObject({ listStatus: "teilbezahlt", open: 376_000 });
        const book = await cash.cashBook(2026);
        expect(book.entries.map((e) => [e.number, e.amount, e.balance, e.reversed, e.invoiceNumber])).toEqual([
          [1, 100_000, 100_000, false, invoice.number],
          [2, 376_000, 476_000, true, invoice.number],
          [3, -376_000, 100_000, false, invoice.number],
        ]);
        const opened = versteuerung === "ist" ? { [nichtFaellig]: -60_034, [ust]: -15_966 } : { [ust]: -76_000 };
        expect(await balances()).toEqual({ [kasse]: 100_000, [forderungen]: 376_000, [erloese]: -400_000, ...opened });
        // Ist: Die Umsatzsteuer der stornierten Bareinnahme geht im Monat des Stornos zurück
        expect(await vat.computeVatFigures({ year: 2026, month: 10 })).toMatchObject(versteuerung === "ist" ? { tax81: 0 } : { tax81: 0, kz81: 0 });
        await noDeviations();
        expect((await cash.invoicePaymentList(invoice.id)).map((p) => [p.cashNumber, p.reversed])).toEqual([
          [1, false],
          [2, true],
        ]);

        // Kassenbestand nie negativ: nach einer Entnahme ließe der Storno der ersten Bareinnahme die Kasse ins Minus fallen
        await cash.createCashEntry(actor, { kind: "entnahme", date: today, amount: 50_000 }, today);
        await expect(cash.reverseCashEntry(actor, first.id, today)).rejects.toThrow(/Kassenbestand würde am 06\.10\.2026 negativ/);

        // Die Zeile ist gesiegelt, samt Rechnung und Steueranteil, und lässt sich nicht ändern
        const [seal] = await sql`select columns from seals where table_name = 'cash_entries' and row_id = ${first.id}`;
        expect(seal?.columns.cash_entries).toEqual(expect.arrayContaining(["invoice_id", "tax_shares", "tax_shares_invoice_id"]));
        await expect(sql`update cash_entries set invoice_id = null where id = ${first.id}`).rejects.toThrow();

        const csv = await cash.cashBookCsv(2026);
        expect(csv).toContain(`1;"2026-09-28";"Bareinnahme Rechnung";"Rechnung ${invoice.number} · Bäckerei Kranz";1000,00;;1000,00;"";"";"${invoice.number}"`);
      }, 60_000);

      it(`${kontenrahmen}, ${versteuerung}: bar mit Skonto in der Frist, Rest als gewährtes Skonto, Storno hebt beides auf`, async () => {
        // 2 % in 10 Tagen: 95,20 € von 4.760,00 €
        await company(kontenrahmen, versteuerung, [{ days: 10, percent: 200 }]);
        const invoice = await finalInvoice();
        const [candidate] = await cash.cashInvoiceCandidates();
        expect(candidate).toMatchObject({ id: invoice.id, open: 476_000, customer: "Bäckerei Kranz" });
        expect(candidate?.skonto).toEqual([expect.objectContaining({ amount: 9_520, payable: 466_480, paidBy: "2026-10-05" })]);

        const entry = await cash.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-10-02", amount: 466_480, skonto: true }, today);
        expect(await listed(invoice.id)).toMatchObject({ listStatus: "bezahlt", open: 0 });
        const writeOffs = await cash.listWriteOffs({ invoiceId: invoice.id });
        expect(writeOffs.map((w) => [w.kind, w.amount, w.date, w.cashEntryId])).toEqual([["skonto", 9_520, "2026-10-02", entry.id]]);
        // Erlös 4.000,00 €, Skonto netto 80,00 €, Umsatzsteuer 760,00 − 15,20 = 744,80 € (§ 17 Abs. 1 UStG)
        expect(await balances()).toEqual({ [kasse]: 466_480, [ust]: -74_480, [erloese]: -400_000, [a.skontiGewaehrt]: 8_000 });
        const october = await vat.computeVatFigures({ year: 2026, month: 10 });
        expect(october).toMatchObject(versteuerung === "soll" ? { kz81: -8_000, tax81: -1_520 } : { kz81: 392_000, tax81: 74_480 });
        await noDeviations();
        // Die Ausbuchung hängt an der Bareinnahme und geht nur mit ihr
        await expect(cash.reverseWriteOff(actor, writeOffs[0]!.id, today)).rejects.toThrow(/Bareinnahme/);

        await cash.reverseCashEntry(actor, entry.id, today);
        expect(await listed(invoice.id)).toMatchObject({ open: 476_000 });
        expect((await cash.listWriteOffs({ invoiceId: invoice.id })).map((w) => [w.reversed])).toEqual([[true]]);
        const reopened = versteuerung === "ist" ? { [nichtFaellig]: -76_000 } : { [ust]: -76_000 };
        expect(await balances()).toEqual({ [forderungen]: 476_000, [erloese]: -400_000, ...reopened });
        await noDeviations();
      }, 60_000);
    }
  }

  it("Stornorechnung, stornierte Rechnung und Entwurf lassen sich nicht bar kassieren; die Datenbank prüft die Rechnung", async () => {
    await company("SKR03", "ist");
    const invoice = await finalInvoice();
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-09-26");
    await expect(cash.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-10-02", amount: 100 }, today)).rejects.toThrow(
      `Rechnung ${invoice.number} ist storniert.`,
    );
    await expect(cash.createCashInvoiceEntry(actor, { invoiceId: storno.id, date: "2026-10-02", amount: 100 }, today)).rejects.toThrow(/Stornorechnung/);
    expect(await cash.cashInvoiceCandidates()).toEqual([]);

    const draft = await invoices.createDraft(actor, {
      ...(await invoices.newDraftDefaults("2026-09-25")),
      lines: [{ description: "Entwurf", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
    });
    await expect(cash.createCashInvoiceEntry(actor, { invoiceId: draft.id, date: "2026-10-02", amount: 100 }, today)).rejects.toThrow(/nicht gefunden/);
    await expect(
      sql`insert into cash_entries (number, date, amount, kind, text, invoice_id) values (99, '2026-10-02', 100, 'rechnung', 'x', ${draft.id})`,
    ).rejects.toThrow(/nicht festgeschrieben/);
    // Art und Rechnung gehören zusammen
    await expect(sql`insert into cash_entries (number, date, amount, kind, text) values (99, '2026-10-02', 100, 'rechnung', 'x')`).rejects.toThrow(
      /cash_entries_invoice_kind/,
    );
  }, 60_000);
});
