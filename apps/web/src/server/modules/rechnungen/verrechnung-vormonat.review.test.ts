import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Review zu #919: Ist mit zwei Steuersätzen, ein Teil ist schon vor der Korrektur bezahlt. Rechnung 100,00 € zu 19 % und
 * 100,00 € zu 7 %, im Oktober 50,00 € bezahlt (anteilig auf beide Sätze gebucht und gemeldet), im November die Korrektur
 * über die 19-%-Position, mit 119,00 € verrechnet, dann die restlichen 57,00 €. Ein schon gemeldeter Monat darf sich durch
 * die spätere Verrechnung nicht ändern (§ 17 Abs. 1 Satz 8 UStG: berichtigt wird im Zeitraum der Änderung), und Journal und
 * Nebenbücher müssen in jedem Monat dasselbe zeigen. Eine aufgehobene Verrechnung nimmt dem Mix nichts mehr weg.
 */
describe.skipIf(!testDatabaseUrl)("Verrechnung mit zwei Steuersätzen, Ist: Teilzahlung im Vormonat und Aufhebung (Postgres)", () => {
  let invoices: typeof import("./index.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let bank: typeof import("../bank/index.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    verrechnung = await import("./verrechnung.ts");
    contacts = await import("../stammdaten/contacts.ts");
    bank = await import("../bank/index.ts");
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
    return (await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand)).id;
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

  it("Ist: ein schon gemeldeter Vormonat bleibt, Journal und Nebenbücher stimmen in jedem Monat überein", async () => {
    const rechnung = await beleg(
      "rechnung",
      [
        { netto: 10_000, satz: 1900 },
        { netto: 10_000, satz: 700 },
      ],
      "2026-10-01",
    );
    await zahle(rechnung, 5_000, "2026-10-05");
    const okt = { year: 2026, month: 10 } as const;
    const nov = { year: 2026, month: 11 } as const;
    const kennzahlen = (f: Awaited<ReturnType<typeof figures.computeVatFigures>>) => ({ kz81: f.kz81, tax81: f.tax81, kz86: f.kz86, tax86: f.tax86 });
    const oktoberVorher = kennzahlen(await figures.computeVatFigures(okt));

    const korrektur = await beleg("korrektur", [{ netto: -10_000, satz: 1900 }], "2026-11-10", rechnung);
    await verrechnung.settleInvoices(actor, {
      invoiceId: rechnung,
      counterInvoiceId: korrektur,
      amount: 11_900,
      date: "2026-11-12",
      note: "Position zu 19 % zurückgenommen",
    });
    await zahle(rechnung, 5_700, "2026-11-13");

    expect(kennzahlen(await figures.computeVatFigures(okt))).toEqual(oktoberVorher);
    // Je Monat wie bisher aus den Nebenbüchern (#1116: die Werte der früheren Gegenprobe)
    const erwartet = { 10: { kz81: 2_213, tax81: 420, kz86: 2_212, tax86: 155 }, 11: { kz81: -2_213, tax81: -420, kz86: 7_788, tax86: 545 } };
    const summe = { kz81: 0, tax81: 0, kz86: 0, tax86: 0 };
    for (const periode of [okt, nov]) {
      const journal = kennzahlen(await figures.computeVatFigures(periode));
      expect({ monat: periode.month, ...journal }).toEqual({ monat: periode.month, ...erwartet[periode.month] });
      for (const feld of Object.keys(summe) as (keyof typeof summe)[]) summe[feld] += journal[feld];
    }
    // Vereinnahmt sind am Ende 107,00 € für die 7-%-Position; der 19-%-Anteil aus dem Oktober wird im November berichtigt
    expect(summe).toEqual({ kz81: 0, tax81: 0, kz86: 10_000, tax86: 700 });
  }, 60_000);

  it("Ist: nach der Aufhebung der Verrechnung verteilt sich die Zahlung wieder über die ganze Rechnung", async () => {
    const rechnung = await beleg(
      "rechnung",
      [
        { netto: 10_000, satz: 1900 },
        { netto: 10_000, satz: 700 },
      ],
      "2026-11-01",
    );
    const korrektur = await beleg("korrektur", [{ netto: -10_000, satz: 1900 }], "2026-11-10", rechnung);
    const { ids } = await verrechnung.settleInvoices(actor, {
      invoiceId: rechnung,
      counterInvoiceId: korrektur,
      amount: 11_900,
      date: "2026-11-12",
      note: "19 % zurück",
    });
    await verrechnung.reverseInvoiceSettlement(actor, ids[0]!, "2026-11-12", "versehentlich");
    // Ohne Verrechnung zahlt der Kunde die ganze Rechnung; das Guthaben der Korrektur bleibt offen
    await zahle(rechnung, 22_600, "2026-11-13");

    const nov = await figures.computeVatFigures({ year: 2026, month: 11 });
    expect({ kz81: nov.kz81, tax81: nov.tax81, kz86: nov.kz86, tax86: nov.tax86 }).toEqual({ kz81: 10_000, tax81: 1_900, kz86: 10_000, tax86: 700 });
  }, 60_000);
  it("Ist: die EÜR teilt die Zahlung nach der Verrechnung wie die Voranmeldung (netto und Umsatzsteuer)", async () => {
    const rechnung = await beleg(
      "rechnung",
      [
        { netto: 10_000, satz: 1900 },
        { netto: 10_000, satz: 700 },
      ],
      "2026-11-01",
    );
    const korrektur = await beleg("korrektur", [{ netto: -10_000, satz: 1900 }], "2026-11-10", rechnung);
    await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: korrektur, amount: 11_900, date: "2026-11-12", note: "19 % zurück" });
    await zahle(rechnung, 10_700, "2026-11-13");
    const zeilen = (r: { einnahmen: { key: string; amount: number }[]; ausgaben: { key: string; amount: number }[] }) =>
      Object.fromEntries([...r.einnahmen, ...r.ausgaben].filter((l) => l.amount !== 0).map((l) => [l.key, l.amount]));
    const journal = zeilen(await reports.euerForYear(2026));
    expect(journal).toEqual({ einnahmenSteuerpflichtig: 10_000, vereinnahmteUst: 700 });
  }, 60_000);
  it("Ist: die EÜR lässt den schon gemeldeten Vormonat stehen und berichtigt im November", async () => {
    const rechnung = await beleg(
      "rechnung",
      [
        { netto: 10_000, satz: 1900 },
        { netto: 10_000, satz: 700 },
      ],
      "2026-10-01",
    );
    await zahle(rechnung, 5_000, "2026-10-05");
    const korrektur = await beleg("korrektur", [{ netto: -10_000, satz: 1900 }], "2026-11-10", rechnung);
    await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: korrektur, amount: 11_900, date: "2026-11-12", note: "19 % zurück" });
    await zahle(rechnung, 5_700, "2026-11-13");

    const journal = await reports.euerForYear(2026);
    // Oktober bleibt, wie er gemeldet wurde: die 5.000 € verteilten sich über die volle Rechnung, davon 4.425 € netto
    expect(journal.monthly.einnahmen).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 4_425, 5_575, 0]);
    const zeilen = (r: { einnahmen: { key: string; amount: number }[]; ausgaben: { key: string; amount: number }[] }) =>
      Object.fromEntries([...r.einnahmen, ...r.ausgaben].filter((l) => l.amount !== 0).map((l) => [l.key, l.amount]));
    // Berichtigt wird im November: zusammen 10.000 € netto und 700 € Umsatzsteuer auf die vereinnahmten 107,00 €
    expect(zeilen(journal)).toEqual({ einnahmenSteuerpflichtig: 10_000, vereinnahmteUst: 700 });
  }, 60_000);
});
