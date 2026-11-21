import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import type { EmployeeInput } from "../lohn/employees.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Privatkonto-Regel für alle Buchungsarten (#873): Läuft die Zahlung über ein Konto mit dem Zweck „privat“, bucht Haben
 * die Gegenzeile nicht gegen die Bank, sondern nach der Richtung des Zahlungskontos — bei einem Eingang die
 * Privatentnahme (SKR03 1800, SKR04 2100), bei einem Ausgang die Privateinlage (SKR03 1890, SKR04 2180), in GmbH und
 * UG in beiden Richtungen das Gesellschafter-Verrechnungskonto (SKR03 0730, SKR04 3510). Die Regel steht in bookPart an
 * einer Stelle (privatKontoPosting in @haben/core) und gilt damit für Steuern, Sondervorauszahlung, Kategorie,
 * Rechnung, Beleg, Lohn, Darlehen und Aufladung. Je Buchungsart ein Fall, dazu die Gegenprobe auf dem Geschäftskonto.
 *
 * Nicht dabei sind Kontoführung, Bankgebühren und Zinsen: Die sind auf einem privaten Konto privat, kein Betriebsvorfall
 * (§ 12 Nr. 1 EStG, § 20 EStG). Der Abgleich bietet sie dort nicht an und lehnt sie ab, statt sie gegen Entnahme zu
 * buchen (packages/core/src/konto-angebot.ts). Ebenso „Privat“, Spende und Geldtransit.
 *
 * Beträge, Namen und IBANs sind erfunden.
 */

const FIRMEN_IBAN = "DE89370400440532013000";

/** Kontoauszug im DKB-Format für ein Konto mit dieser IBAN; Betrag mit Vorzeichen wie auf dem Konto */
function dkbCsv(iban: string, rows: [datum: string, gegenpartei: string, zweck: string, betrag: string][]) {
  const header = `"Girokonto";"${iban}"\n\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([datum, gegenpartei, zweck, betrag]) =>
      [
        datum,
        datum,
        "Gebucht",
        betrag.startsWith("-") ? "Beispielfirma" : gegenpartei,
        betrag.startsWith("-") ? gegenpartei : "Beispielfirma",
        zweck,
        betrag.startsWith("-") ? "Ausgang" : "Eingang",
        "DE02100100100006820101",
        betrag,
        "",
        "",
        "",
      ]
        .map((c) => `"${c}"`)
        .join(";"),
    )
    .join("\n");
  return new TextEncoder().encode(`﻿${header}${columns}${body}\n`);
}

/** Angestellter ohne Besonderheiten; Beträge rechnet Haben, der Test prüft nur die Gegenzeile */
const ANGESTELLTER: EmployeeInput = {
  vorname: "Alex",
  nachname: "Beispiel",
  strasse: "Beispielweg 2",
  plz: "28195",
  ort: "Bremen",
  geburtsdatum: "1985-04-12",
  steuerId: "47291830467",
  steuerklasse: 1,
  konfession: null,
  art: "beschaeftigt",
  monatsgehalt: 4000_00,
  krankenversicherung: "gesetzlich",
  zusatzbeitrag: 310,
  kinderlosenzuschlag: false,
  kinderUnter25: 4,
  u1Satz: 160,
  u2Satz: 44,
  personengruppe: "101",
  beitragsgruppen: "1111",
  taetigkeitsschluessel: "431143111",
  svNummer: "12120480m123",
  krankenkasse: "Beispielkasse",
  krankenkasseBetriebsnummer: "15027365",
  statusfeststellung: "",
  eintritt: "2024-01-01",
  iban: "DE02120300000000202051",
};

describe.skipIf(!testDatabaseUrl)("Privatkonto: jede Buchungsart gegen Entnahme und Einlage (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let darlehen: typeof import("./darlehen.ts");
  let lohn: typeof import("../lohn/index.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let sql: postgres.Sql;
  const actor = "privatkonto-test";
  let lauf = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    darlehen = await import("./darlehen.ts");
    lohn = await import("../lohn/index.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Firma im gewünschten Profil; jeder Fall beginnt bei null */
  async function firma(optionen: { rechtsform?: "einzelunternehmen" | "gmbh"; kontenrahmen?: "SKR03" | "SKR04"; versteuerung?: "ist" | "soll" } = {}) {
    await leeren(sql)`truncate seals, audit_log, audit_chain, write_offs, allocations, journal_lines, journal_entries, bank_transactions, bank_imports,
      bank_accounts, vat_returns, loans, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts,
      document_cancellations, document_settlements, document_amounts, document_splits, documents, payslip_cancellations, payslips,
      payroll_runs, employees, company cascade`;
    await sql`insert into audit_chain (id, seq, hash) values (1, 0, haben_audit_genesis())`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, iban, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Beispielfirma', 'Beispielstraße 1', '28195', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${FIRMEN_IBAN},
              ${optionen.kontenrahmen ?? "SKR03"}, ${optionen.versteuerung ?? "ist"}, ${optionen.rechtsform ?? "einzelunternehmen"})`;
  }

  /** Eigenes Konto mit Zweck; die IBAN ist erfunden und je Aufruf eindeutig */
  async function konto(purpose: "privat" | "geschaeft", name = purpose === "privat" ? "Privatkonto" : "Geschäftskonto") {
    lauf++;
    return bank.createAccount(actor, { name, iban: `DE4450010517540732${String(4000 + lauf)}`, purpose });
  }

  /** Bankumsatz auf diesem Konto; gibt die Umsatz-Id zurück */
  async function umsatz(account: { id: string; iban: string | null }, datum: string, betrag: number, gegenpartei = "Beispiel GmbH") {
    lauf++;
    const euro = (Math.abs(betrag) / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = [datum.slice(2, 4), datum.slice(5, 7), datum.slice(8, 10)];
    const bytes = dkbCsv(account.iban!, [[`${tag}.${monat}.${jahr}`, gegenpartei, `Zahlung ${lauf}`, `${betrag < 0 ? "-" : ""}${euro}`]]);
    await bank.importStatement(actor, { bytes, filename: `auszug-${lauf}.csv` }, account.id);
    const [row] = await sql<{ id: string }[]>`
      select id from bank_transactions where bank_account_id = ${account.id} and amount = ${betrag} order by created_at desc limit 1`;
    return row!.id;
  }

  /** Zeilen der Buchung einer Zuordnung, aufsteigend nach Konto */
  async function zeilen(transactionId: string) {
    const rows = await sql<{ account: string; debit: number; credit: number }[]>`
      select l.account, l.debit, l.credit from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join allocations a on a.id = e.source_id
      where e.source_type = 'allocation' and a.transaction_id = ${transactionId} order by l.account`;
    return rows.map((row) => ({ account: row.account, debit: row.debit, credit: row.credit }));
  }

  it("Sondervorauszahlung als Ausgang bucht gegen die Privateinlage, nicht gegen die Bank", async () => {
    await firma();
    const privat = await konto("privat");
    const transaction = await umsatz(privat, "2026-11-10", -1100_00, "Finanzamt Beispielstadt");

    await bank.allocate(actor, { kind: "sondervorauszahlung", transactionId: transaction, amount: -1100_00 });

    expect(await zeilen(transaction)).toEqual([
      { account: "1781", debit: 1100_00, credit: 0 },
      { account: "1890", debit: 0, credit: 1100_00 },
    ]);
  });

  it("Sondervorauszahlung als Eingang bucht gegen die Privatentnahme", async () => {
    await firma();
    const privat = await konto("privat");
    const transaction = await umsatz(privat, "2026-11-11", 300_00, "Finanzamt Beispielstadt");

    await bank.allocate(actor, { kind: "sondervorauszahlung", transactionId: transaction, amount: 300_00 });

    expect(await zeilen(transaction)).toEqual([
      { account: "1781", debit: 0, credit: 300_00 },
      { account: "1800", debit: 300_00, credit: 0 },
    ]);
  });

  it("Gewerbesteuer im Steuer-Pfad bucht als Einlage, nicht gegen die Bank", async () => {
    await firma();
    const privat = await konto("privat");
    const transaction = await umsatz(privat, "2026-11-12", -500_00, "Finanzamt Beispielstadt");

    await bank.allocate(actor, {
      kind: "steuer",
      transactionId: transaction,
      amount: -500_00,
      steuer: { art: "gewst", jahr: 2026, posten: "steuer" },
    });

    expect(await zeilen(transaction)).toEqual([
      { account: "1890", debit: 0, credit: 500_00 },
      { account: "4320", debit: 500_00, credit: 0 },
    ]);
  });

  it("Erstattungszinsen zur Umsatzsteuer auf dem privaten Konto buchen als Entnahme", async () => {
    await firma();
    const privat = await konto("privat");
    const transaction = await umsatz(privat, "2026-11-12", 37_00, "Finanzamt Beispielstadt");

    await bank.allocate(actor, {
      kind: "steuer",
      transactionId: transaction,
      amount: 37_00,
      steuer: { art: "ust", jahr: 2025, posten: "zinsen233a" },
    });

    expect(await zeilen(transaction)).toEqual([
      { account: "1800", debit: 37_00, credit: 0 },
      { account: "2657", debit: 0, credit: 37_00 },
    ]);
  });

  it("Kontoführung und Zinsen bleiben auf dem privaten Konto gesperrt", async () => {
    await firma();
    const privat = await konto("privat");
    const gebuehr = await umsatz(privat, "2026-11-12", -9_50, "Beispielbank");
    const zins = await umsatz(privat, "2026-11-12", 1_20, "Beispielbank");

    // Gebühren und Zinsen eines privaten Kontos sind privat, kein Betriebsvorfall: Der Abgleich bietet sie dort nicht an
    await expect(bank.allocate(actor, { kind: "gebuehren", transactionId: gebuehr, amount: -9_50 })).rejects.toThrow(/keinen Geschäftsvorfall/);
    await expect(bank.allocate(actor, { kind: "zinsertrag", transactionId: zins, amount: 1_20 })).rejects.toThrow(/keinen Geschäftsvorfall/);
    expect(await zeilen(gebuehr)).toEqual([]);
    expect(await zeilen(zins)).toEqual([]);
  });

  it("Kategorie-Einnahme bucht gegen die Privatentnahme", async () => {
    await firma();
    const privat = await konto("privat");
    const transaction = await umsatz(privat, "2026-11-13", 119_00, "Kundin Beispiel");

    await bank.allocate(actor, {
      kind: "kategorie",
      transactionId: transaction,
      amount: 119_00,
      kategorie: { kategorie: "erloese", steuersatz: 1900 },
    });

    expect(await zeilen(transaction)).toEqual([
      { account: "1776", debit: 0, credit: 19_00 },
      { account: "1800", debit: 119_00, credit: 0 },
      { account: "8400", debit: 0, credit: 100_00 },
    ]);
  });

  it("Kategorie-Ausgabe bucht gegen die Privateinlage", async () => {
    await firma();
    const privat = await konto("privat");
    const transaction = await umsatz(privat, "2026-11-14", -49_00, "Telefonanbieter Beispiel");

    await bank.allocate(actor, {
      kind: "kategorie",
      transactionId: transaction,
      amount: -49_00,
      kategorie: { kategorie: "telefon", steuersatz: 0 },
    });

    expect(await zeilen(transaction)).toEqual([
      { account: "1890", debit: 0, credit: 49_00 },
      { account: "4920", debit: 49_00, credit: 0 },
    ]);
  });

  it("Zahlungseingang auf eine Rechnung bucht gegen die Privatentnahme", async () => {
    await firma({ versteuerung: "soll" });
    const kunde = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Kundin Beispiel GmbH",
      strasse: "Beispielweg 3",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@example.com",
      ustId: "",
      iban: "DE02120300000000202051",
      leitwegId: "",
      defaultFormat: null,
    });
    const defaults = await invoices.newDraftDefaults("2026-11-02");
    const draft = await invoices.createDraft(actor, {
      ...defaults,
      contactId: kunde.id,
      format: "zugferd",
      lines: [{ description: "Leistungen November", quantity: 1000, unit: "Psch.", unitPrice: 400_000, taxRate: 1900 }],
    });
    const invoice = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    const privat = await konto("privat");
    const transaction = await umsatz(privat, "2026-11-15", 4_760_00, "Kundin Beispiel GmbH");

    await bank.allocate(actor, { kind: "invoice", transactionId: transaction, invoiceId: invoice.id, amount: 4_760_00 });

    expect(await zeilen(transaction)).toEqual([
      { account: "1400", debit: 0, credit: 4_760_00 },
      { account: "1800", debit: 4_760_00, credit: 0 },
    ]);
  });

  it("Zahlung eines Belegs bucht gegen die Privateinlage", async () => {
    await firma();
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 17]), filename: "beleg.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Softwarehaus Beispiel",
      supplierUstId: "",
      invoiceNumber: "B-1",
      documentDate: "2026-11-03",
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      erstattetBezahltes: false,
      currency: "EUR",
      exchangeRate: null,
      amounts: [{ taxRate: 0, net: 119_00, tax: 0 }],
    });
    await documents.bookDocument(actor, id);
    const privat = await konto("privat");
    const transaction = await umsatz(privat, "2026-11-16", -119_00, "Softwarehaus Beispiel");

    await bank.allocate(actor, { kind: "document", transactionId: transaction, documentId: id, amount: -119_00 });

    expect(await zeilen(transaction)).toEqual([
      { account: "1600", debit: 119_00, credit: 0 },
      { account: "1890", debit: 0, credit: 119_00 },
    ]);
  });

  it("Lohnzahlung vom privaten Konto bucht gegen die Privateinlage", async () => {
    await firma();
    await lohn.saveEmployee(actor, null, ANGESTELLTER);
    await lohn.abrechnen(actor, { year: 2026, month: 10, zahltag: "2026-10-28" });
    const [entwurf] = await sql<{ id: string }[]>`select id from payslips where locked_at is null`;
    await lohn.festschreiben(actor, { id: entwurf!.id, gegengeprueft: true }, "2026-10-27");
    // Die Verbindlichkeit aus Lohn und Gehalt steht damit in den Büchern; der Betrag ist der offene Rest
    const [offen] = await sql<{ betrag: number }[]>`
      select (coalesce(sum(credit), 0) - coalesce(sum(debit), 0))::int as betrag from journal_lines where account = '1740'`;
    expect(offen!.betrag).toBeGreaterThan(0);
    const privat = await konto("privat");
    const transaction = await umsatz(privat, "2026-10-28", -offen!.betrag, "Alex Beispiel");

    await bank.allocate(actor, { kind: "lohn", transactionId: transaction, amount: -offen!.betrag });

    expect(await zeilen(transaction)).toEqual([
      { account: "1740", debit: offen!.betrag, credit: 0 },
      { account: "1890", debit: 0, credit: offen!.betrag },
    ]);
  });

  it("Tilgung eines Darlehens vom privaten Konto bucht gegen die Privateinlage", async () => {
    await firma();
    const loanId = await darlehen.createLoan(actor, {
      name: "Beispielbank",
      lender: "bank",
      term: "ohne",
      purpose: "betrieb",
      openingBalance: 1000_00,
      openingDate: "2026-01-01",
    });
    const privat = await konto("privat");
    const transaction = await umsatz(privat, "2026-11-17", -800_00, "Beispielbank");

    await bank.allocate(actor, { kind: "darlehen", transactionId: transaction, amount: -800_00, darlehen: { loanId, part: "tilgung" } });

    expect(await zeilen(transaction)).toEqual([
      { account: "0630", debit: 800_00, credit: 0 },
      { account: "1890", debit: 0, credit: 800_00 },
    ]);
  });

  it.each([
    ["SKR03", "ist", { aufwand: "4900", einlage: "1890" }],
    ["SKR04", "soll", { aufwand: "6300", einlage: "2180" }],
  ] as const)("%s, %s: Aufladung eines Guthabens bucht Aufwand gegen die Privateinlage, ohne Vorsteuer", async (kontenrahmen, versteuerung, konten) => {
    await firma({ kontenrahmen, versteuerung });
    const privat = await konto("privat");
    const transaction = await umsatz(privat, "2026-11-18", -90_00, "Funknetz Mobil");

    await bank.allocate(actor, { kind: "aufladung", transactionId: transaction, amount: -90_00, kategorie: { kategorie: "sonstiges", steuersatz: 0 } });

    // Keine Zeile auf der Bank; die Einlage steht in beiden Kontenrahmen vor dem Aufwandskonto
    expect(await zeilen(transaction)).toEqual([
      { account: konten.einlage, debit: 0, credit: 90_00 },
      { account: konten.aufwand, debit: 90_00, credit: 0 },
    ]);
    // Keine Vorsteuer: Die Aufladung selbst trägt keine Umsatzsteuer (§ 3 Abs. 15 UStG)
    expect((await figures.computeVatFigures({ year: 2026, month: 11 })).kz66).toBe(0);
  });

  it("in der GmbH bucht die Sondervorauszahlung gegen das Gesellschafter-Verrechnungskonto", async () => {
    await firma({ rechtsform: "gmbh" });
    const gesellschafter = await konto("privat", "Gesellschafter privat");
    const transaction = await umsatz(gesellschafter, "2026-11-18", -1100_00, "Finanzamt Beispielstadt");

    await bank.allocate(actor, { kind: "sondervorauszahlung", transactionId: transaction, amount: -1100_00 });

    expect(await zeilen(transaction)).toEqual([
      { account: "0730", debit: 0, credit: 1100_00 },
      { account: "1781", debit: 1100_00, credit: 0 },
    ]);
  });

  it("im SKR04 stehen Privatentnahme und -einlage auf 2100 und 2180", async () => {
    await firma({ kontenrahmen: "SKR04" });
    const privat = await konto("privat");
    const eingang = await umsatz(privat, "2026-11-19", 300_00, "Finanzamt Beispielstadt");
    const ausgang = await umsatz(privat, "2026-11-20", -1100_00, "Finanzamt Beispielstadt");

    await bank.allocate(actor, { kind: "sondervorauszahlung", transactionId: eingang, amount: 300_00 });
    await bank.allocate(actor, { kind: "sondervorauszahlung", transactionId: ausgang, amount: -1100_00 });

    expect(await zeilen(eingang)).toEqual([
      { account: "2100", debit: 300_00, credit: 0 },
      { account: "3830", debit: 0, credit: 300_00 },
    ]);
    expect(await zeilen(ausgang)).toEqual([
      { account: "2180", debit: 0, credit: 1100_00 },
      { account: "3830", debit: 1100_00, credit: 0 },
    ]);
  });

  it("Gegenprobe: auf dem Geschäftskonto buchen alle Arten unverändert gegen 1200", async () => {
    await firma({ versteuerung: "soll" });
    const geschaeft = await konto("geschaeft");

    const sondervorauszahlung = await umsatz(geschaeft, "2026-11-21", -1100_00, "Finanzamt Beispielstadt");
    await bank.allocate(actor, { kind: "sondervorauszahlung", transactionId: sondervorauszahlung, amount: -1100_00 });
    expect(await zeilen(sondervorauszahlung)).toEqual([
      { account: "1200", debit: 0, credit: 1100_00 },
      { account: "1781", debit: 1100_00, credit: 0 },
    ]);

    const kategorie = await umsatz(geschaeft, "2026-11-22", 119_00, "Kundin Beispiel");
    await bank.allocate(actor, {
      kind: "kategorie",
      transactionId: kategorie,
      amount: 119_00,
      kategorie: { kategorie: "erloese", steuersatz: 1900 },
    });
    expect(await zeilen(kategorie)).toEqual([
      { account: "1200", debit: 119_00, credit: 0 },
      { account: "1776", debit: 0, credit: 19_00 },
      { account: "8400", debit: 0, credit: 100_00 },
    ]);

    const gewst = await umsatz(geschaeft, "2026-11-23", -500_00, "Finanzamt Beispielstadt");
    await bank.allocate(actor, {
      kind: "steuer",
      transactionId: gewst,
      amount: -500_00,
      steuer: { art: "gewst", jahr: 2026, posten: "steuer" },
    });
    expect(await zeilen(gewst)).toEqual([
      { account: "1200", debit: 0, credit: 500_00 },
      { account: "4320", debit: 500_00, credit: 0 },
    ]);
  });
});
