import { JOURNAL_KENNZAHLEN } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Voranmeldung und EÜR über den Jahreswechsel 2026/2027 (#542, docs/adr/journal-als-quelle.md), bestehende Installation
 * mit Stichjahr 2027: Umstellungen zum 1.1.2027 über die Firmendaten (saveCompany mit ihren Sperren) und die
 * Rücklastschrift einer Lastschrift aus dem Dezember. Erwartet, von Hand gerechnet:
 * - Ein Jahr rechnet nach der Versteuerung, nach der es gebucht ist (versteuerungForYear, docs/buchhaltung.md „Ist- und
 *   Soll-Versteuerung“); mit offenen Rechnungen sperrt Haben den Wechsel, sonst würde ihre Steuer doppelt oder gar nicht
 *   gemeldet.
 * - Kleinunternehmer: § 19 Abs. 1 UStG gilt für die Umsätze des Jahres, in dem die Grenze nicht überschritten ist; eine
 *   steuerpflichtige Rechnung aus 2026, bei Ist im Januar 2027 bezahlt, wird im Januar 2027 gemeldet (§ 13 Abs. 1 Nr. 1
 *   Buchst. b UStG), auch wenn 2027 die Kleinunternehmerregelung gilt; eine Kleinunternehmer-Rechnung aus 2026 nie.
 * - Kontenrahmen: Die Zahlung im neuen Jahr bucht im neuen Rahmen, die Kennzahlen bleiben dieselben.
 * - Rücklastschrift bei Ist: das vereinnahmte Entgelt geht zurück, die Steuer mindert sich im Monat der Rücklastschrift
 *   (§ 17 Abs. 2 Nr. 3 i. V. m. Abs. 1 UStG sinngemäß), die neue Zahlung meldet sie wieder; bei Soll bleibt die Steuer.
 */

const ACCOUNT_IBAN = "DE89370400440532013000";
function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE89 3704 0044 0532 0130 00"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}
const umsatz = (date: string, purpose: string, amount: string, lastschrift = false) => [
  date,
  date,
  "Gebucht",
  lastschrift ? "SEPA Lastschrifteinzug" : "Nordwerk",
  "Testfirma",
  purpose,
  amount.startsWith("-") ? "Ausgang" : "Eingang",
  lastschrift ? "" : "DE02120300000000202051",
  amount,
  "",
  "",
  "",
];

type Kennzahlen = Partial<Record<(typeof JOURNAL_KENNZAHLEN)[number], number>>;
const DEZ = { year: 2026, month: 12 };
const JAN = { year: 2027, month: 1 };
const FEB = { year: 2027, month: 2 };
const NEUJAHR = "2027-01-02";

describe.skipIf(!testDatabaseUrl)("Jahreswechsel 2026/2027: Umstellungen zum 1.1. und Rücklastschrift (Postgres)", () => {
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let company: typeof import("../stammdaten/company.ts");
  let guard: typeof import("../stammdaten/settings-guard.ts");
  let mandates: typeof import("../stammdaten/sepa-mandate.ts");
  let documents: typeof import("../belege/documents.ts");
  let abgleich: typeof import("./abgleich.ts");
  let reports: typeof import("./reports.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;
  let seq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("../umsatzsteuer/vat-figures.ts");
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    company = await import("../stammdaten/company.ts");
    guard = await import("../stammdaten/settings-guard.ts");
    mandates = await import("../stammdaten/sepa-mandate.ts");
    documents = await import("../belege/documents.ts");
    abgleich = await import("./abgleich.ts");
    reports = await import("./reports.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04", kleinunternehmer = false) {
    await leeren(sql)`truncate sepa_direct_debit_items, sepa_direct_debits, sepa_mandate_files, sepa_mandate_revocations, sepa_mandates,
      vat_return_submissions, vat_returns, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoice_taxes, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, glaeubiger_id,
        versteuerung, kontenrahmen, kleinunternehmer, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010', 'DE123456789', 'BY',
              ${ACCOUNT_IBAN}, 'COBADEFFXXX', 'Commerzbank', 'DE98ZZZ09999999999', ${versteuerung}, ${kontenrahmen}, ${kleinunternehmer}, 2027)`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "a@b.example",
        ustId: "",
        iban: "DE02120300000000202051",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  }
  /**
   * Firmendaten am 2.1.2027 ändern, über dieselbe Prüfung wie die Einstellungen (saveCompany, settingsLocks). Der Trigger
   * der Datenbank (company_settings_lock, drizzle/0065) prüft dasselbe mit der Uhr des Servers; die steht beim Schreiben
   * dieses Tests im November 2026, in dem es Buchungen gibt. Er wird nur für diese eine Änderung ausgesetzt; der
   * Audit-Trigger, aus dem versteuerungForYear liest, bleibt an.
   */
  async function umstellen(change: Record<string, unknown>) {
    const current = company.companySchema.parse(await company.loadCompany());
    await sql`alter table company disable trigger company_settings_lock`;
    try {
      await guard.saveCompany(actor, { ...current, ...change }, NEUJAHR);
    } finally {
      await sql`alter table company enable trigger company_settings_lock`;
    }
  }

  async function rechnung(issueDate: string, net: number, extra: Record<string, unknown> = {}) {
    const ku = extra.taxTreatment === "kleinunternehmer";
    const d = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Monat", unitPrice: net, taxRate: ku ? 0 : 1900 }],
      ...extra,
    } as never);
    return invoices.finalizeInvoice(actor, d.id);
  }
  async function beleg(date: string, net: number, tax: number) {
    seq++;
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seq % 256, 41, 7]), filename: `b${seq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: "",
      invoiceNumber: `R${seq}`,
      documentDate: date,
      dueDate: null,
      category: "edv",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net, tax }],
      privateShare: 0,
      reverseCharge: null,
    });
    await documents.bookDocument(actor, id);
    return id;
  }
  async function umsatzVom(date: string, amount: string, lastschrift = false, purpose: string = crypto.randomUUID()) {
    await bank.importStatement(actor, { bytes: dkbCsv([umsatz(date, purpose, amount, lastschrift)]), filename: `${crypto.randomUUID()}.csv` }, null);
    const [tx] = await sql`select id, amount from bank_transactions where purpose = ${purpose}`;
    return { id: tx!.id as string, amount: Number(tx!.amount) };
  }
  async function zahlung(target: { invoiceId: string } | { documentId: string }, date: string, amount: string) {
    const tx = await umsatzVom(date, amount);
    await bank.allocate(actor, {
      ...("invoiceId" in target ? { kind: "invoice" } : { kind: "document" }),
      ...target,
      transactionId: tx.id,
      amount: tx.amount,
    } as never);
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
  async function abgleichSauber(periods: { year: number; month: number }[]) {
    for (const p of periods) expect(abgleich.abweichungen((await abgleich.vatAbgleich(p)).zeilen), JSON.stringify(p)).toEqual([]);
    for (const year of [2026, 2027]) {
      const e = await abgleich.euerAbgleich(year);
      expect({ year, abw: abgleich.abweichungen(e.zeilen), hinweise: e.hinweise }).toEqual({ year, abw: [], hinweise: [] });
    }
  }
  const STEUER = { kz81: 100_000, tax81: 19_000 };

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const [vorher, nachher] of [
      ["ist", "soll"],
      ["soll", "ist"],
    ] as const) {
      it(`Versteuerung ${vorher} → ${nachher} zum 1.1.2027: gesperrt mit offener Rechnung, nach dem Ausgleich im Dezember frei (${kontenrahmen})`, async () => {
        await reset(vorher, kontenrahmen);
        const a = await rechnung("2026-12-05", 100_000);
        await zahlung({ invoiceId: a.id }, "20.12.26", "1.190,00");
        const b = await rechnung("2026-12-15", 100_000);
        await expect(umstellen({ versteuerung: nachher })).rejects.toThrow(/1 Rechnung ist noch offen/);
        // Der Kontoauszug vom 30.12. kommt am 2.1.: die Zahlung gehört ins alte Jahr
        await zahlung({ invoiceId: b.id }, "30.12.26", "1.190,00");
        await umstellen({ versteuerung: nachher });
        const c = await rechnung("2027-01-10", 100_000);
        await zahlung({ invoiceId: c.id }, "05.02.27", "1.190,00");
        // Dezember rechnet weiter nach der Versteuerung von 2026; hier sind beide Rechnungen im Dezember bezahlt
        expect(await va(DEZ)).toEqual({ quelle: "nebenbuecher", kz81: 200_000, tax81: 38_000 });
        expect(await va(JAN)).toEqual({ quelle: "journal", ...(nachher === "soll" ? STEUER : {}) });
        expect(await va(FEB)).toEqual({ quelle: "journal", ...(nachher === "ist" ? STEUER : {}) });
        expect(await euer(2027)).toEqual({ einnahmenSteuerpflichtig: 100_000, vereinnahmteUst: 19_000, gewinn: 119_000 });
        await abgleichSauber([DEZ, JAN, FEB]);
      }, 60_000);
    }

    it(`Kleinunternehmer endet zum 1.1.2027: Kleinunternehmer-Rechnung vom Dezember im Januar bezahlt (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen, true);
      const a = await rechnung("2026-12-10", 100_000, { taxTreatment: "kleinunternehmer" });
      await umstellen({ kleinunternehmer: false });
      await zahlung({ invoiceId: a.id }, "12.01.27", "1.000,00");
      const b = await rechnung("2027-01-15", 50_000);
      await zahlung({ invoiceId: b.id }, "20.01.27", "595,00");
      expect(await va(DEZ)).toEqual({ quelle: "nebenbuecher" });
      expect(await va(JAN)).toEqual({ quelle: "journal", kz81: 50_000, tax81: 9_500 });
      const e = await euer(2027);
      expect(e).toMatchObject({ einnahmenSteuerpflichtig: 50_000, vereinnahmteUst: 9_500, gewinn: 159_500 });
      await abgleichSauber([DEZ, JAN]);
    }, 60_000);

    it(`Kleinunternehmer ab 1.1.2027 (Ist): steuerpflichtige Rechnung vom Dezember im Januar bezahlt (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen);
      const a = await rechnung("2026-12-10", 100_000);
      await umstellen({ kleinunternehmer: true });
      await zahlung({ invoiceId: a.id }, "12.01.27", "1.190,00");
      expect(await va(DEZ)).toEqual({ quelle: "nebenbuecher" });
      expect(await va(JAN)).toEqual({ quelle: "journal", ...STEUER });
      expect(await euer(2027)).toEqual({ einnahmenSteuerpflichtig: 100_000, vereinnahmteUst: 19_000, gewinn: 119_000 });
      await abgleichSauber([DEZ, JAN]);
    }, 60_000);
  }

  for (const [vorher, nachher] of [
    ["SKR03", "SKR04"],
    ["SKR04", "SKR03"],
  ] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Kontenrahmen ${vorher} → ${nachher} zum 1.1.2027: Rechnung und Beleg vom Dezember im Januar bezahlt (${versteuerung})`, async () => {
        await reset(versteuerung, vorher);
        const a = await rechnung("2026-12-10", 100_000);
        const doc = await beleg("2026-12-12", 10_000, 1_900);
        await umstellen({ kontenrahmen: nachher });
        await zahlung({ invoiceId: a.id }, "12.01.27", "1.190,00");
        await zahlung({ documentId: doc }, "13.01.27", "-119,00");
        const [kr] = await sql`select distinct kontenrahmen from journal_entries where date >= '2027-01-01'`;
        expect(kr!.kontenrahmen).toBe(nachher);
        expect(await va(DEZ)).toEqual({ quelle: "nebenbuecher", kz66: 1_900, ...(versteuerung === "soll" ? STEUER : {}) });
        expect(await va(JAN)).toEqual({ quelle: "journal", ...(versteuerung === "ist" ? STEUER : {}) });
        expect(await euer(2027)).toEqual({
          einnahmenSteuerpflichtig: 100_000,
          vereinnahmteUst: 19_000,
          "ausgabe:edv": 10_000,
          vorsteuer: 1_900,
          gewinn: 107_100,
        });
        await abgleichSauber([DEZ, JAN]);
      }, 60_000);
    }
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Lastschrift im Dezember, Rücklastschrift im Januar, Überweisung im Februar (${versteuerung}, ${kontenrahmen})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const accountId = (await bank.createAccount(actor, { name: "Geschäftskonto", iban: ACCOUNT_IBAN })).id;
        const mandateId = await mandates.createMandate(
          actor,
          contactId,
          {
            reference: "KD-1042-01",
            signedOn: "2026-10-01",
            scheme: "CORE",
            firstSequence: "FRST",
            debtorName: "Nordwerk Software GmbH",
            debtorIban: "DE02120300000000202051",
          },
          "2026-11-09",
        );
        const a = await rechnung("2026-12-01", 100_000, { paymentMethod: "lastschrift", sepaMandateId: mandateId });
        const b = await rechnung("2026-12-01", 50_000, { paymentMethod: "lastschrift", sepaMandateId: mandateId });
        await bank.createDirectDebitFile(actor, { bankAccountId: accountId, invoiceIds: [a.id, b.id] }, new Date("2026-12-09T08:00:00Z"));
        // Sammler über 1.190,00 € + 595,00 €; zurück kommt nur die Lastschrift auf A
        const einzug = await umsatzVom("16.12.26", "1.785,00", true, "SEPA-Lastschrift Sammler");
        await bank.allocateDirectDebitBatch(actor, einzug.id);
        const rueck = await umsatzVom("12.01.27", "-1.190,00", false, `RUECKLASTSCHRIFT AM04 KD-1042-01 Rechnung ${a.number}`);
        await bank.allocateDirectDebitReturn(actor, rueck.id);
        await zahlung({ invoiceId: a.id }, "08.02.27", "1.190,00");
        expect(await va(DEZ)).toEqual({ quelle: "nebenbuecher", kz81: 150_000, tax81: 28_500 });
        expect(await va(JAN)).toEqual({ quelle: "journal", ...(versteuerung === "ist" ? { kz81: -100_000, tax81: -19_000 } : {}) });
        expect(await va(FEB)).toEqual({ quelle: "journal", ...(versteuerung === "ist" ? STEUER : {}) });
        expect(await euer(2026)).toEqual({ einnahmenSteuerpflichtig: 150_000, vereinnahmteUst: 28_500, gewinn: 178_500 });
        expect(await euer(2027)).toEqual({ gewinn: 0 });
        await abgleichSauber([DEZ, JAN, FEB]);
      }, 60_000);
    }
  }
});
