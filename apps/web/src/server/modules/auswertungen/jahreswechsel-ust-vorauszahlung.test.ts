import type { EuerResult } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Umsatzsteuer-Vorauszahlung für Dezember bzw. das vierte Quartal in den zehn Tagen nach dem Jahreswechsel 2026/2027 (#583).
 * Regelmäßig wiederkehrende Ausgaben, die kurze Zeit nach Ende des Jahres abfließen, gehören in das Jahr, zu dem sie
 * wirtschaftlich gehören (§ 11 Abs. 2 Satz 2 EStG); „kurze Zeit“ heißt höchstens zehn Tage (H 11 EStH). Die Vorauszahlung muss
 * in diesen zehn Tagen auch fällig sein (BFH X R 2/21): ohne Dauerfristverlängerung am 10.01. (§ 18 Abs. 1 Satz 4 UStG), mit
 * ihr am 10.02. (§ 46 UStDV), dann zählt die Zahlung im Jahr der Zahlung (BFH VIII R 25/20). Der 10.01.2027 ist ein Sonntag;
 * die Verschiebung nach § 108 Abs. 3 AO zählt für § 11 EStG nicht (BFH X R 44/16). Eine Erstattung bleibt im Jahr des Zuflusses.
 * Stichjahr 2027: die EÜR 2026 aus den Nebenbüchern, 2027 aus dem Journal; beide Wege müssen dasselbe ergeben.
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
  "Finanzamt",
  "Testfirma",
  purpose,
  amount.startsWith("-") ? "Ausgang" : "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];
const PDF = new TextEncoder().encode("%PDF-1.4\n% Protokoll\n%%EOF\n");

type Periode = { year: number; month: number };
const NOV = { year: 2026, month: 11 };
const DEZ = { year: 2026, month: 12 };
const Q4 = { year: 2026, month: 44 };

describe.skipIf(!testDatabaseUrl)("Jahreswechsel 2026/2027: Umsatzsteuer-Vorauszahlung für Dezember in den zehn Tagen (Postgres)", () => {
  let vat: typeof import("../umsatzsteuer/vat.ts");
  let vermerk: typeof import("../umsatzsteuer/vermerk.ts");
  let zeitraum: typeof import("../umsatzsteuer/zeitraum.ts");
  let dauerfrist: typeof import("../umsatzsteuer/dauerfrist.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let abgleich: typeof import("./abgleich.ts");
  let reports: typeof import("./reports.ts");
  let quelle: typeof import("./euer-quelle.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let db: typeof import("../../db/index.ts").db;
  let ZEHN_TAGE_REGEL: string;
  let sql: postgres.Sql;
  const actor = "test-user";
  let seq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    vat = await import("../umsatzsteuer/vat.ts");
    vermerk = await import("../umsatzsteuer/vermerk.ts");
    zeitraum = await import("../umsatzsteuer/zeitraum.ts");
    dauerfrist = await import("../umsatzsteuer/dauerfrist.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    abgleich = await import("./abgleich.ts");
    reports = await import("./reports.ts");
    quelle = await import("./euer-quelle.ts");
    annual = await import("../jahreserklaerung/annual.ts");
    db = (await import("../../db/index.ts")).db;
    ({ ZEHN_TAGE_REGEL } = await import("./euer-jahreswechsel.ts"));
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04") {
    await leeren(sql)`truncate annual_submissions, year_closings, vat_return_filings, vat_return_submissions, vat_returns, vat_frequencies,
      vat_extension_submissions, vat_extensions, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, journal_ab,
              einkunftsart, taetigkeit)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, 2027, 'selbstaendig', 'Softwareentwicklung')`;
  }

  async function umsatzVom(date: string, amount: string) {
    const purpose = crypto.randomUUID();
    await bank.importStatement(actor, { bytes: dkbCsv([umsatz(date, purpose, amount)]), filename: `${purpose}.csv` }, null);
    const [tx] = await sql`select id, amount from bank_transactions where purpose = ${purpose}`;
    return { id: tx!.id as string, amount: Number(tx!.amount) };
  }

  /** Rechnung über 1.000,00 € netto, im selben Monat bezahlt: Zahllast 190,00 € bei Ist und Soll */
  async function umsatzImMonat(issueDate: string, payDate: string) {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Kunde",
      strasse: "Ring 1",
      plz: "93047",
      ort: "Regensburg",
      land: "DE",
      ustId: "",
      email: "a@b.example",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    } as never);
    const d = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate,
      serviceFrom: issueDate,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment: "regulaer",
      exemptionReason: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 100_000, taxRate: 1900 }],
    } as never);
    const inv = await invoices.finalizeInvoice(actor, d.id);
    const tx = await umsatzVom(payDate, "1.190,00");
    await bank.allocate(actor, { kind: "invoice", invoiceId: inv.id, transactionId: tx.id, amount: tx.amount } as never);
  }

  /** Beleg über 100,00 € netto, im selben Monat bezahlt: Vorsteuer 19,00 € */
  async function belegImMonat(date: string, payDate: string) {
    seq++;
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seq % 256, 31, 7]), filename: `b${seq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: "",
      invoiceNumber: `R${seq}`,
      documentDate: date,
      dueDate: null,
      category: "edv",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
      privateShare: 0,
      reverseCharge: null,
    });
    await documents.bookDocument(actor, id);
    const tx = await umsatzVom(payDate, "-119,00");
    await bank.allocate(actor, { kind: "document", documentId: id, transactionId: tx.id, amount: tx.amount } as never);
  }

  async function gesendet(period: Periode, heute: string) {
    const draft = await vat.saveDraft(actor, period, { mode: "berechnet" });
    seq++;
    return vermerk.vermerkeAbgabe(
      actor,
      draft.id,
      { filedOn: heute, transferTicket: `TT${period.year}${period.month}x${seq}`, kz83: draft.kz83, file: { bytes: PDF, filename: "p.pdf" } },
      heute,
    );
  }

  /** Zahlung bzw. Erstattung im Bankabgleich der Voranmeldung zugeordnet („Umsatzsteuer an das Finanzamt“) */
  async function zahlung(vatReturnId: string, date: string, amount: string) {
    const tx = await umsatzVom(date, amount);
    await bank.allocate(actor, { kind: "ustva", transactionId: tx.id, vatReturnId, amount: tx.amount });
  }

  const zeilen = (e: EuerResult) => ({
    ...Object.fromEntries([...e.einnahmen, ...e.ausgaben].filter((l) => l.amount !== 0).map((l) => [l.key, l.amount])),
    gewinn: e.gewinn,
  });
  async function euer(year: number) {
    return zeilen(await reports.euerForYear(year));
  }
  /** Nebenbücher und Journal ergeben dieselbe EÜR, der Abgleich zeigt keine Abweichung */
  async function beideWegeGleich() {
    for (const year of [2026, 2027]) {
      expect({ year, journal: zeilen(await quelle.euerAusDemJournal(year, db)) }).toEqual({
        year,
        journal: zeilen(await reports.euerAusNebenbuechern(year)),
      });
      const e = await abgleich.euerAbgleich(year);
      expect({ year, abw: abgleich.abweichungen(e.zeilen), hinweise: e.hinweise }).toEqual({ year, abw: [], hinweise: [] });
    }
  }

  const MIT_DEZEMBER = { einnahmenSteuerpflichtig: 100_000, vereinnahmteUst: 19_000, gezahlteUst: 19_000, gewinn: 100_000 };
  const OHNE_DEZEMBER = { einnahmenSteuerpflichtig: 100_000, vereinnahmteUst: 19_000, gewinn: 119_000 };
  const NUR_ZAHLUNG = { gezahlteUst: 19_000, gewinn: -19_000 };

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      const fall = `${versteuerung}, ${kontenrahmen}`;

      it(`Dezember, fällig 10.01. (Sonntag), gezahlt 08.01.: zählt im Vorjahr (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await umsatzImMonat("2026-12-01", "15.12.26");
        const dez = await gesendet(DEZ, "2027-01-05");
        expect(dez.kz83).toBe(19_000);
        await zahlung(dez.id, "08.01.27", "-190,00");
        expect(await euer(2026)).toEqual(MIT_DEZEMBER);
        expect(await euer(2027)).toEqual({ gewinn: 0 });
        await beideWegeGleich();
      }, 60_000);

      it(`Dezember, gezahlt 10.01.: noch im Vorjahr (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await umsatzImMonat("2026-12-01", "15.12.26");
        const dez = await gesendet(DEZ, "2027-01-05");
        await zahlung(dez.id, "10.01.27", "-190,00");
        expect(await euer(2026)).toEqual(MIT_DEZEMBER);
        expect(await euer(2027)).toEqual({ gewinn: 0 });
        await beideWegeGleich();
      }, 60_000);

      it(`Dezember, gezahlt 11.01. (nächster Werktag nach dem Sonntag): zählt im Zahlungsjahr (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await umsatzImMonat("2026-12-01", "15.12.26");
        const dez = await gesendet(DEZ, "2027-01-05");
        await zahlung(dez.id, "11.01.27", "-190,00");
        expect(await euer(2026)).toEqual(OHNE_DEZEMBER);
        expect(await euer(2027)).toEqual(NUR_ZAHLUNG);
        await beideWegeGleich();
      }, 60_000);

      it(`Dezember mit Dauerfristverlängerung (fällig 10.02.), gezahlt 08.01.: zählt im Zahlungsjahr (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await dauerfrist.saveDauerfrist(actor, { year: 2026, active: true, sondervorauszahlung: null });
        await umsatzImMonat("2026-12-01", "15.12.26");
        const dez = await gesendet(DEZ, "2027-01-05");
        await zahlung(dez.id, "08.01.27", "-190,00");
        expect(await euer(2026)).toEqual(OHNE_DEZEMBER);
        expect(await euer(2027)).toEqual(NUR_ZAHLUNG);
        await beideWegeGleich();
      }, 60_000);

      it(`November, verspätet gezahlt am 05.01.: nicht in den zehn Tagen fällig, zählt im Zahlungsjahr (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await umsatzImMonat("2026-11-02", "16.11.26");
        const nov = await gesendet(NOV, "2027-01-04");
        await zahlung(nov.id, "05.01.27", "-190,00");
        expect(await euer(2026)).toEqual(OHNE_DEZEMBER);
        expect(await euer(2027)).toEqual(NUR_ZAHLUNG);
        await beideWegeGleich();
      }, 60_000);

      it(`viertes Quartal bei vierteljährlicher Abgabe, gezahlt 08.01.: zählt im Vorjahr; mit Dauerfristverlängerung im Zahlungsjahr (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await zeitraum.saveFrequency(actor, { year: 2026, fromMonth: 1, frequency: "vierteljaehrlich" });
        await umsatzImMonat("2026-11-02", "16.11.26");
        const q4 = await gesendet(Q4, "2027-01-05");
        expect(q4.kz83).toBe(19_000);
        await zahlung(q4.id, "08.01.27", "-190,00");
        expect(await euer(2026)).toEqual(MIT_DEZEMBER);
        expect(await euer(2027)).toEqual({ gewinn: 0 });
        await beideWegeGleich();

        await dauerfrist.saveDauerfrist(actor, { year: 2026, active: true, sondervorauszahlung: null });
        expect(await euer(2026)).toEqual(OHNE_DEZEMBER);
        expect(await euer(2027)).toEqual(NUR_ZAHLUNG);
        await beideWegeGleich();
      }, 60_000);

      it(`Erstattung aus der Voranmeldung für Dezember, eingegangen 08.01.: bleibt im Jahr des Zuflusses (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await belegImMonat("2026-12-01", "10.12.26");
        const dez = await gesendet(DEZ, "2027-01-05");
        expect(dez.kz83).toBe(-1_900);
        await zahlung(dez.id, "08.01.27", "19,00");
        expect(await euer(2026)).toEqual({ "ausgabe:edv": 10_000, vorsteuer: 1_900, gewinn: -11_900 });
        expect(await euer(2027)).toEqual({ erstatteteUst: 1_900, gewinn: 1_900 });
        await beideWegeGleich();
      }, 60_000);

      it(`Vorjahr bereits übermittelt: die Zahlung bleibt im Zahlungsjahr, die Vorprüfung nennt die Abweichung (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await umsatzImMonat("2026-12-01", "15.12.26");
        const dez = await gesendet(DEZ, "2027-01-05");
        // Die Anlage EÜR 2026 ist übermittelt, bevor die Zahlung zugeordnet wird (etwa weil der Kontoauszug spät kam)
        await sql`insert into annual_submissions (form, year, kind, ok, code, message, figures, request_xml, response_xml, server_response_xml)
          values ('euer', 2026, 'send', true, 0, 'ok', ${JSON.stringify({ gewinn: 119_000 })}::jsonb, '<x/>', '<x/>', '<x/>')`;
        await zahlung(dez.id, "08.01.27", "-190,00");
        expect(await euer(2026)).toEqual(OHNE_DEZEMBER);
        expect(await euer(2027)).toEqual(NUR_ZAHLUNG);
        await beideWegeGleich();
        const hinweise = (await annual.annualOverview(2027, "2028-03-01")).euer.issues.map((i) => i.text);
        expect(hinweise.some((t) => /Vorauszahlung für Dezember 2026/.test(t) && /190,00/.test(t) && /übermittelt/.test(t))).toBe(true);
      }, 60_000);

      it(`Vorjahr nach dem Zuordnen übermittelt: die Zahlung bleibt im Vorjahr, wie übermittelt (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await umsatzImMonat("2026-12-01", "15.12.26");
        const dez = await gesendet(DEZ, "2027-01-05");
        await zahlung(dez.id, "08.01.27", "-190,00");
        // Übermittelt mit dieser Regel (Kennzeichen in den gespeicherten Werten): sie enthält die Zahlung
        await sql`insert into annual_submissions (form, year, kind, ok, code, message, figures, request_xml, response_xml, server_response_xml)
          values ('euer', 2026, 'send', true, 0, 'ok', ${JSON.stringify({ gewinn: 100_000, [ZEHN_TAGE_REGEL]: true })}::jsonb, '<x/>', '<x/>', '<x/>')`;
        expect(await euer(2026)).toEqual(MIT_DEZEMBER);
        expect(await euer(2027)).toEqual({ gewinn: 0 });
        await beideWegeGleich();
        const hinweise = (await annual.annualOverview(2027, "2028-03-01")).euer.issues.map((i) => i.text);
        expect(hinweise.some((t) => /übermittelt bzw\. abgeschlossen/.test(t))).toBe(false);
      }, 60_000);
    }
  }

  it.each(["08.01.27", "11.01.27"])(
    "aufgehobene Zuordnung vom %s: Zahlung und Gegenzeile zählen im selben Jahr und heben sich auf",
    async (tag) => {
      await reset("ist", "SKR03");
      await umsatzImMonat("2026-12-01", "15.12.26");
      const dez = await gesendet(DEZ, "2027-01-05");
      await zahlung(dez.id, tag, "-190,00");
      const [a] = await sql`select id from allocations where kind = 'ustVorauszahlung'`;
      await bank.reverseAllocation(actor, a!.id as string);
      // Saldo der Zahlungen an das Finanzamt und Gewinn; Zahlung und Gegenzeile zeigt das Journal auch ohne Jahreswechsel
      // getrennt als gezahlte und erstattete Umsatzsteuer, die Nebenbücher verrechnen sie
      const saldo = (e: EuerResult) => {
        const z = zeilen(e) as Record<string, number>;
        return { einnahmen: z.einnahmenSteuerpflichtig ?? 0, ust: (z.gezahlteUst ?? 0) - (z.erstatteteUst ?? 0), gewinn: z.gewinn };
      };
      for (const year of [2026, 2027]) {
        const erwartet = year === 2026 ? { einnahmen: 100_000, ust: 0, gewinn: 119_000 } : { einnahmen: 0, ust: 0, gewinn: 0 };
        expect(saldo(await quelle.euerAusDemJournal(year, db))).toEqual(erwartet);
        expect(saldo(await reports.euerAusNebenbuechern(year))).toEqual(erwartet);
        expect(abgleich.abweichungen((await abgleich.euerAbgleich(year)).zeilen)).toEqual([]);
      }
    },
    60_000,
  );
});
