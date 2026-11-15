import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Nachprüfung zu #919 (Befund 3): Die EÜR aus dem Journal und aus den Nebenbüchern teilt Zahlungen nach Verrechnungen wie
 * die Voranmeldung, auch mit zwei Korrekturen, krummen Beträgen, Aufhebung, Soll und SKR04.
 */
describe.skipIf(!testDatabaseUrl)("Verrechnung und EÜR, Nachprüfung (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let bank: typeof import("../bank/bank.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    verrechnung = await import("./verrechnung.ts");
    contacts = await import("../stammdaten/contacts.ts");
    bank = await import("../bank/bank.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
    reports = await import("../auswertungen/reports.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  type Zeile = { netto: number; satz: 0 | 700 | 1900 };

  async function beleg(art: "rechnung" | "korrektur", zeilen: Zeile[], issueDate: string, correctsFor?: string): Promise<string> {
    const draft = await invoices.createDraft(
      actor,
      {
        contactId,
        issueDate,
        serviceFrom: null,
        serviceTo: null,
        paymentTermDays: 14,
        format: "zugferd",
        note: "",
        lines: zeilen.map((z) => ({ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: z.netto, taxRate: z.satz })),
      },
      art === "korrektur" ? { kind: "korrektur", correctsId: correctsFor! } : {},
    );
    return (await invoices.finalizeInvoice(actor, draft.id)).id;
  }

  async function zahle(invoiceId: string, betrag: number, datum: string): Promise<void> {
    const [konto] = await sql`
      insert into bank_accounts (name, iban, purpose) values ('Geschäftskonto', 'DE89370400440532013000', 'geschaeft')
      on conflict (iban) do update set name = excluded.name returning id`;
    const [import_] = await sql`
      insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${(konto as { id: string }).id}, 'umsatz.csv', ${datum.replaceAll("-", "").padEnd(64, "a")}, 'swan', 1, 0) returning id`;
    const [umsatz] = await sql`
      insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, dedup_hash)
      values (${(konto as { id: string }).id}, ${(import_ as { id: string }).id}, ${datum}, ${betrag}, 'Nordwerk Software GmbH', ${`h${datum}${betrag}`})
      returning id`;
    await bank.allocate(actor, { kind: "invoice", transactionId: (umsatz as { id: string }).id, invoiceId, amount: betrag });
  }

  beforeEach(async () => {
    await leeren(sql)`truncate invoice_settlements, dunnings, journal_lines, journal_entries, allocations, write_offs,
      cash_entries, invoice_taxes, invoice_lines, invoices, invoice_number_counters, bank_transactions, bank_imports,
      bank_accounts, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 14)`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "rechnung@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  }, 60_000);

  const zeilen = (r: { einnahmen: { key: string; amount: number }[]; ausgaben: { key: string; amount: number }[] }) =>
    Object.fromEntries([...r.einnahmen, ...r.ausgaben].filter((l) => l.amount !== 0).map((l) => [l.key, l.amount]));
  const kz = (f: { kz81: number; tax81: number; kz86: number; tax86: number }) => ({ kz81: f.kz81, tax81: f.tax81, kz86: f.kz86, tax86: f.tax86 });

  /** EÜR aus Journal und Nebenbüchern gleich, Zeilen 15/17 gleich der Voranmeldung des Jahres (Summe der Monate) */
  async function pruefe(jahr: number, monate: number[]) {
    const journal = await reports.euerForYear(jahr);
    const neben = await reports.euerAusNebenbuechern(jahr);
    expect(zeilen(neben)).toEqual(zeilen(journal));
    expect(neben.monthly.einnahmen).toEqual(journal.monthly.einnahmen);
    const summe = { kz81: 0, tax81: 0, kz86: 0, tax86: 0 };
    for (const month of monate) {
      const beide = await figures.kennzahlenBeiderQuellen({ year: jahr, month } as never);
      expect({ month, ...kz(beide.nebenbuecher) }).toEqual({ month, ...kz(beide.journal) });
      for (const k of Object.keys(summe) as (keyof typeof summe)[]) summe[k] += kz(beide.journal)[k];
    }
    const j = zeilen(journal);
    expect({ netto: j.einnahmenSteuerpflichtig ?? 0, ust: j.vereinnahmteUst ?? 0 }).toEqual({
      netto: summe.kz81 + summe.kz86,
      ust: summe.tax81 + summe.tax86,
    });
    return summe;
  }

  const zweiSaetze = (datum: string) =>
    beleg(
      "rechnung",
      [
        { netto: 10_000, satz: 1900 },
        { netto: 10_000, satz: 700 },
      ],
      datum,
    );

  it("zwei Korrekturen, beide verrechnet, dann der Rest", async () => {
    const rechnung = await zweiSaetze("2026-11-01");
    const a = await beleg("korrektur", [{ netto: -5_000, satz: 1900 }], "2026-11-05", rechnung);
    const b = await beleg("korrektur", [{ netto: -5_000, satz: 700 }], "2026-11-06", rechnung);
    await zahle(rechnung, 3_000, "2026-11-07");
    await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: a, amount: 5_950, date: "2026-11-08", note: "a" });
    await zahle(rechnung, 2_000, "2026-11-09");
    await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: b, amount: 5_350, date: "2026-11-10", note: "b" });
    await zahle(rechnung, 22_600 - 5_950 - 5_350 - 5_000, "2026-11-11");
    expect(await pruefe(2026, [11])).toEqual({ kz81: 5_000, tax81: 950, kz86: 5_000, tax86: 350 });
  }, 60_000);

  it("krumme Beträge, Korrektur mit zwei Sätzen, teilweise verrechnet", async () => {
    const rechnung = await beleg(
      "rechnung",
      [
        { netto: 33_333, satz: 1900 },
        { netto: 11_111, satz: 700 },
      ],
      "2026-11-01",
    );
    const k = await beleg(
      "korrektur",
      [
        { netto: -7_777, satz: 1900 },
        { netto: -2_222, satz: 700 },
      ],
      "2026-11-05",
      rechnung,
    );
    await zahle(rechnung, 12_345, "2026-11-06");
    await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: k, amount: 6_789, date: "2026-11-07", note: "teilweise" });
    await zahle(rechnung, 9_871, "2026-11-08");
    await pruefe(2026, [11]);
  }, 60_000);

  it("Aufhebung im Folgemonat ändert den gemeldeten Monat nicht", async () => {
    const rechnung = await zweiSaetze("2026-10-01");
    const k = await beleg("korrektur", [{ netto: -10_000, satz: 1900 }], "2026-10-05", rechnung);
    const { ids } = await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: k, amount: 11_900, date: "2026-10-06", note: "x" });
    await zahle(rechnung, 10_700, "2026-10-07");
    const okt = { year: 2026, month: 10 } as const;
    const vorher = kz(await figures.computeVatFigures(okt));
    const euerVorher = (await reports.euerAusNebenbuechern(2026)).monthly.einnahmen[9];
    expect(vorher).toEqual({ kz81: 0, tax81: 0, kz86: 10_000, tax86: 700 });
    await verrechnung.reverseInvoiceSettlement(actor, ids[0]!, "2026-11-08", "doch nicht");
    expect(kz(await figures.computeVatFigures(okt))).toEqual(vorher);
    expect((await reports.euerAusNebenbuechern(2026)).monthly.einnahmen[9]).toBe(euerVorher);
    expect((await reports.euerForYear(2026)).monthly.einnahmen[9]).toBe(euerVorher);
    await pruefe(2026, [10, 11]);
  }, 60_000);

  it("Aufhebung nach einer Zahlung, danach zahlt der Kunde den Rest der ganzen Rechnung", async () => {
    const rechnung = await zweiSaetze("2026-10-01");
    const k = await beleg("korrektur", [{ netto: -10_000, satz: 1900 }], "2026-10-05", rechnung);
    const { ids } = await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: k, amount: 11_900, date: "2026-10-06", note: "x" });
    await zahle(rechnung, 10_700, "2026-10-07");
    await verrechnung.reverseInvoiceSettlement(actor, ids[0]!, "2026-11-08", "doch nicht");
    await zahle(rechnung, 11_900, "2026-11-09");
    expect(await pruefe(2026, [10, 11])).toEqual({ kz81: 10_000, tax81: 1_900, kz86: 10_000, tax86: 700 });
  }, 60_000);

  it("Aufhebung nach einer Zahlung", async () => {
    const rechnung = await zweiSaetze("2026-11-01");
    const k = await beleg("korrektur", [{ netto: -10_000, satz: 1900 }], "2026-11-05", rechnung);
    const { ids } = await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: k, amount: 11_900, date: "2026-11-06", note: "x" });
    await zahle(rechnung, 10_700, "2026-11-07");
    await verrechnung.reverseInvoiceSettlement(actor, ids[0]!, "2026-11-08", "doch nicht");
    await pruefe(2026, [11]);
  }, 60_000);

  for (const [versteuerung, kontenrahmen] of [
    ["soll", "SKR03"],
    ["ist", "SKR04"],
    ["soll", "SKR04"],
  ] as const) {
    it(`${versteuerung}/${kontenrahmen}: Teilzahlung im Vormonat, Verrechnung, Rest`, async () => {
      await sql`update company set versteuerung = ${versteuerung}, kontenrahmen = ${kontenrahmen} where id = 1`;
      const rechnung = await zweiSaetze("2026-10-01");
      await zahle(rechnung, 5_000, "2026-10-05");
      const k = await beleg("korrektur", [{ netto: -10_000, satz: 1900 }], "2026-11-10", rechnung);
      await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: k, amount: 11_900, date: "2026-11-12", note: "x" });
      await zahle(rechnung, 5_700, "2026-11-13");
      const journal = await reports.euerForYear(2026);
      const neben = await reports.euerAusNebenbuechern(2026);
      expect(neben.monthly.einnahmen).toEqual(journal.monthly.einnahmen);
      expect(zeilen(neben)).toEqual(zeilen(journal));
      expect(zeilen(journal)).toMatchObject({ einnahmenSteuerpflichtig: 10_000, vereinnahmteUst: 700 });
      if (versteuerung === "ist") await pruefe(2026, [10, 11]);
    }, 60_000);
  }

  it("Jahreswechsel: Zahlung im Dezember, Verrechnung und Rest im Januar", async () => {
    const rechnung = await zweiSaetze("2025-12-01");
    await zahle(rechnung, 5_000, "2025-12-05");
    const k = await beleg("korrektur", [{ netto: -10_000, satz: 1900 }], "2026-01-10", rechnung);
    await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: k, amount: 11_900, date: "2026-01-12", note: "x" });
    await zahle(rechnung, 5_700, "2026-01-13");
    const v25 = await pruefe(2025, [12]);
    const v26 = await pruefe(2026, [1]);
    expect({ kz81: v25.kz81 + v26.kz81, kz86: v25.kz86 + v26.kz86 }).toEqual({ kz81: 0, kz86: 10_000 });
  }, 60_000);

  it("Zahlung mit früherem Datum, aber nach der Verrechnung erfasst", async () => {
    const rechnung = await zweiSaetze("2026-11-01");
    const k = await beleg("korrektur", [{ netto: -10_000, satz: 1900 }], "2026-11-05", rechnung);
    await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: k, amount: 11_900, date: "2026-11-14", note: "x" });
    await zahle(rechnung, 10_700, "2026-11-03");
    expect(await pruefe(2026, [11])).toEqual({ kz81: 0, tax81: 0, kz86: 10_000, tax86: 700 });
  }, 60_000);
});
