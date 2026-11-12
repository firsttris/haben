import type { EuerResult } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * GoBD zur Umsatzsteuer-Vorauszahlung um den Jahreswechsel (#583): Eine übermittelte Anlage EÜR ändert Haben nicht mehr
 * nachträglich, auch nicht über die Einstellungen, von denen die Zuordnung zum Vorjahr abhängt (Dauerfristverlängerung), und
 * auch nicht im Jahr der Zahlung, wenn dessen Erklärung vor der Regel übermittelt wurde (ohne Kennzeichen ZEHN_TAGE_REGEL).
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
const DEZ = { year: 2026, month: 12 };

describe.skipIf(!testDatabaseUrl)("Jahreswechsel 2026/2027: übermittelte EÜR bleibt unverändert (Postgres)", () => {
  let vat: typeof import("../umsatzsteuer/vat.ts");
  let vermerk: typeof import("../umsatzsteuer/vermerk.ts");
  let dauerfrist: typeof import("../umsatzsteuer/dauerfrist.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let abgleich: typeof import("./abgleich.ts");
  let reports: typeof import("./reports.ts");
  let quelle: typeof import("./euer-quelle.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let db: typeof import("../../db/index.ts").db;
  let sql: postgres.Sql;
  const actor = "test-user";
  let seq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    vat = await import("../umsatzsteuer/vat.ts");
    vermerk = await import("../umsatzsteuer/vermerk.ts");
    dauerfrist = await import("../umsatzsteuer/dauerfrist.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    abgleich = await import("./abgleich.ts");
    reports = await import("./reports.ts");
    quelle = await import("./euer-quelle.ts");
    annual = await import("../jahreserklaerung/annual.ts");
    stammdaten = await import("../stammdaten/index.ts");
    db = (await import("../../db/index.ts")).db;
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset() {
    await leeren(sql)`truncate annual_submissions, year_closings, vat_return_filings, vat_return_submissions, vat_returns, vat_frequencies,
      vat_extension_submissions, vat_extensions, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, journal_ab,
              einkunftsart, taetigkeit)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 2027, 'selbstaendig', 'Softwareentwicklung')`;
  }

  async function umsatzVom(date: string, amount: string) {
    const purpose = crypto.randomUUID();
    await bank.importStatement(actor, { bytes: dkbCsv([umsatz(date, purpose, amount)]), filename: `${purpose}.csv` }, null);
    const [tx] = await sql`select id, amount from bank_transactions where purpose = ${purpose}`;
    return { id: tx!.id as string, amount: Number(tx!.amount) };
  }

  /** Rechnung über 1.000,00 € netto vom 01.12.2026, bezahlt 15.12.2026, Voranmeldung Dezember (190,00 €) vermerkt */
  async function dezemberMitVoranmeldung() {
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
      issueDate: "2026-12-01",
      serviceFrom: "2026-12-01",
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment: "regulaer",
      exemptionReason: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 100_000, taxRate: 1900 }],
    } as never);
    const inv = await invoices.finalizeInvoice(actor, d.id);
    const tx = await umsatzVom("15.12.26", "1.190,00");
    await bank.allocate(actor, { kind: "invoice", invoiceId: inv.id, transactionId: tx.id, amount: tx.amount } as never);
    const draft = await vat.saveDraft(actor, DEZ, { mode: "berechnet" });
    seq++;
    return vermerk.vermerkeAbgabe(
      actor,
      draft.id,
      { filedOn: "2027-01-05", transferTicket: `TT202612x${seq}`, kz83: draft.kz83, file: { bytes: PDF, filename: "p.pdf" } },
      "2027-01-05",
    );
  }

  async function zahlung(vatReturnId: string, date: string) {
    const tx = await umsatzVom(date, "-190,00");
    await bank.allocate(actor, { kind: "ustva", transactionId: tx.id, vatReturnId, amount: tx.amount });
  }

  /** Die Werte, die Haben mit einer Übermittlung der Anlage EÜR jetzt speichert (annualXml) */
  async function wieUebermittelt(year: number) {
    const company = await stammdaten.loadCompany();
    return (await annual.annualXml("euer", year, { company, data: await annual.euerYear(year) }, true, "00000")).daten;
  }

  async function uebermittelt(year: number, figures: Record<string, unknown>) {
    await sql`insert into annual_submissions (form, year, kind, ok, code, message, figures, request_xml, response_xml, server_response_xml)
      values ('euer', ${year}, 'send', true, 0, 'ok', ${JSON.stringify(figures)}::jsonb, '<x/>', '<x/>', '<x/>')`;
  }

  const zeilen = (e: EuerResult) => ({
    ...Object.fromEntries([...e.einnahmen, ...e.ausgaben].filter((l) => l.amount !== 0).map((l) => [l.key, l.amount])),
    gewinn: e.gewinn,
  });
  const euer = async (year: number) => zeilen(await reports.euerForYear(year));
  async function beideWegeGleich() {
    for (const year of [2026, 2027]) {
      expect({ year, journal: zeilen(await quelle.euerAusDemJournal(year, db)) }).toEqual({ year, journal: zeilen(await reports.euerAusNebenbuechern(year)) });
      expect({ year, abw: abgleich.abweichungen((await abgleich.euerAbgleich(year)).zeilen) }).toEqual({ year, abw: [] });
    }
  }
  /** Ändert die Einstellung, wenn Haben es zulässt; eine Ablehnung ist ebenso richtig */
  async function dauerfristAendern(active: boolean) {
    try {
      await dauerfrist.saveDauerfrist(actor, { year: 2026, active, sondervorauszahlung: null });
    } catch {
      // abgelehnt: die übermittelte EÜR bleibt ohnehin gleich
    }
  }

  const MIT_DEZEMBER = { einnahmenSteuerpflichtig: 100_000, vereinnahmteUst: 19_000, gezahlteUst: 19_000, gewinn: 100_000 };
  const OHNE_DEZEMBER = { einnahmenSteuerpflichtig: 100_000, vereinnahmteUst: 19_000, gewinn: 119_000 };
  const NUR_ZAHLUNG = { gezahlteUst: 19_000, gewinn: -19_000 };

  it("Dauerfristverlängerung 2026 nach der Übermittlung der EÜR 2026 eingetragen: die EÜR 2026 bleibt wie übermittelt", async () => {
    await reset();
    const dez = await dezemberMitVoranmeldung();
    await zahlung(dez.id, "08.01.27");
    expect(await euer(2026)).toEqual(MIT_DEZEMBER);
    await uebermittelt(2026, await wieUebermittelt(2026));
    await dauerfristAendern(true);
    expect(await euer(2026)).toEqual(MIT_DEZEMBER);
    expect(await euer(2027)).toEqual({ gewinn: 0 });
    await beideWegeGleich();
  }, 60_000);

  it("Dauerfristverlängerung 2026 nach der Übermittlung der EÜR 2026 beendet: die EÜR 2026 bleibt wie übermittelt", async () => {
    await reset();
    await dauerfrist.saveDauerfrist(actor, { year: 2026, active: true, sondervorauszahlung: null });
    const dez = await dezemberMitVoranmeldung();
    await zahlung(dez.id, "08.01.27");
    expect(await euer(2026)).toEqual(OHNE_DEZEMBER);
    await uebermittelt(2026, await wieUebermittelt(2026));
    await dauerfristAendern(false);
    expect(await euer(2026)).toEqual(OHNE_DEZEMBER);
    expect(await euer(2027)).toEqual(NUR_ZAHLUNG);
    await beideWegeGleich();
  }, 60_000);

  it("EÜR des Zahlungsjahres vor der Regel übermittelt (ohne Kennzeichen), Vorjahr nicht in Haben übermittelt: die EÜR 2027 bleibt wie übermittelt", async () => {
    await reset();
    const dez = await dezemberMitVoranmeldung();
    await zahlung(dez.id, "08.01.27");
    // Übermittelt vor #583: die Zahlung zählte am Buchungstag in 2027
    await uebermittelt(2027, { gewinn: -19_000 });
    expect(await euer(2027)).toEqual(NUR_ZAHLUNG);
    expect(await euer(2026)).toEqual(OHNE_DEZEMBER);
    await beideWegeGleich();
  }, 60_000);

  it("Zuordnung nach der Übermittlung der EÜR 2026 aufgehoben: die EÜR 2026 bleibt, beide Wege gleich", async () => {
    await reset();
    const dez = await dezemberMitVoranmeldung();
    await zahlung(dez.id, "08.01.27");
    await uebermittelt(2026, await wieUebermittelt(2026));
    const [a] = await sql`select id from allocations where kind = 'ustVorauszahlung'`;
    await bank.reverseAllocation(actor, a!.id as string);
    expect(await euer(2026)).toEqual(MIT_DEZEMBER);
    expect(await euer(2027)).toEqual({ gezahlteUst: -19_000, gewinn: 19_000 });
    expect(zeilen(await reports.euerAusNebenbuechern(2027))).toEqual({ gezahlteUst: -19_000, gewinn: 19_000 });
    await beideWegeGleich();
  }, 60_000);

  it("Zuordnung nach der Übermittlung der EÜR 2026 aufgehoben und neu zugeordnet: die Zahlung zählt schon in 2026, kein Hinweis", async () => {
    const { vorauszahlungVorjahrHinweis } = await import("./euer-jahreswechsel.ts");
    await reset();
    const dez = await dezemberMitVoranmeldung();
    await zahlung(dez.id, "08.01.27");
    await uebermittelt(2026, await wieUebermittelt(2026));
    const [a] = await sql`select id, transaction_id from allocations where kind = 'ustVorauszahlung'`;
    await bank.reverseAllocation(actor, a!.id as string);
    await bank.allocate(actor, { kind: "ustva", transactionId: a!.transaction_id as string, vatReturnId: dez.id, amount: -19_000 });
    expect(await euer(2026)).toEqual(MIT_DEZEMBER);
    expect((await euer(2027)).gewinn).toBe(0);
    expect((await reports.euerAusNebenbuechern(2027)).gewinn).toBe(0);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(2027)).zeilen)).toEqual([]);
    // Die Zahlung steckt in der übermittelten EÜR 2026; eine Berichtigung würde sie doppelt zählen
    expect(await vorauszahlungVorjahrHinweis(2027)).toBeNull();
  }, 60_000);

  it("Teil einer Zahlung nach der Übermittlung der EÜR 2026 zugeordnet: der Hinweis nennt nur diesen Teil", async () => {
    const { vorauszahlungVorjahrHinweis } = await import("./euer-jahreswechsel.ts");
    await reset();
    const dez = await dezemberMitVoranmeldung();
    const tx = await umsatzVom("08.01.27", "-190,00");
    await bank.allocate(actor, { kind: "ustva", transactionId: tx.id, vatReturnId: dez.id, amount: -10_000 });
    await uebermittelt(2026, await wieUebermittelt(2026));
    await bank.allocate(actor, { kind: "ustva", transactionId: tx.id, vatReturnId: dez.id, amount: -9_000 });
    expect((await euer(2026)).gewinn).toBe(109_000);
    expect((await euer(2027)).gewinn).toBe(-9_000);
    const hinweis = await vorauszahlungVorjahrHinweis(2027);
    expect(hinweis).toContain("für Dezember 2026 (90,00");
  }, 60_000);
});
