import { parseDatevBuchungsstapel, datevAccountTotals } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/** #623: Eine bereits versteuerte Rechnung behält ihre Versteuerung nach dem Jahreswechsel (§ 20 UStG, UStAE 13.6 Abs. 3). */
describe.skipIf(!testDatabaseUrl)("Storno und Korrektur nach Versteuerungswechsel (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let guard: typeof import("../auswertungen/settings-guard.ts");
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
    guard = await import("../auswertungen/settings-guard.ts");
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
    await leeren(sql)`truncate seals, audit_log, annual_submissions, vat_return_filings, vat_return_submissions, vat_returns, vat_frequencies,
      cash_entries, sepa_direct_debit_items, sepa_direct_debits, write_offs, allocations, bank_transactions,
      bank_imports, bank_accounts, journal_lines, journal_entries, invoice_lines, invoice_taxes, invoices, invoice_number_counters,
      sepa_mandate_files, sepa_mandate_revocations, sepa_mandates, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic,
      bank, glaeubiger_id, kontenrahmen, versteuerung)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '0941 1', '198/113/10010',
      'DE123456789', 'BY', ${iban}, 'COBADEFFXXX', 'Commerzbank', 'DE98ZZZ09999999999', ${profile.kontenrahmen}, ${profile.versteuerung})`;
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
    const invoice = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    if (!foreign) await bank.createDirectDebitFile(actor, { bankAccountId: account.id, invoiceIds: [invoice.id] }, new Date(`${previousYear}-12-02T08:00:00Z`));
    await bank.allocate(actor, {
      kind: "invoice",
      transactionId: await transaction(`16.12.${String(previousYear).slice(-2)}`, `Lastschrift Rechnung ${invoice.number}`, "1.190,00"),
      invoiceId: invoice.id,
      amount: 119_000,
    });
    expect((await invoices.invoicePayments([invoice.id])).get(invoice.id)).toBe(119_000);
    const originalInvoice = await sql`select * from invoices where id = ${invoice.id}`;
    const originalEntries = await sql`select * from journal_entries where date < ${`${year}-01-01`} order by id`;
    const originalLines =
      await sql`select l.* from journal_lines l join journal_entries e on e.id = l.entry_id where e.date < ${`${year}-01-01`} order by l.id`;
    const oldReturn = await vat.saveDraft(actor, { year: previousYear, month: 12 }, { mode: "berechnet" });
    await sql`update vat_returns set status = 'sent', sent_at = now(), locked_at = now() where id = ${oldReturn.id}`;
    const originalReturn = await sql`select * from vat_returns where id = ${oldReturn.id}`;
    const originalSeals = await sql`select * from seals order by id`;
    await guard.saveCompany(
      actor,
      {
        ...(await stammdaten.loadCompany()),
        versteuerung: profile.versteuerung === "ist" ? "soll" : "ist",
      },
      `${year}-01-01`,
    );
    expect(await stammdaten.versteuerungForYear(previousYear)).toBe(profile.versteuerung);
    return { invoice, originalInvoice, originalEntries, originalLines, oldReturn, originalReturn, originalSeals };
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

  async function totalTax(profile: Profile) {
    const account = profile.kontenrahmen === "SKR03" ? "1776" : "3806";
    return Number((await sql`select coalesce(sum(credit-debit),0)::int as tax from journal_lines where account=${account}`)[0]!.tax);
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
      for (const gmbh of [false, true]) {
        const profile = { kontenrahmen, versteuerung, gmbh };
        it(`Storno nach Rücklastschrift folgt der ursprünglichen Rechnung (${kontenrahmen}, ${versteuerung}, ${gmbh ? "GmbH" : "Einzelunternehmen"})`, async () => {
          const invoice = await returnedInvoice(profile);
          await invoices.cancelInvoice(actor, invoice.id, `${year}-02-08`);
          const tax = versteuerung === "ist" ? 0 : -19_000;
          const base = versteuerung === "ist" ? 0 : -100_000;
          // § 17 Abs. 2 Nr. 3 UStG: Das Storno berichtigt nur die noch gemeldete Steuer.
          expect.soft(await taxInMonth(2, profile)).toBe(tax);
          const annualAccount = kontenrahmen === "SKR03" ? "1776" : "3806";
          const [annual] =
            await sql`select coalesce(sum(l.credit - l.debit), 0)::int as tax from journal_lines l join journal_entries e on e.id = l.entry_id where l.account = ${annualAccount} and e.date >= ${`${year}-01-01`}`;
          expect.soft(annual!.tax).toBe(-19_000);
          expect.soft(await vat.computeVatFigures({ year, month: 2 })).toMatchObject({ kz81: base, tax81: tax });
          expect.soft(abgleich.abweichungen((await auswertungen.vatAbgleich({ year, month: 2 })).zeilen)).toEqual([]);
          const suspense = kontenrahmen === "SKR03" ? "1766" : "3816";
          const [balance] = await sql`select coalesce(sum(debit - credit), 0)::int as saldo from journal_lines where account = ${suspense}`;
          expect.soft(balance!.saldo).toBe(0);
          await expectDatevMatchesJournal();
        });
        for (const kind of ["storno", "korrektur"] as const)
          it(`${kind} mit späterer Erstattung behält das ursprüngliche Verfahren (${kontenrahmen}, ${versteuerung}, ${gmbh ? "GmbH" : "Einzelunternehmen"})`, async () => {
            const original = await setup(profile);
            expect(original.invoice.advanceAccounting).toBe("deferred");
            expect(await totalTax(profile)).toBe(19_000);
            expect(await vat.computeVatFigures({ year: previousYear, month: 12 })).toMatchObject({ kz81: 100_000, tax81: 19_000 });
            const credit =
              kind === "storno"
                ? await invoices.cancelInvoice(actor, original.invoice.id, `${year}-02-08`)
                : await invoices.finalizeInvoice(
                    actor,
                    (await invoices.createCorrection(actor, original.invoice.id, `${year}-02-08`)).id,
                    kleinunternehmerStand,
                  );
            // Vollständig bezahltes neues Original: Die vollständige Rückabwicklung mindert die Steuer erst mit
            // tatsächlicher Rückgewähr, auch bei Soll und nach dem Wechsel (UStAE 17.1 Abs. 8 Satz 5, § 17 UStG).
            // Amtlicher UStAE, Stand 19.10.2026, Abschnitt 17.1 Abs. 8 Satz 5 (BFH 02.09.2010, V R 34/09).
            const expected = { kz81: 0, tax81: 0 };
            const february = await vat.computeVatFigures({ year, month: 2 });
            expect.soft(february).toMatchObject(expected);
            expect(await totalTax(profile)).toBe(19_000);
            expect(await vat.computeVatFigures({ year, month: 1 })).toMatchObject(expected);
            if (!gmbh) expect((await auswertungen.euerForYear(year)).einnahmen.reduce((sum, line) => sum + line.amount, 0)).toBe(0);
            const refund = await transaction(`08.03.${String(year).slice(-2)}`, `Erstattung ${credit.number}`, "-1.190,00");
            await bank.allocate(actor, { kind: "invoice", transactionId: refund, invoiceId: credit.id, amount: -119_000 });
            const march = await vat.computeVatFigures({ year, month: 3 });
            const paid = { kz81: -100_000, tax81: -19_000 };
            expect.soft(march).toMatchObject(paid);
            expect(await totalTax(profile)).toBe(0);
            expect(await vat.computeVatFigures({ year, month: 2 })).toMatchObject(expected);
            expect(await vat.computeVatFigures({ year: previousYear, month: 12 })).toMatchObject({ kz81: 100_000, tax81: 19_000 });
            if (!gmbh) {
              expect((await auswertungen.euerForYear(year)).einnahmen.reduce((sum, line) => sum + line.amount, 0)).toBe(-119_000);
              expect((await auswertungen.euerAbgleich(year)).zeilen.filter((row) => row.journal !== row.quelle)).toEqual([]);
            }
            expect.soft(abgleich.abweichungen((await auswertungen.vatAbgleich({ year, month: 3 })).zeilen)).toEqual([]);
            await expectDatevMatchesJournal();
            expect(await sql`select * from invoices where id = ${original.invoice.id}`).toEqual(original.originalInvoice);
            expect(await sql`select * from journal_entries where date < ${`${year}-01-01`} order by id`).toEqual(original.originalEntries);
            expect(
              await sql`select l.* from journal_lines l join journal_entries e on e.id = l.entry_id where e.date < ${`${year}-01-01`} order by l.id`,
            ).toEqual(original.originalLines);
            expect(await sql`select * from vat_returns where id = ${original.oldReturn.id}`).toEqual(original.originalReturn);
            expect(await sql`select * from seals where id in ${sql(original.originalSeals.map((seal) => seal.id))} order by id`).toEqual(
              original.originalSeals,
            );
            expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
          });
      }
  it("Vollständige Rückabwicklung des Soll-Originals nach Wechsel: Erstattung in Raten mindert jeweils nur den zurückgezahlten Anteil", async () => {
    // Vollständige Rückabwicklung, keine bloße teilweise Preisänderung (UStAE 17.1 Abs. 8 Satz 5).
    const profile = { kontenrahmen: "SKR03", versteuerung: "soll", gmbh: false } as const;
    const original = await setup(profile);
    const credit = await invoices.cancelInvoice(actor, original.invoice.id, `${year}-02-08`);
    expect(await vat.computeVatFigures({ year, month: 2 })).toMatchObject({ kz81: 0, tax81: 0 });
    const part = await transaction(`08.03.${String(year).slice(-2)}`, "Teilrückgewähr", "-119,00");
    await bank.allocate(actor, { kind: "invoice", transactionId: part, invoiceId: credit.id, amount: -11_900 });
    expect(await vat.computeVatFigures({ year, month: 3 })).toMatchObject({ kz81: -10_000, tax81: -1900 });
    expect(await totalTax(profile)).toBe(17_100);
    const rest = await transaction(`08.04.${String(year).slice(-2)}`, "Restliche Rückgewähr", "-1.071,00");
    await bank.allocate(actor, { kind: "invoice", transactionId: rest, invoiceId: credit.id, amount: -107_100 });
    expect(await vat.computeVatFigures({ year, month: 4 })).toMatchObject({ kz81: -90_000, tax81: -17_100 });
    expect(await totalTax(profile)).toBe(0);
    expect(await vat.computeVatFigures({ year, month: 3 })).toMatchObject({ kz81: -10_000, tax81: -1900 });
    expect(await sql`select * from invoices where id=${original.invoice.id}`).toEqual(original.originalInvoice);
    expect(await sql`select * from journal_entries where date < ${`${year}-01-01`} order by id`).toEqual(original.originalEntries);
    expect(await sql`select * from vat_returns where id=${original.oldReturn.id}`).toEqual(original.originalReturn);
    for (const month of [2, 3, 4]) expect(abgleich.abweichungen((await auswertungen.vatAbgleich({ year, month })).zeilen)).toEqual([]);
    await expectDatevMatchesJournal();
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });
});
