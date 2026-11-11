import { JOURNAL_KENNZAHLEN } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Voranmeldung und EÜR über den Jahreswechsel 2026/2027 (#542, docs/adr/journal-als-quelle.md), bestehende Installation
 * mit Stichjahr 2027: Umsätze ohne Steuer, Abschlags- und Schlussrechnung, vierteljährliche Abgabe, Dauerfristverlängerung
 * und die berichtigte Voranmeldung für Dezember 2026, erstellt im Januar 2027. Erwartet nach dem Gesetz, von Hand gerechnet:
 * - Kz 21 (§ 13b Abs. 1, 5 UStG, § 18b Satz 1 Nr. 2 UStG), Kz 41 (§ 18b Satz 1 Nr. 1, Satz 2 UStG) und Kz 45 nach
 *   Rechnungsdatum auch bei Ist (DATEV-Dok. 1080673, docs/umsatzsteuer.md „Umsätze ohne Steuer“); Kz 43 und 48 wie Kz 81.
 * - Ein Quartal umfasst seine drei Monate (§ 18 Abs. 2 Satz 1 UStG); Q4 2026 aus den Nebenbüchern, Q1 2027 aus dem Journal.
 * - Kz 39 nur in der letzten Voranmeldung des Jahres (§ 48 Abs. 4 UStDV); die Sondervorauszahlung ist in der EÜR gezahlte
 *   Umsatzsteuer im Jahr der Zahlung (§ 11 Abs. 2 EStG), ebenso die Zahllast für Dezember, gezahlt im Januar.
 * - Eine berichtigte Voranmeldung rechnet den Zeitraum neu, in dem der Umsatz liegt (§ 18 Abs. 1 UStG, § 153 AO); im
 *   Januar 2027 zählt davon nichts.
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
const PDF = new TextEncoder().encode("%PDF-1.4\n% Protokoll\n%%EOF\n");

type Kennzahlen = Partial<Record<(typeof JOURNAL_KENNZAHLEN)[number], number>>;
type Periode = { year: number; month: number };
const DEZ = { year: 2026, month: 12 };
const JAN = { year: 2027, month: 1 };
const FEB = { year: 2027, month: 2 };

describe.skipIf(!testDatabaseUrl)("Jahreswechsel 2026/2027: Umsätze ohne Steuer, Abschläge, Quartal, Dauerfrist, Berichtigung (Postgres)", () => {
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
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
  let sql: postgres.Sql;
  const actor = "test-user";
  let seq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("../umsatzsteuer/vat-figures.ts");
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
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04") {
    await leeren(sql)`truncate vat_return_filings, vat_return_submissions, vat_returns, vat_frequencies, vat_extension_submissions, vat_extensions, write_offs,
      allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts, documents, invoice_lines,
      invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, 2027)`;
  }

  type Behandlung = "regulaer" | "reverse_charge" | "ig_lieferung" | "drittland" | "ausfuhr" | "steuerfrei";
  const KUNDE: Record<Behandlung, { land: string; ustId: string }> = {
    regulaer: { land: "DE", ustId: "" },
    reverse_charge: { land: "AT", ustId: "ATU12345678" },
    ig_lieferung: { land: "NL", ustId: "NL987654321B01" },
    drittland: { land: "CH", ustId: "" },
    ausfuhr: { land: "CH", ustId: "" },
    steuerfrei: { land: "DE", ustId: "" },
  };
  async function kunde(behandlung: Behandlung) {
    return (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: `Kunde ${behandlung}`,
        strasse: "Ring 1",
        plz: "1010",
        ort: "Stadt",
        email: "a@b.example",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
        ...KUNDE[behandlung],
      })
    ).id;
  }
  async function rechnung(issueDate: string, net: number, behandlung: Behandlung = "regulaer", extra: Record<string, unknown> = {}) {
    const d = await invoices.createDraft(actor, {
      contactId: await kunde(behandlung),
      issueDate,
      serviceFrom: issueDate,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment: behandlung,
      exemptionReason: behandlung === "steuerfrei" ? "Steuerfrei nach § 4 Nr. 14 UStG" : "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: net, taxRate: behandlung === "regulaer" ? 1900 : 0 }],
      ...extra,
    } as never);
    return invoices.finalizeInvoice(actor, d.id);
  }
  async function beleg(date: string, net: number, tax: number) {
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
      amounts: [{ taxRate: 1900, net, tax }],
      privateShare: 0,
      reverseCharge: null,
    });
    await documents.bookDocument(actor, id);
    return id;
  }
  async function umsatzVom(date: string, amount: string) {
    const purpose = crypto.randomUUID();
    await bank.importStatement(actor, { bytes: dkbCsv([umsatz(date, purpose, amount)]), filename: `${purpose}.csv` }, null);
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

  async function va(period: Periode) {
    const f = await figures.computeVatFigures(period);
    const werte: Kennzahlen = {};
    for (const k of JOURNAL_KENNZAHLEN) if (f[k] !== 0) werte[k] = f[k];
    return { quelle: f.quelle, ...werte };
  }
  async function euer(year: number) {
    const e = await reports.euerForYear(year);
    return { ...Object.fromEntries([...e.einnahmen, ...e.ausgaben].filter((l) => l.amount !== 0).map((l) => [l.key, l.amount])), gewinn: e.gewinn };
  }
  async function abgleichSauber(periods: Periode[]) {
    for (const p of periods) expect(abgleich.abweichungen((await abgleich.vatAbgleich(p)).zeilen), JSON.stringify(p)).toEqual([]);
    for (const year of [2026, 2027]) {
      const e = await abgleich.euerAbgleich(year);
      expect({ year, abw: abgleich.abweichungen(e.zeilen), hinweise: e.hinweise }).toEqual({ year, abw: [], hinweise: [] });
    }
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

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      const fall = `${versteuerung}, ${kontenrahmen}`;

      it(`Reverse Charge, innergemeinschaftliche Lieferung, Drittland, Ausfuhr, steuerfrei: Rechnung im Dezember, Zahlung im Januar (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const arten = ["reverse_charge", "ig_lieferung", "drittland", "ausfuhr", "steuerfrei"] as const;
        for (const [i, art] of arten.entries()) {
          const inv = await rechnung(`2026-12-1${i}`, 50_000, art);
          await zahlung({ invoiceId: inv.id }, `0${i + 4}.01.27`, "500,00");
        }
        const nachRechnung: Kennzahlen = { kz21: 50_000, kz41: 50_000, kz45: 50_000 };
        const wieKz81: Kennzahlen = { kz43: 50_000, kz48: 50_000 };
        expect(await va(DEZ)).toEqual({ quelle: "nebenbuecher", ...nachRechnung, ...(versteuerung === "soll" ? wieKz81 : {}) });
        expect(await va(JAN)).toEqual({ quelle: "journal", ...(versteuerung === "ist" ? wieKz81 : {}) });
        expect(await euer(2026)).toEqual({ gewinn: 0 });
        expect(await euer(2027)).toEqual({ einnahmenSteuerfrei: 250_000, gewinn: 250_000 });
        await abgleichSauber([DEZ, JAN]);
      }, 60_000);

      it(`Abschlagsrechnung im Dezember bezahlt, Schlussrechnung im Januar, Rest im Februar (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const abschlag = await rechnung("2026-12-01", 30_000, "regulaer", { variant: "abschlag" });
        await zahlung({ invoiceId: abschlag.id }, "10.12.26", "357,00");
        const schluss = await rechnung("2027-01-15", 100_000, "regulaer", { variant: "schluss", deducts: [abschlag.id], contactId: abschlag.contactId });
        // 1.000,00 € Leistung, 300,00 € Abschlag abgezogen: 700,00 € netto, 133,00 € Steuer, 833,00 € offen
        expect(schluss).toMatchObject({ net: 70_000, tax: 13_300, gross: 83_300 });
        await zahlung({ invoiceId: schluss.id }, "05.02.27", "833,00");
        expect(await va(DEZ)).toEqual({ quelle: "nebenbuecher", kz81: 30_000, tax81: 5_700 });
        expect(await va(JAN)).toEqual({ quelle: "journal", ...(versteuerung === "soll" ? { kz81: 70_000, tax81: 13_300 } : {}) });
        expect(await va(FEB)).toEqual({ quelle: "journal", ...(versteuerung === "ist" ? { kz81: 70_000, tax81: 13_300 } : {}) });
        expect(await euer(2026)).toEqual({ einnahmenSteuerpflichtig: 30_000, vereinnahmteUst: 5_700, gewinn: 35_700 });
        expect(await euer(2027)).toEqual({ einnahmenSteuerpflichtig: 70_000, vereinnahmteUst: 13_300, gewinn: 83_300 });
        await abgleichSauber([DEZ, JAN, FEB]);
      }, 60_000);

      it(`vierteljährlich: Q4 2026 aus den Nebenbüchern, Q1 2027 aus dem Journal (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await zeitraum.saveFrequency(actor, { year: 2026, fromMonth: 1, frequency: "vierteljaehrlich" });
        await zeitraum.saveFrequency(actor, { year: 2027, fromMonth: 1, frequency: "vierteljaehrlich" });
        const inv = await rechnung("2026-11-15", 100_000);
        const doc = await beleg("2026-12-10", 10_000, 1_900);
        await zahlung({ documentId: doc }, "20.01.27", "-119,00");
        await zahlung({ invoiceId: inv.id }, "03.02.27", "1.190,00");
        const Q4 = { year: 2026, month: 44 };
        const Q1 = { year: 2027, month: 41 };
        expect(await va(Q4)).toEqual({ quelle: "nebenbuecher", kz66: 1_900, ...(versteuerung === "soll" ? { kz81: 100_000, tax81: 19_000 } : {}) });
        expect(await va(Q1)).toEqual({ quelle: "journal", ...(versteuerung === "ist" ? { kz81: 100_000, tax81: 19_000 } : {}) });
        const q4 = await vat.computedValues(Q4);
        const q1 = await vat.computedValues(Q1);
        expect([q4.kz83, q1.kz83]).toEqual(versteuerung === "soll" ? [17_100, 0] : [-1_900, 19_000]);
        expect(await euer(2027)).toEqual({
          einnahmenSteuerpflichtig: 100_000,
          vereinnahmteUst: 19_000,
          "ausgabe:edv": 10_000,
          vorsteuer: 1_900,
          gewinn: 107_100,
        });
        await abgleichSauber([Q4, Q1]);
      }, 60_000);

      it(`Dauerfristverlängerung: Kz 39 im Dezember 2026 und 2027, Zahllast Dezember und Sondervorauszahlung 2027 im Februar gezahlt (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await dauerfrist.saveDauerfrist(actor, { year: 2026, active: true, sondervorauszahlung: 50_000 });
        await dauerfrist.saveDauerfrist(actor, { year: 2027, active: true, sondervorauszahlung: 60_000 });
        const inv = await rechnung("2026-12-01", 1_000_000);
        await zahlung({ invoiceId: inv.id }, "15.12.26", "11.900,00");
        // Dezember: 1.900,00 € Umsatzsteuer abzüglich 500,00 € Sondervorauszahlung
        const dez = await gesendet(DEZ, "2027-02-08");
        expect({ kz81: dez.kz81, kz39: dez.kz39, kz83: dez.kz83 }).toEqual({ kz81: 1_000_000, kz39: 50_000, kz83: 140_000 });
        const zahllast = await umsatzVom("10.02.27", "-1.400,00");
        await bank.allocate(actor, { kind: "ustva", transactionId: zahllast.id, vatReturnId: dez.id, amount: zahllast.amount });
        const svz = await umsatzVom("10.02.27", "-600,00");
        await bank.allocate(actor, { kind: "sondervorauszahlung", transactionId: svz.id, amount: svz.amount });
        // Weder Zahllast noch Sondervorauszahlung ändern eine Kennzahl; Kz 39 nur in der letzten Voranmeldung des Jahres
        expect(await va(FEB)).toEqual({ quelle: "journal" });
        expect((await vat.computedValues(FEB)).kz39).toBe(0);
        expect(await vat.computedValues({ year: 2027, month: 12 })).toMatchObject({ kz39: 60_000, kz83: -60_000 });
        expect(await euer(2026)).toEqual({ einnahmenSteuerpflichtig: 1_000_000, vereinnahmteUst: 190_000, gewinn: 1_190_000 });
        expect(await euer(2027)).toEqual({ gezahlteUst: 200_000, gewinn: -200_000 });
        await abgleichSauber([DEZ, FEB]);
      }, 60_000);

      it(`berichtigte Voranmeldung für Dezember 2026, im Januar 2027 erstellt: Kontoauszug vom 30.12. und vergessener Beleg nachgetragen (${fall})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const inv = await rechnung("2026-12-01", 100_000);
        const erste = await gesendet(DEZ, "2027-01-08");
        expect({ kz81: erste.kz81, kz66: erste.kz66, kz83: erste.kz83 }).toEqual(
          versteuerung === "soll" ? { kz81: 100_000, kz66: 0, kz83: 19_000 } : { kz81: 0, kz66: 0, kz83: 0 },
        );
        // Nachgetragen im Januar 2027: Zahlung vom 30.12.2026 und ein Beleg vom 28.12.2026
        await zahlung({ invoiceId: inv.id }, "30.12.26", "1.190,00");
        await beleg("2026-12-28", 10_000, 1_900);
        await vat.createCorrection(actor, DEZ);
        const berichtigt = await vat.saveDraft(actor, DEZ, { mode: "berechnet" });
        expect({ berichtigt: berichtigt.berichtigt, kz81: berichtigt.kz81, kz66: berichtigt.kz66, kz83: berichtigt.kz83 }).toEqual({
          berichtigt: true,
          kz81: 100_000,
          kz66: 1_900,
          kz83: 17_100,
        });
        expect(await va(JAN)).toEqual({ quelle: "journal" });
        expect(await euer(2026)).toEqual({ einnahmenSteuerpflichtig: 100_000, vereinnahmteUst: 19_000, gewinn: 119_000 });
        await abgleichSauber([DEZ, JAN]);
      }, 60_000);
    }
  }
});
