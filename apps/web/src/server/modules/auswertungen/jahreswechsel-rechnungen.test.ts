import { JOURNAL_KENNZAHLEN } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Voranmeldung und EÜR über den Jahreswechsel 2026/2027 (#542, docs/adr/journal-als-quelle.md): Eine bestehende
 * Installation (Stichjahr 2027, Migration 0192) rechnet Dezember 2026 aus den Nebenbüchern und Januar 2027 aus dem
 * Journal; eine neue rechnet beide aus dem Journal. Geprüft wird gegen von Hand gerechnete Werte, nicht nur Quelle gegen
 * Quelle: Jeder Euro Umsatzsteuer wird genau einmal gemeldet, die EÜR zählt nach Zufluss (§ 11 Abs. 1 EStG), und der
 * Abgleich findet in keinem der beiden Zeiträume eine Abweichung.
 *
 * Erwartung je Versteuerung (docs/buchhaltung.md „Ist- und Soll-Versteuerung“): Soll nach Rechnungsdatum (§ 13 Abs. 1
 * Nr. 1 Buchst. a Satz 1 UStG), Ist mit der Zahlung (§ 13 Abs. 1 Nr. 1 Buchst. b UStG); Skonto mindert bei Soll im Monat
 * der Ausbuchung (§ 17 Abs. 1 UStG), bei Ist zählt nur, was bezahlt ist. Der Steueranteil einer Teilzahlung ist
 * Zahlbetrag × Steuer ÷ Brutto je Satz, gerundet (paidTaxShares in packages/core/src/posting.ts).
 *
 * Rechnung mit 1.000,00 € zu 19 % und 500,00 € zu 7 %: 190,00 € und 35,00 € Steuer, 1.725,00 € brutto.
 * Teilzahlung 1.000,00 € im Dezember: Steuer gesamt 225 × 1000 / 1725 = 130,43 €; je Satz 110,14 € auf 579,71 € und
 * 20,29 € auf 289,86 €. Rest 725,00 € im Januar: 79,86 € auf 420,29 € und 14,71 € auf 210,14 €.
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

type Kennzahlen = Partial<Record<(typeof JOURNAL_KENNZAHLEN)[number], number>>;
const DEZ = { year: 2026, month: 12 };
const JAN = { year: 2027, month: 1 };

describe.skipIf(!testDatabaseUrl)("Jahreswechsel 2026/2027: Rechnungen, Zahlungen, Stornos (Postgres)", () => {
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let abgleich: typeof import("./abgleich.ts");
  let reports: typeof import("./reports.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("../umsatzsteuer/vat-figures.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    abgleich = await import("./abgleich.ts");
    reports = await import("./reports.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  /** Bestehende Installation: Stichjahr 2027; neue: leer, also ab der ersten Buchung (2026) aus dem Journal */
  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04", journalAb: 2027 | null) {
    await leeren(sql)`truncate vat_return_filings, vat_return_submissions, vat_returns, write_offs, allocations, bank_transactions, bank_imports,
      bank_accounts, cash_entries, journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts,
      company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, ${journalAb})`;
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
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  }

  const draftInput = (issueDate: string, lines: { net: number; rate: 1900 | 700 }[]) => ({
    contactId,
    issueDate,
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines: lines.map((l, i) => ({ description: `Leistung ${i}`, quantity: 1000, unit: "Psch." as const, unitPrice: l.net, taxRate: l.rate })),
  });
  const invoice = async (issueDate: string, lines: { net: number; rate: 1900 | 700 }[]) =>
    invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draftInput(issueDate, lines))).id);
  const gemischt = (issueDate: string) =>
    invoice(issueDate, [
      { net: 100_000, rate: 1900 },
      { net: 50_000, rate: 700 },
    ]);

  /** Bankumsatz einlesen; gibt seine Id zurück */
  async function umsatzVom(date: string, amount: string) {
    const purpose = crypto.randomUUID();
    await bank.importStatement(actor, { bytes: dkbCsv([umsatz(date, purpose, amount)]), filename: `${purpose}.csv` }, null);
    const [tx] = await sql`select id, amount from bank_transactions where purpose = ${purpose}`;
    return { id: tx!.id as string, amount: Number(tx!.amount) };
  }
  async function zahlung(invoiceId: string, date: string, amount: string) {
    const tx = await umsatzVom(date, amount);
    await bank.allocate(actor, { kind: "invoice", transactionId: tx.id, invoiceId, amount: tx.amount });
    return tx.id;
  }

  /** Kennzahlen ungleich 0 und die Quelle der Voranmeldung */
  async function va(period: { year: number; month: number }) {
    const f = await figures.computeVatFigures(period);
    const werte: Kennzahlen = {};
    for (const k of JOURNAL_KENNZAHLEN) if (f[k] !== 0) werte[k] = f[k];
    return { quelle: f.quelle, ...werte };
  }
  /** Zeilen der EÜR ungleich 0 und der Gewinn */
  async function euer(year: number) {
    const e = await reports.euerForYear(year);
    return { ...Object.fromEntries([...e.einnahmen, ...e.ausgaben].filter((l) => l.amount !== 0).map((l) => [l.key, l.amount])), gewinn: e.gewinn };
  }
  /** Der Abgleich findet für Dezember, Januar und beide Jahre nichts */
  async function abgleichSauber() {
    for (const p of [DEZ, JAN]) expect(abgleich.abweichungen((await abgleich.vatAbgleich(p)).zeilen), JSON.stringify(p)).toEqual([]);
    for (const year of [2026, 2027]) {
      const e = await abgleich.euerAbgleich(year);
      expect({ year, abw: abgleich.abweichungen(e.zeilen), hinweise: e.hinweise }).toEqual({ year, abw: [], hinweise: [] });
    }
  }
  const quelle = (journalAb: 2027 | null) => (journalAb === 2027 ? "nebenbuecher" : "journal");
  const VOLL: Kennzahlen = { kz81: 100_000, tax81: 19_000, kz86: 50_000, tax86: 3_500 };

  for (const journalAb of [2027, null] as const) {
    const inst = journalAb ? "bestehende Installation, Stichjahr 2027" : "neue Installation";
    for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
      for (const versteuerung of ["ist", "soll"] as const) {
        const fall = `${versteuerung}, ${kontenrahmen}, ${inst}`;
        const dez = (k: Kennzahlen) => ({ quelle: quelle(journalAb), ...k });
        const jan = (k: Kennzahlen) => ({ quelle: "journal", ...k });

        it(`Rechnung 19 % und 7 % im Dezember, Zahlung im Januar (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const inv = await gemischt("2026-12-10");
          await zahlung(inv.id, "05.01.27", "1.725,00");
          expect(await va(DEZ)).toEqual(dez(versteuerung === "soll" ? VOLL : {}));
          expect(await va(JAN)).toEqual(jan(versteuerung === "ist" ? VOLL : {}));
          expect(await euer(2026)).toEqual({ gewinn: 0 });
          expect(await euer(2027)).toEqual({ einnahmenSteuerpflichtig: 150_000, vereinnahmteUst: 22_500, gewinn: 172_500 });
          await abgleichSauber();
        }, 60_000);

        it(`Teilzahlung am 31.12., Rest am 1.1. (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const inv = await gemischt("2026-12-10");
          await zahlung(inv.id, "31.12.26", "1.000,00");
          await zahlung(inv.id, "01.01.27", "725,00");
          expect(await va(DEZ)).toEqual(dez(versteuerung === "soll" ? VOLL : { kz81: 57_971, tax81: 11_014, kz86: 28_986, tax86: 2_029 }));
          expect(await va(JAN)).toEqual(jan(versteuerung === "ist" ? { kz81: 42_029, tax81: 7_986, kz86: 21_014, tax86: 1_471 } : {}));
          expect(await euer(2026)).toEqual({ einnahmenSteuerpflichtig: 86_957, vereinnahmteUst: 13_043, gewinn: 100_000 });
          expect(await euer(2027)).toEqual({ einnahmenSteuerpflichtig: 63_043, vereinnahmteUst: 9_457, gewinn: 72_500 });
          await abgleichSauber();
        }, 60_000);

        it(`Teilzahlung 150,00 € am 31.12. mit Rundungsrest, Rest am 1.1. (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const inv = await gemischt("2026-12-10");
          await zahlung(inv.id, "31.12.26", "150,00");
          await zahlung(inv.id, "01.01.27", "1.575,00");
          // Steuer gesamt 225 × 150 / 1725 = 19,57 €; je Satz 16,52 € und 3,04 € (19,56 €): der Cent Rest geht an den
          // größten Posten (19 %), ebenso beim Netto (86,96 € + 43,48 € = 130,44 € statt 130,43 €), paidTaxShares
          expect(await va(DEZ)).toEqual(dez(versteuerung === "soll" ? VOLL : { kz81: 8_695, tax81: 1_653, kz86: 4_348, tax86: 304 }));
          expect(await va(JAN)).toEqual(jan(versteuerung === "ist" ? { kz81: 91_305, tax81: 17_347, kz86: 45_652, tax86: 3_196 } : {}));
          expect(await euer(2026)).toEqual({ einnahmenSteuerpflichtig: 13_043, vereinnahmteUst: 1_957, gewinn: 15_000 });
          expect(await euer(2027)).toEqual({ einnahmenSteuerpflichtig: 136_957, vereinnahmteUst: 20_543, gewinn: 157_500 });
          await abgleichSauber();
        }, 60_000);

        it(`Zahlung im Januar mit 3 % Skonto (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const inv = await gemischt("2026-12-10");
          // 1.725,00 € − 3 % = 1.673,25 €; Skonto 51,75 €, davon 6,75 € Steuer (5,70 € zu 19 %, 1,05 € zu 7 %)
          const tx = await umsatzVom("07.01.27", "1.673,25");
          await bank.allocateWithRest(actor, { transactionId: tx.id, target: { kind: "invoice", invoiceId: inv.id }, rest: "skonto" } as never);
          expect(await va(DEZ)).toEqual(dez(versteuerung === "soll" ? VOLL : {}));
          expect(await va(JAN)).toEqual(
            jan(
              versteuerung === "ist" ? { kz81: 97_000, tax81: 18_430, kz86: 48_500, tax86: 3_395 } : { kz81: -3_000, tax81: -570, kz86: -1_500, tax86: -105 },
            ),
          );
          expect(await euer(2026)).toEqual({ gewinn: 0 });
          expect(await euer(2027)).toEqual({ einnahmenSteuerpflichtig: 145_500, vereinnahmteUst: 21_825, gewinn: 167_325 });
          await abgleichSauber();
        }, 60_000);

        it(`Storno im Januar einer unbezahlten Rechnung aus dem Dezember (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const inv = await gemischt("2026-12-10");
          await invoices.cancelInvoice(actor, inv.id, "2027-01-10");
          expect(await va(DEZ)).toEqual(dez(versteuerung === "soll" ? VOLL : {}));
          // § 17 Abs. 1 und 2 Nr. 2 UStG: bei Soll Minderung im Monat des Stornos; bei Ist war nie etwas gemeldet
          expect(await va(JAN)).toEqual(jan(versteuerung === "soll" ? { kz81: -100_000, tax81: -19_000, kz86: -50_000, tax86: -3_500 } : {}));
          expect(await euer(2026)).toEqual({ gewinn: 0 });
          expect(await euer(2027)).toEqual({ gewinn: 0 });
          await abgleichSauber();
        }, 60_000);

        it(`Storno im Januar einer im Dezember bezahlten Rechnung, Rückzahlung im Januar (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const inv = await gemischt("2026-12-10");
          await zahlung(inv.id, "18.12.26", "1.725,00");
          const storno = await invoices.cancelInvoice(actor, inv.id, "2027-01-10");
          await zahlung(storno.id, "12.01.27", "-1.725,00");
          const minus: Kennzahlen = { kz81: -100_000, tax81: -19_000, kz86: -50_000, tax86: -3_500 };
          expect(await va(DEZ)).toEqual(dez(VOLL));
          expect(await va(JAN)).toEqual(jan(minus));
          expect(await euer(2026)).toEqual({ einnahmenSteuerpflichtig: 150_000, vereinnahmteUst: 22_500, gewinn: 172_500 });
          expect(await euer(2027)).toEqual({ einnahmenSteuerpflichtig: -150_000, vereinnahmteUst: -22_500, gewinn: -172_500 });
          await abgleichSauber();
        }, 60_000);

        it(`Rechnungskorrektur im Januar (Gutschrift 200,00 € zu 19 %), Zahlung des Rests im Januar (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const inv = await invoice("2026-12-10", [{ net: 100_000, rate: 1900 }]);
          const korrektur = await invoices.createCorrection(actor, inv.id, "2027-01-10");
          await invoices.updateDraft(actor, korrektur.id, { ...draftInput("2027-01-10", [{ net: -20_000, rate: 1900 }]), paymentTermDays: 0 });
          await invoices.finalizeInvoice(actor, korrektur.id);
          // 800,00 € + 152,00 € = 952,00 €
          await zahlung(inv.id, "20.01.27", "952,00");
          expect(await va(DEZ)).toEqual(dez(versteuerung === "soll" ? { kz81: 100_000, tax81: 19_000 } : {}));
          expect(await va(JAN)).toEqual(jan(versteuerung === "soll" ? { kz81: -20_000, tax81: -3_800 } : { kz81: 80_000, tax81: 15_200 }));
          expect(await euer(2027)).toEqual({ einnahmenSteuerpflichtig: 80_000, vereinnahmteUst: 15_200, gewinn: 95_200 });
          await abgleichSauber();
        }, 60_000);

        it(`Zahlung aus dem Dezember im Januar aufgehoben und einer anderen Rechnung zugeordnet (${fall})`, async () => {
          await reset(versteuerung, kontenrahmen, journalAb);
          const a = await invoice("2026-12-01", [{ net: 100_000, rate: 1900 }]);
          const b = await invoice("2026-12-02", [{ net: 100_000, rate: 700 }]);
          // 1.070,00 € gehören zu B (7 %), zuerst falsch auf A gebucht (1.190,00 € offen)
          const txId = await zahlung(a.id, "22.12.26", "1.070,00");
          const [alloc] = await sql`select id from allocations where transaction_id = ${txId}`;
          await bank.reverseAllocation(actor, alloc!.id);
          await bank.allocate(actor, { kind: "invoice", transactionId: txId, invoiceId: b.id, amount: 107_000 });
          await zahlung(a.id, "15.01.27", "1.190,00");
          // Die Aufhebung bucht am Tag des Bankumsatzes, also im Dezember (docs/adr/journal-als-quelle.md, Umgesetzt)
          expect(await va(DEZ)).toEqual(
            dez(versteuerung === "soll" ? { kz81: 100_000, tax81: 19_000, kz86: 100_000, tax86: 7_000 } : { kz86: 100_000, tax86: 7_000 }),
          );
          expect(await va(JAN)).toEqual(jan(versteuerung === "ist" ? { kz81: 100_000, tax81: 19_000 } : {}));
          expect(await euer(2026)).toEqual({ einnahmenSteuerpflichtig: 100_000, vereinnahmteUst: 7_000, gewinn: 107_000 });
          expect(await euer(2027)).toEqual({ einnahmenSteuerpflichtig: 100_000, vereinnahmteUst: 19_000, gewinn: 119_000 });
          await abgleichSauber();
        }, 60_000);
      }
    }
  }
});
