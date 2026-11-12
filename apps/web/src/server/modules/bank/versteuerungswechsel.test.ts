import { parseDatevBuchungsstapel, datevAccountTotals } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** #623: Eine bereits versteuerte Rechnung behält ihre Versteuerung nach dem Jahreswechsel (§ 20 UStG, UStAE 13.6 Abs. 3). */
describe.skipIf(!testDatabaseUrl)("Rücklastschrift und Wiederzahlung nach Versteuerungswechsel (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let auswertungen: typeof import("../auswertungen/index.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let year: number;
  let previousYear: number;
  const actor = "versteuerungswechsel-test";
  const iban = "DE89370400440532013000";
  type Profile = { kontenrahmen: "SKR03" | "SKR04"; versteuerung: "ist" | "soll"; gmbh: boolean };

  beforeAll(async () => {
    sql = await setupTestDb();
    // Wie die Jahressperre in drizzle/0065: kein vorgezogener Wechsel über eine Test-Uhr.
    year = Number((await sql`select extract(year from (now() at time zone 'Europe/Berlin')) as year`)[0]!.year);
    previousYear = year - 1;
    bank = await import("./index.ts");
    invoices = await import("../rechnungen/index.ts");
    stammdaten = await import("../stammdaten/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    auswertungen = await import("../auswertungen/index.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
  });
  afterAll(async () => {
    await sql?.end();
  });

  async function transaction(date: string, purpose: string, amount: string) {
    const csv =
      `"Girokonto";"${iban}"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${date}";"${date}";"Gebucht";"Nordwerk Software GmbH";"Testfirma";"${purpose}";"Lastschrift";"DE02120300000000202051";"${amount}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `${crypto.randomUUID()}.csv` }, null);
    return (await sql`select id from bank_transactions where purpose = ${purpose}`)[0]!.id as string;
  }

  async function setup(profile: Profile, foreign = false) {
    await leeren(sql)`truncate annual_submissions, vat_return_filings, vat_return_submissions, vat_returns, vat_frequencies,
      cash_entries, sepa_direct_debit_items, sepa_direct_debits, write_offs, allocations, bank_transactions,
      bank_imports, bank_accounts, journal_lines, journal_entries, invoice_lines, invoice_taxes, invoices, invoice_number_counters,
      sepa_mandate_files, sepa_mandate_revocations, sepa_mandates, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic,
      bank, glaeubiger_id, kontenrahmen, versteuerung, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '0941 1', '198/113/10010',
      'DE123456789', 'BY', ${iban}, 'COBADEFFXXX', 'Commerzbank', 'DE98ZZZ09999999999', ${profile.kontenrahmen}, ${profile.versteuerung}, ${previousYear})`;
    if (profile.gmbh) await sql`update company set rechtsform = 'gmbh', name = 'Test GmbH'`;
    const account = await bank.createAccount(actor, { name: "Geschäftskonto", iban });
    const contact = await stammdaten.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "rechnung@nordwerk.example",
      ustId: "",
      iban: "DE02120300000000202051",
      leitwegId: "",
      defaultFormat: null,
    });
    const mandate = await stammdaten.createMandate(
      actor,
      contact.id,
      {
        reference: "KD-1042-01",
        signedOn: `${previousYear}-10-01`,
        scheme: "CORE",
        firstSequence: "FRST",
        debtorName: contact.name,
        debtorIban: contact.iban,
      },
      `${previousYear}-11-09`,
    );
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate: `${previousYear}-12-01`,
      serviceFrom: `${previousYear}-12-01`,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      paymentMethod: foreign ? "ueberweisung" : "lastschrift",
      sepaMandateId: foreign ? null : mandate,
      ...(foreign ? { currency: "USD", exchangeRate: "1" } : {}),
      lines: [{ description: "Leistung Dezember", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    const invoice = await invoices.finalizeInvoice(actor, draft.id);
    if (!foreign) await bank.createDirectDebitFile(actor, { bankAccountId: account.id, invoiceIds: [invoice.id] }, new Date(`${previousYear}-12-02T08:00:00Z`));
    await bank.allocate(actor, {
      kind: "invoice",
      transactionId: await transaction(`16.12.${String(previousYear).slice(-2)}`, `Lastschrift Rechnung ${invoice.number}`, "1.190,00"),
      invoiceId: invoice.id,
      amount: 119_000,
    });
    expect((await bank.invoicePayments([invoice.id])).get(invoice.id)).toBe(119_000);
    const originalInvoice = await sql`select * from invoices where id = ${invoice.id}`;
    const originalEntries = await sql`select * from journal_entries where date < ${`${year}-01-01`} order by id`;
    const originalLines =
      await sql`select l.* from journal_lines l join journal_entries e on e.id = l.entry_id where e.date < ${`${year}-01-01`} order by l.id`;
    const oldReturn = await vat.saveDraft(actor, { year: previousYear, month: 12 }, { mode: "berechnet" });
    await sql`update vat_returns set status = 'sent', sent_at = now(), locked_at = now() where id = ${oldReturn.id}`;
    const originalReturn = await sql`select * from vat_returns where id = ${oldReturn.id}`;
    await stammdaten.saveCompany(
      actor,
      {
        ...(await stammdaten.loadCompany()),
        versteuerung: profile.versteuerung === "ist" ? "soll" : "ist",
      },
      `${year}-01-01`,
    );
    expect(await stammdaten.versteuerungForYear(previousYear)).toBe(profile.versteuerung);
    return { invoice, originalInvoice, originalEntries, originalLines, oldReturn, originalReturn };
  }

  async function taxInMonth(month: number, profile: Profile) {
    const account = profile.kontenrahmen === "SKR03" ? "1776" : "3806";
    return Number(
      (
        await sql`select coalesce(sum(l.credit - l.debit), 0) as tax from journal_lines l
      join journal_entries e on e.id = l.entry_id where l.account = ${account}
      and e.date >= ${`${year}-${String(month).padStart(2, "0")}-01`} and e.date < ${`${year}-${String(month + 1).padStart(2, "0")}-01`}`
      )[0]!.tax,
    );
  }

  async function returnedInvoice(profile: Profile, foreign = false) {
    const result = await setup(profile, foreign);
    if (foreign) {
      // Lastschrift und deutsche Umsatzsteuer bei Ist sind in Fremdwährung gesperrt.
      // Die bestehende Soll-Rechnung wird über den regulären Weg wieder geöffnet.
      const [payment] = await sql`select id from allocations where invoice_id = ${result.invoice.id} and amount > 0`;
      await bank.reverseAllocation(actor, payment!.id);
      return result.invoice;
    }
    const returned = await transaction(`12.01.${String(year).slice(-2)}`, `RUECKLASTSCHRIFT AM04 KD-1042-01 Rechnung ${result.invoice.number}`, "-1.190,00");
    await bank.allocateDirectDebitReturn(actor, returned);
    return result.invoice;
  }

  async function expectDatevMatchesJournal() {
    await auswertungen.saveDatevNumbers(actor, { beraterNr: "12345", mandantNr: "123" });
    const { bytes } = await auswertungen.datevExport(year);
    const exported = datevAccountTotals(parseDatevBuchungsstapel(bytes).bookings);
    const journal = await sql`select l.account, sum(l.debit)::int as debit, sum(l.credit)::int as credit
      from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.date >= ${`${year}-01-01`} group by l.account order by l.account`;
    for (const row of journal) {
      const exportedRow = exported.find((r) => r.account === row.account);
      expect.soft((exportedRow?.credit ?? 0) - (exportedRow?.debit ?? 0), `DATEV ${row.account}`).toBe(row.credit - row.debit);
    }
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const)
    for (const versteuerung of ["ist", "soll"] as const)
      for (const gmbh of [false, true])
        for (const method of ["Bank", "Kasse"] as const)
          it(`${versteuerung} → ${versteuerung === "ist" ? "soll" : "ist"}: Rücklastschrift und Wiederzahlung über ${method} (${kontenrahmen}, ${gmbh ? "GmbH" : "Einzelunternehmen"})`, async () => {
            const profile = { kontenrahmen, versteuerung, gmbh };
            const original = await setup(profile);
            const { invoice } = original;
            const returned = await transaction(`12.01.${String(year).slice(-2)}`, `RUECKLASTSCHRIFT AM04 KD-1042-01 Rechnung ${invoice.number}`, "-1.190,00");
            await bank.allocateDirectDebitReturn(actor, returned);
            expect((await bank.invoicePayments([invoice.id])).get(invoice.id)).toBe(0);
            const january = { year, month: 1 };
            expect.soft(await taxInMonth(1, profile)).toBe(versteuerung === "ist" ? -19_000 : 0);
            expect
              .soft(await vat.computeVatFigures(january))
              .toMatchObject({ kz81: versteuerung === "ist" ? -100_000 : 0, tax81: versteuerung === "ist" ? -19_000 : 0 });
            expect.soft(abgleich.abweichungen((await auswertungen.vatAbgleich(january)).zeilen)).toEqual([]);
            if (!gmbh) {
              expect.soft((await auswertungen.euerForYear(year)).gewinn).toBe(-119_000);
              expect.soft(abgleich.abweichungen((await auswertungen.euerAbgleich(year)).zeilen)).toEqual([]);
            }
            if (method === "Bank") {
              const repayment = await transaction(`08.02.${String(year).slice(-2)}`, `Wiederzahlung Rechnung ${invoice.number}`, "1.190,00");
              await bank.allocate(actor, { kind: "invoice", transactionId: repayment, invoiceId: invoice.id, amount: 119_000 });
            } else {
              await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: `${year}-02-08`, amount: 119_000 }, `${year}-02-08`);
            }
            expect((await bank.invoicePayments([invoice.id])).get(invoice.id)).toBe(119_000);
            expect.soft(await taxInMonth(2, profile)).toBe(versteuerung === "ist" ? 19_000 : 0);
            expect
              .soft(await vat.computeVatFigures({ year, month: 2 }))
              .toMatchObject({ kz81: versteuerung === "ist" ? 100_000 : 0, tax81: versteuerung === "ist" ? 19_000 : 0 });
            expect.soft(abgleich.abweichungen((await auswertungen.vatAbgleich({ year, month: 2 })).zeilen)).toEqual([]);
            await expectDatevMatchesJournal();
            if (!gmbh) {
              expect.soft((await auswertungen.euerForYear(year)).gewinn).toBe(0);
              expect.soft(abgleich.abweichungen((await auswertungen.euerAbgleich(year)).zeilen)).toEqual([]);
            }
            expect(await sql`select * from invoices where id = ${invoice.id}`).toEqual(original.originalInvoice);
            expect(await sql`select * from journal_entries where date < ${`${year}-01-01`} order by id`).toEqual(original.originalEntries);
            expect(
              await sql`select l.* from journal_lines l join journal_entries e on e.id = l.entry_id where e.date < ${`${year}-01-01`} order by l.id`,
            ).toEqual(original.originalLines);
            expect(await sql`select * from vat_returns where id = ${original.oldReturn.id}`).toEqual(original.originalReturn);
            expect(await vat.computeVatFigures({ year: previousYear, month: 12 })).toMatchObject({ kz81: 100_000, tax81: 19_000 });
            if (method === "Bank") {
              const [allocation] = await sql`select a.id from allocations a join bank_transactions b on b.id = a.transaction_id
                where a.invoice_id = ${invoice.id} and b.booking_date = ${`${year}-02-08`} and a.reverses_id is null`;
              await bank.reverseAllocation(actor, allocation!.id);
              expect.soft(await taxInMonth(2, profile)).toBe(0);
              expect.soft(await vat.computeVatFigures({ year, month: 2 })).toMatchObject({ kz81: 0, tax81: 0 });
              const [payment] = await sql`select transaction_id from allocations where id = ${allocation!.id}`;
              await bank.allocate(actor, { kind: "invoice", transactionId: payment!.transaction_id, invoiceId: invoice.id, amount: 119_000 });
              expect.soft(await taxInMonth(2, profile)).toBe(versteuerung === "ist" ? 19_000 : 0);
              expect.soft(abgleich.abweichungen((await auswertungen.vatAbgleich({ year, month: 2 })).zeilen)).toEqual([]);
            }
          });

  for (const kontenrahmen of ["SKR03", "SKR04"] as const)
    for (const versteuerung of ["ist", "soll"] as const)
      for (const gmbh of [false, true]) {
        const profile = { kontenrahmen, versteuerung, gmbh };
        const name = `${versteuerung}, ${kontenrahmen}, ${gmbh ? "GmbH" : "Einzelunternehmen"}`;
        it(`Skonto nach Rücklastschrift behält die Rechnungsversteuerung (${name})`, async () => {
          const invoice = await returnedInvoice(profile);
          const payment = await transaction(`08.02.${String(year).slice(-2)}`, `Skontozahlung ${invoice.number}`, "1.166,20");
          await bank.allocateWithRest(actor, { transactionId: payment, target: { kind: "invoice", invoiceId: invoice.id }, rest: "skonto" });
          const tax = versteuerung === "ist" ? 18_620 : -380;
          const base = versteuerung === "ist" ? 98_000 : -2_000;
          expect.soft(await taxInMonth(2, profile)).toBe(tax);
          expect.soft(await vat.computeVatFigures({ year, month: 2 })).toMatchObject({ kz81: base, tax81: tax });
          expect.soft(abgleich.abweichungen((await auswertungen.vatAbgleich({ year, month: 2 })).zeilen)).toEqual([]);
          await expectDatevMatchesJournal();
          const [allocation] = await sql`select id from allocations where transaction_id = ${payment} and reverses_id is null`;
          await bank.reverseAllocation(actor, allocation!.id);
          expect.soft(await taxInMonth(2, profile)).toBe(0);
          expect.soft(await vat.computeVatFigures({ year, month: 2 })).toMatchObject({ kz81: 0, tax81: 0 });
        });
        it(`Forderungsausfall und spätere Aufhebung nach dem Wechsel (${name})`, async () => {
          const invoice = await returnedInvoice(profile);
          await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: invoice.id, date: `${year}-02-08` });
          const tax = versteuerung === "ist" ? 0 : -19_000;
          expect.soft(await taxInMonth(2, profile)).toBe(tax);
          expect.soft(await vat.computeVatFigures({ year, month: 2 })).toMatchObject({ kz81: versteuerung === "ist" ? 0 : -100_000, tax81: tax });
          expect.soft(abgleich.abweichungen((await auswertungen.vatAbgleich({ year, month: 2 })).zeilen)).toEqual([]);
          const [writeOff] = await bank.listWriteOffs({ invoiceId: invoice.id });
          await bank.reverseWriteOff(actor, writeOff!.id, `${year}-03-08`);
          expect.soft(await taxInMonth(3, profile)).toBe(-tax);
          expect.soft(abgleich.abweichungen((await auswertungen.vatAbgleich({ year, month: 3 })).zeilen)).toEqual([]);
          await expectDatevMatchesJournal();
        });
        if (versteuerung === "soll")
          it(`Kursdifferenz auf eine Rechnung des Vorjahres (${name})`, async () => {
            const invoice = await returnedInvoice(profile, true);
            const payment = await transaction(`08.02.${String(year).slice(-2)}`, `USD-Zahlung ${invoice.number}`, "1.180,00");
            await bank.allocateWithRest(actor, { transactionId: payment, target: { kind: "invoice", invoiceId: invoice.id }, rest: "kursdifferenz" });
            expect.soft(await taxInMonth(2, profile)).toBe(0);
            expect.soft(await vat.computeVatFigures({ year, month: 2 })).toMatchObject({ kz81: 0, tax81: 0 });
            expect.soft(abgleich.abweichungen((await auswertungen.vatAbgleich({ year, month: 2 })).zeilen)).toEqual([]);
            await expectDatevMatchesJournal();
          });
      }
});
