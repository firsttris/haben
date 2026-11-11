import { JOURNAL_KENNZAHLEN } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Voranmeldung und EÜR über den Jahreswechsel 2026/2027 (#542, docs/adr/journal-als-quelle.md) für Eingangsbelege, die
 * Kasse und aus Lexoffice übernommene offene Posten; bestehende Installation (Stichjahr 2027) und neue. Erwartet nach
 * dem Gesetz, von Hand gerechnet:
 * - Vorsteuer nach Belegdatum (§ 15 Abs. 1 Satz 1 Nr. 1 UStG: Leistung erhalten und Rechnung liegt vor), unabhängig von der
 *   Zahlung; § 13b-Steuer und ihre Vorsteuer im Monat der Rechnung (§ 13b Abs. 2 UStG, § 15 Abs. 1 Satz 1 Nr. 4 UStG),
 *   beim Privatanteil nur der betriebliche Teil abziehbar (§ 15 Abs. 1 Satz 2 UStG).
 * - EÜR nach Abfluss (§ 11 Abs. 2 EStG), Vorsteuer als Betriebsausgabe im Jahr der Zahlung; der private Teil ist keine
 *   Betriebsausgabe (§ 4 Abs. 4, § 12 Nr. 1 EStG).
 * - Bareinnahmen am Tag der Einnahme, auch über den 31.12.
 * - Übernommene Lexoffice-Posten: Steuer und Vorsteuer sind in Lexoffice gemeldet, außer der Umsatzsteuer einer
 *   offenen Rechnung bei Ist; die EÜR sieht die Zahlung (docs/umsatzsteuer.md „Übernahmen aus Lexoffice“).
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}
const umsatz = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Testfirma",
  purpose,
  amount.startsWith("-") ? "Ausgang" : "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];
const PDF = new TextEncoder().encode("%PDF-1.4\n% aus Lexoffice\n%%EOF\n");

type Kennzahlen = Partial<Record<(typeof JOURNAL_KENNZAHLEN)[number], number>>;
const DEZ = { year: 2026, month: 12 };
const JAN = { year: 2027, month: 1 };

describe.skipIf(!testDatabaseUrl)("Jahreswechsel 2026/2027: Belege, Kasse, Übernahmen aus Lexoffice (Postgres)", () => {
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let vat: typeof import("../umsatzsteuer/vat.ts");
  let vermerk: typeof import("../umsatzsteuer/vermerk.ts");
  let bank: typeof import("../bank/bank.ts");
  let cash: typeof import("../bank/cash-income.ts");
  let cashBook: typeof import("../bank/cash.ts");
  let cashInvoice: typeof import("../bank/cash-invoice.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let legacy: typeof import("../archiv/legacy-open.ts");
  let abgleich: typeof import("./abgleich.ts");
  let reports: typeof import("./reports.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("../umsatzsteuer/vat-figures.ts");
    vat = await import("../umsatzsteuer/vat.ts");
    vermerk = await import("../umsatzsteuer/vermerk.ts");
    bank = await import("../bank/bank.ts");
    cash = await import("../bank/cash-income.ts");
    cashBook = await import("../bank/cash.ts");
    cashInvoice = await import("../bank/cash-invoice.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    legacy = await import("../archiv/legacy-open.ts");
    abgleich = await import("./abgleich.ts");
    reports = await import("./reports.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04", journalAb: 2027 | null) {
    await leeren(sql)`truncate vat_return_filings, vat_return_submissions, vat_returns, write_offs, allocations, bank_transactions, bank_imports,
      bank_accounts, cash_entries, document_cancellations, journal_lines, journal_entries, document_splits, document_amounts, documents,
      invoice_lines, invoices, invoice_number_counters, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contact_versions, contacts,
      company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, ${journalAb})`;
  }

  async function beleg(
    date: string,
    amounts: { taxRate: 1900 | 700; net: number; tax: number }[],
    extra: { payment?: "bank" | "privat" | "kasse"; privateShare?: number; reverseCharge?: "eu" | "drittland" | null; category?: string } = {},
  ) {
    docSeq++;
    const { id } = await documents.uploadDocument(actor, {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 21]),
      filename: `b${docSeq}.jpg`,
    });
    await documents.updateDocument(actor, id, {
      supplierName: extra.reverseCharge ? "Lieferant EU" : "Lieferant",
      supplierUstId: extra.reverseCharge === "eu" ? "ATU12345678" : "",
      invoiceNumber: `R${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: extra.category ?? "edv",
      payment: extra.payment ?? "bank",
      note: "",
      amounts,
      privateShare: extra.privateShare ?? 0,
      reverseCharge: extra.reverseCharge ?? null,
    } as never);
    await documents.bookDocument(actor, id);
    return id;
  }
  async function umsatzVom(date: string, amount: string) {
    const purpose = crypto.randomUUID();
    await bank.importStatement(actor, { bytes: dkbCsv([umsatz(date, purpose, amount)]), filename: `${purpose}.csv` }, null);
    const [tx] = await sql`select id, amount from bank_transactions where purpose = ${purpose}`;
    return { id: tx!.id as string, amount: Number(tx!.amount) };
  }
  async function belegZahlung(documentId: string, date: string, amount: string) {
    const tx = await umsatzVom(date, amount);
    await bank.allocate(actor, { kind: "document", transactionId: tx.id, documentId, amount: tx.amount });
  }
  async function rechnung(issueDate: string, net: number) {
    const c = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "a@b.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const d = await invoices.createDraft(actor, {
      contactId: c.id,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: net, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, d.id);
  }

  async function va(period: { year: number; month: number }) {
    const f = await figures.computeVatFigures(period);
    const werte: Kennzahlen = {};
    for (const k of JOURNAL_KENNZAHLEN) if (f[k] !== 0) werte[k] = f[k];
    return { quelle: f.quelle, ...werte };
  }
  async function euer(year: number) {
    const e = await reports.euerForYear(year);
    return { ...Object.fromEntries([...e.einnahmen, ...e.ausgaben].filter((l) => l.amount !== 0).map((l) => [l.key, l.amount])), gewinn: e.gewinn };
  }
  async function abgleichSauber(periods = [DEZ, JAN]) {
    for (const p of periods) expect(abgleich.abweichungen((await abgleich.vatAbgleich(p)).zeilen), JSON.stringify(p)).toEqual([]);
    for (const year of [2026, 2027]) {
      const e = await abgleich.euerAbgleich(year);
      expect({ year, abw: abgleich.abweichungen(e.zeilen), hinweise: e.hinweise }).toEqual({ year, abw: [], hinweise: [] });
    }
  }
  /** Voranmeldung berechnet speichern und als außerhalb von Haben abgegeben vermerken (wie nach dem Senden) */
  async function gesendet(period: { year: number; month: number }, heute: string) {
    const draft = await vat.saveDraft(actor, period, { mode: "berechnet" });
    return vermerk.vermerkeAbgabe(
      actor,
      draft.id,
      { filedOn: heute, transferTicket: `TT${period.year}${period.month}${docSeq++}`, kz83: draft.kz83, file: { bytes: PDF, filename: "p.pdf" } },
      heute,
    );
  }

  for (const journalAb of [2027, null] as const) {
    const inst = journalAb ? "bestehende Installation, Stichjahr 2027" : "neue Installation";
    const quelleDez = journalAb ? "nebenbuecher" : "journal";
    for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
      for (const versteuerung of ["ist", "soll"] as const) {
        const fall = `${versteuerung}, ${kontenrahmen}, ${inst}`;

        it(`Beleg im Dezember, Zahlung im Januar: 19 % und 7 % (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const id = await beleg("2026-12-15", [
            { taxRate: 1900, net: 100_000, tax: 19_000 },
            { taxRate: 700, net: 20_000, tax: 1_400 },
          ]);
          await belegZahlung(id, "05.01.27", "-1.404,00");
          expect(await va(DEZ)).toEqual({ quelle: quelleDez, kz66: 20_400 });
          expect(await va(JAN)).toEqual({ quelle: "journal" });
          expect(await euer(2026)).toEqual({ gewinn: 0 });
          expect(await euer(2027)).toEqual({ "ausgabe:edv": 120_000, vorsteuer: 20_400, gewinn: -140_400 });
          await abgleichSauber();
        }, 60_000);

        it(`Beleg mit 30 % Privatanteil im Dezember, Zahlung im Januar (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const id = await beleg("2026-12-15", [{ taxRate: 1900, net: 10_000, tax: 1_900 }], { category: "telefon", privateShare: 30 });
          await belegZahlung(id, "05.01.27", "-119,00");
          // Vorsteuer 70 % von 19,00 € = 13,30 €; Ausgabe 70 % von 100,00 € = 70,00 €; 35,70 € privat
          expect(await va(DEZ)).toEqual({ quelle: quelleDez, kz66: 1_330 });
          expect(await va(JAN)).toEqual({ quelle: "journal" });
          expect(await euer(2026)).toEqual({ gewinn: 0 });
          expect(await euer(2027)).toEqual({ "ausgabe:telefon": 7_000, vorsteuer: 1_330, gewinn: -8_330 });
          await abgleichSauber();
        }, 60_000);

        it(`§ 13b aus dem EU-Ausland im Dezember, Zahlung (netto) im Januar (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const id = await beleg("2026-12-15", [{ taxRate: 1900, net: 100_000, tax: 19_000 }], { reverseCharge: "eu" });
          await belegZahlung(id, "05.01.27", "-1.000,00");
          expect(await va(DEZ)).toEqual({ quelle: quelleDez, kz46: 100_000, kz47: 19_000, kz67: 19_000 });
          expect(await va(JAN)).toEqual({ quelle: "journal" });
          expect(await euer(2026)).toEqual({ gewinn: 0 });
          expect(await euer(2027)).toEqual({ "ausgabe:edv": 100_000, gewinn: -100_000 });
          await abgleichSauber();
        }, 60_000);

        it(`§ 13b mit 30 % Privatanteil im Dezember, Zahlung im Januar (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const id = await beleg("2026-12-15", [{ taxRate: 1900, net: 100_000, tax: 19_000 }], { reverseCharge: "eu", privateShare: 30 });
          await belegZahlung(id, "05.01.27", "-1.000,00");
          // Geschuldet die volle Steuer (Kz 47), abziehbar 70 % (Kz 67)
          expect(await va(DEZ)).toEqual({ quelle: quelleDez, kz46: 100_000, kz47: 19_000, kz67: 13_300 });
          expect(await va(JAN)).toEqual({ quelle: "journal" });
          expect(await euer(2026)).toEqual({ gewinn: 0 });
          // Der private Teil der geschuldeten Steuer (57,00 €) geht mit der Voranmeldung ans Finanzamt, ist aber keine
          // Vorsteuer: Die EÜR zählt ihn als Umsatzsteuer auf die Entnahme (euer-selbst-geschuldet-privat.test.ts)
          expect(await euer(2027)).toEqual({ "ausgabe:edv": 70_000, vereinnahmteUst: 5_700, gewinn: -64_300 });
          await abgleichSauber();
        }, 60_000);

        it(`Kasse: Bareinnahmen am 31.12. und 1.1., Bareinnahme auf eine Dezember-Rechnung am 2.1., Barbeleg am 31.12. (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          await cash.createCashIncome(
            actor,
            { date: "2026-12-31", amount: 119_00, text: "Markt", steuer: { behandlung: "regulaer", steuersatz: 1900 } },
            "2027-01-10",
          );
          await cash.createCashIncome(
            actor,
            { date: "2027-01-01", amount: 107_00, text: "Markt", steuer: { behandlung: "regulaer", steuersatz: 700 } },
            "2027-01-10",
          );
          await beleg("2026-12-31", [{ taxRate: 1900, net: 5_000, tax: 950 }], { payment: "kasse" });
          const inv = await rechnung("2026-12-20", 20_000);
          await cashInvoice.createCashInvoiceEntry(actor, { invoiceId: inv.id, date: "2027-01-02", amount: 238_00 } as never, "2027-01-10");
          const rechnungSteuer = { kz81: 20_000, tax81: 3_800 };
          expect(await va(DEZ)).toEqual(
            versteuerung === "soll"
              ? { quelle: quelleDez, kz81: 30_000, tax81: 5_700, kz66: 950 }
              : { quelle: quelleDez, kz81: 10_000, tax81: 1_900, kz66: 950 },
          );
          expect(await va(JAN)).toEqual(
            versteuerung === "ist" ? { quelle: "journal", ...rechnungSteuer, kz86: 10_000, tax86: 700 } : { quelle: "journal", kz86: 10_000, tax86: 700 },
          );
          expect(await euer(2026)).toEqual({ einnahmenSteuerpflichtig: 10_000, vereinnahmteUst: 1_900, "ausgabe:edv": 5_000, vorsteuer: 950, gewinn: 5_950 });
          expect(await euer(2027)).toEqual({ einnahmenSteuerpflichtig: 30_000, vereinnahmteUst: 4_500, gewinn: 34_500 });
          await abgleichSauber();
        }, 60_000);

        it(`Kasse: Bareinnahme vom 31.12. nach gesendeter Voranmeldung im Januar storniert (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const entry = await cash.createCashIncome(
            actor,
            { date: "2026-12-31", amount: 119_00, text: "Markt", steuer: { behandlung: "regulaer", steuersatz: 1900 } },
            "2027-01-03",
          );
          await gesendet(DEZ, "2027-01-04");
          await cashBook.reverseCashEntry(actor, entry.id, "2027-01-05");
          expect(await va(DEZ)).toEqual({ quelle: quelleDez, kz81: 10_000, tax81: 1_900 });
          expect(await va(JAN)).toEqual({ quelle: "journal", kz81: -10_000, tax81: -1_900 });
          expect(await euer(2026)).toEqual({ einnahmenSteuerpflichtig: 10_000, vereinnahmteUst: 1_900, gewinn: 11_900 });
          expect(await euer(2027)).toEqual({ einnahmenSteuerpflichtig: -10_000, vereinnahmteUst: -1_900, gewinn: -11_900 });
          await abgleichSauber();
        }, 60_000);
      }
    }
  }

  // Übernahme aus Lexoffice beim Umzug im November 2026 (Stichtag 31.10.2026, Eröffnung am 1.11.), Zahlung im Januar
  async function lexofficeBeleg(values: { type: "invoice" | "purchaseinvoice"; number: string; date: string; net: number; tax: number }) {
    const direction = values.type === "invoice" ? "einnahme" : "ausgabe";
    const gross = values.net + values.tax;
    const [row] = await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, type, direction, number, date, due_date, status, contact_id,
        contact_name, net, tax, gross, taxes, categories, payment, raw)
      values (${crypto.randomUUID()}, (select id from lexoffice_imports limit 1), ${values.type}, ${direction}, ${values.number},
        ${values.date}, ${values.date}, 'open', null, 'Nordwerk Software GmbH', ${values.net}, ${values.tax}, ${gross},
        ${JSON.stringify([{ rate: 1900, net: values.net, tax: values.tax }])}::jsonb,
        ${JSON.stringify(direction === "ausgabe" ? [{ categoryId: "x", name: "Bürobedarf", rate: 1900, net: values.net, tax: values.tax }] : [])}::jsonb,
        ${JSON.stringify({ status: "openRevenue", openAmount: gross, paidDate: null, items: [] })}::jsonb,
        ${JSON.stringify({ address: { name: "Nordwerk Software GmbH" } })}::jsonb)
      returning id`;
    const storage = await import("../../storage.ts");
    const sha = await storage.storeFile(PDF);
    await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size)
      values (${row!.id}, 'pdf', ${`${values.number}.pdf`}, 'application/pdf', ${sha}, ${PDF.byteLength})`;
    return row!.id as string;
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Lexoffice: offene Rechnung und offener Beleg aus 2026 übernommen, im Januar 2027 bezahlt (${versteuerung}, ${kontenrahmen}, Stichjahr 2027)`, async () => {
        await reset(versteuerung, kontenrahmen, 2027);
        await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
        const re = await lexofficeBeleg({ type: "invoice", number: "RE1019", date: "2026-10-20", net: 100_000, tax: 19_000 });
        const be = await lexofficeBeleg({ type: "purchaseinvoice", number: "B-77", date: "2026-10-25", net: 10_000, tax: 1_900 });
        const rechnungId = (await legacy.takeOverLegacyItem(actor, re, "2026-10-31")).id;
        const belegId = (await legacy.takeOverLegacyItem(actor, be, "2026-10-31")).id;
        const tx = await umsatzVom("15.01.27", "1.190,00");
        await bank.allocate(actor, { kind: "invoice", transactionId: tx.id, invoiceId: rechnungId, amount: tx.amount });
        await belegZahlung(belegId, "16.01.27", "-119,00");
        for (const month of [11, 12]) expect(await va({ year: 2026, month })).toEqual({ quelle: "nebenbuecher" });
        // Bei Ist war die Umsatzsteuer der offenen Rechnung in Lexoffice noch nicht fällig; die Vorsteuer ist dort gemeldet
        expect(await va(JAN)).toEqual(versteuerung === "ist" ? { quelle: "journal", kz81: 100_000, tax81: 19_000 } : { quelle: "journal" });
        expect(await euer(2026)).toEqual({ gewinn: 0 });
        const e2027 = await euer(2027);
        const ausgabe = Object.entries(e2027).filter(([k]) => k.startsWith("ausgabe:"));
        expect(ausgabe.map(([, v]) => v)).toEqual([10_000]);
        expect(e2027).toMatchObject({ einnahmenSteuerpflichtig: 100_000, vereinnahmteUst: 19_000, vorsteuer: 1_900, gewinn: 107_100 });
        await abgleichSauber([{ year: 2026, month: 11 }, DEZ, JAN]);
      }, 60_000);
    }
  }
});
