import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "./test-umsatz-stand.ts";

/*
 * Offene Posten zum Stichtag 31.12. (#1110, Schritt 2): Die Ansicht zeigt den Abschlussstand des gewählten Jahres.
 * „Offen“ und „überfällig“ rechnen dann zum Jahresende, und es zählt nur, was bis einschließlich dieses Tages wirkt:
 * Zahlungen danach zählen nicht (der Posten ist wieder offen), Belege und Rechnungen, die es damals noch nicht gab,
 * stehen nicht in der Liste. Der Stand von heute bleibt unverändert (ohne `bis`).
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom 01.03.2026:";"10.000,00 €"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
  return new TextEncoder().encode(`﻿${header}${columns}${body}\n`);
}

const row = (date: string, party: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  party,
  party,
  purpose,
  amount.startsWith("-") ? "Ausgang" : "Eingang",
  // IBAN des Gegenkontos: leer, weil der Prüfer vor dem Commit keine echten IBANs duldet
  "",
  amount,
  "",
  "",
  "",
];

describe.skipIf(!testDatabaseUrl)("Offene Posten zum Stichtag (Postgres)", () => {
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let cancellation: typeof import("../belege/cancellation.ts");
  let reports: typeof import("./reports.ts");
  let vat: typeof import("../umsatzsteuer/vat.ts");
  let vermerk: typeof import("../umsatzsteuer/vermerk.ts");
  let zahlung: typeof import("../umsatzsteuer/zahlung.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    cancellation = await import("../belege/cancellation.ts");
    reports = await import("./reports.ts");
    vat = await import("../umsatzsteuer/vat.ts");
    vermerk = await import("../umsatzsteuer/vermerk.ts");
    zahlung = await import("../umsatzsteuer/zahlung.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts,
      vat_return_submissions, vat_returns, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
  });

  /** Gebuchter Beleg, über die Bank zu zahlen (`payment: "bank"`), also eine offene Verbindlichkeit */
  async function bookedDocument(marker: number, fields: { supplierName: string; documentDate: string; net: number; tax: number }) {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, marker]), filename: `beleg-${marker}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: fields.supplierName,
      supplierUstId: "",
      invoiceNumber: `B-${marker}`,
      documentDate: fields.documentDate,
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: fields.net, tax: fields.tax }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  it("rechnet zum 31.12.: Zahlungen danach zählen nicht, spätere Belege fehlen", async () => {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    // 1.190,00 € brutto, fällig 14 Tage nach dem 03.11.2025 (Montag)
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate: "2025-11-03",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Wartung Oktober", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    const invoice = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    // Beleg aus dem Dezember 2025, im Februar 2026 bezahlt
    const altBeleg = await bookedDocument(1, { supplierName: "Hafenwerft Druck GmbH", documentDate: "2025-12-10", net: 25_000, tax: 4_750 });
    // Beleg aus dem Januar 2026: den gab es am 31.12.2025 noch nicht
    const neuBeleg = await bookedDocument(2, { supplierName: "JetBrains", documentDate: "2026-01-05", net: 10_000, tax: 1_900 });

    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          // genau am Stichtag: zählt zum Abschlussstand dazu („bis einschließlich“)
          row("31.12.25", "Nordwerk Software GmbH", `RE ${invoice.number}`, "19,00"),
          // danach: darf den Posten am 31.12.2025 nicht ausgleichen
          row("15.01.26", "Nordwerk Software GmbH", `RE ${invoice.number}`, "1.171,00"),
          row("02.02.26", "Hafenwerft Druck GmbH", "MF B-1", "-297,50"),
        ]),
        filename: "stichtag.csv",
      },
      null,
    );
    const txs = await sql`select id, amount from bank_transactions`;
    const tx = (amount: number) => txs.find((t) => t.amount === amount)!.id as string;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx(1_900), invoiceId: invoice.id, amount: 1_900 });
    await bank.allocate(actor, { kind: "invoice", transactionId: tx(117_100), invoiceId: invoice.id, amount: 117_100 });
    await bank.allocate(actor, { kind: "document", transactionId: tx(-29_750), documentId: altBeleg, amount: -29_750 });

    // Abschlussstand 31.12.2025: die Zahlung am Stichtag ist drin, die danach nicht; der Januar-Beleg fehlt
    const stichtag = await reports.openPositions("2025-12-31", { bis: "2025-12-31" });
    expect(stichtag.receivables).toEqual([
      expect.objectContaining({
        id: invoice.id,
        number: invoice.number,
        party: "Nordwerk Software GmbH",
        gross: 119_000,
        open: 117_100,
        dueDate: "2025-11-17",
        daysOverdue: 44,
      }),
    ]);
    expect(stichtag.payables).toEqual([
      expect.objectContaining({ id: altBeleg, party: "Hafenwerft Druck GmbH", gross: 29_750, open: 29_750, dueDate: "2025-12-10", daysOverdue: 21 }),
    ]);
    expect(stichtag.payables.some((p) => p.id === neuBeleg)).toBe(false);
    expect(stichtag).toMatchObject({ receivablesTotal: 117_100, payablesTotal: 29_750, receivablesOverdue: 117_100, payablesOverdue: 29_750 });

    // Stand von heute: die Rechnung ist bezahlt, der Altbeleg auch, der Januar-Beleg ist offen
    const heute = await reports.openPositions("2026-03-01");
    expect(heute.receivables).toEqual([]);
    expect(heute.payables).toEqual([expect.objectContaining({ id: neuBeleg, party: "JetBrains", gross: 11_900, open: 11_900, daysOverdue: 55 })]);
    expect(heute).toMatchObject({ receivablesTotal: 0, payablesTotal: 11_900 });
  }, 30_000);

  it("Umsatzsteuer: spätere Zahlungen zählen am 31.12. nicht, eine im Januar abgegebene Dezember-Anmeldung steht dort offen", async () => {
    const manuell = (kz81: number) => ({ mode: "manuell" as const, kz81, kz86: 0, kz66: 0, reason: "Werte laut Steuerberatung" });
    const abgabe = (kz83: number, filedOn: string, ticket: string) => ({
      filedOn,
      transferTicket: ticket,
      kz83,
      file: { bytes: new TextEncoder().encode(`%PDF-1.4\n% ${ticket}\n%%EOF\n`), filename: `UStVA_${filedOn}_Protokoll.pdf` },
    });
    // Q3/2025: im Oktober 2025 abgegeben, erst im Januar 2026 bezahlt
    const q3 = await vat.saveDraft(actor, { year: 2025, month: 9 }, manuell(100_000));
    await vermerk.vermerkeAbgabe(actor, q3.id, abgabe(q3.kz83, "2025-10-09", "etQ320251111"), "2025-10-09");
    // Dezember 2025: erst am 03.01.2026 abgegeben; zum 31.12. trotzdem offen, weil der Zeitraum geendet hat
    const q4 = await vat.saveDraft(actor, { year: 2025, month: 12 }, manuell(129_222));
    await vermerk.vermerkeAbgabe(actor, q4.id, abgabe(q4.kz83, "2026-01-03", "etQ420251112"), "2026-01-03");

    await bank.importStatement(actor, { bytes: dkbCsv([row("15.01.26", "Finanzamt Regensburg", "USt 09/25", "-190,00")]), filename: "ust.csv" }, null);
    const [ustZahlung] = await sql`select id from bank_transactions where amount = -19_000`;
    await bank.allocate(actor, { kind: "ustva", transactionId: ustZahlung!.id as string, vatReturnId: q3.id, amount: -19_000 });

    // Abschlussstand 31.12.2025: Q3 und die Dezember-Anmeldung, die erst im Januar abgegeben wurde (#1110); die
    // Zahlung im Januar zählt nicht, deshalb ist Q3 dort noch offen
    const stichtag = await zahlung.ustvaPosten(undefined, { bis: "2025-12-31" });
    expect(stichtag.posten.map((p) => p.month)).toEqual([9, 12]);
    expect(stichtag.posten[0]).toMatchObject({ betrag: q3.kz83, offen: q3.kz83 });
    expect(stichtag.posten[1]).toMatchObject({ betrag: q4.kz83, offen: q4.kz83 });
    // Die Zahlung im Januar ist nicht dabei; der Betrag rechnet sich zu -0, deshalb mit Toleranz
    expect(stichtag.posten[0]!.bezahlt).toBeCloseTo(0, 2);

    // Stand von heute: Q3 ist bezahlt, Q4 steht offen
    const heute = await zahlung.ustvaPosten();
    expect(heute.posten.map((p) => [p.month, p.offen])).toEqual([
      [9, 0],
      [12, q4.kz83],
    ]);
  }, 60_000);

  it("Storno und Aufhebung nach dem Stichtag lassen den Stand zum 31.12. stehen", async () => {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate: "2025-11-03",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Wartung Oktober", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    const invoice = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    const beleg = await bookedDocument(3, { supplierName: "Hafenwerft Druck GmbH", documentDate: "2025-12-10", net: 25_000, tax: 4_750 });

    // Dezember 2025 ist schon abgegeben: ein Storno danach trägt das Datum der Erfassung, nicht das des Belegs
    const dezember = await vat.saveDraft(
      actor,
      { year: 2025, month: 12 },
      {
        mode: "manuell",
        kz81: 0,
        kz86: 0,
        kz66: 0,
        reason: "keine Umsätze im Dezember",
      },
    );
    await vermerk.vermerkeAbgabe(
      actor,
      dezember.id,
      {
        filedOn: "2026-01-05",
        transferTicket: "et1220251201",
        kz83: dezember.kz83,
        file: { bytes: new TextEncoder().encode("%PDF-1.4\n% et1220251201\n%%EOF\n"), filename: "UStVA_2025-12.pdf" },
      },
      "2026-01-05",
    );

    // Beides erst im Folgejahr aufgehoben: am 31.12.2025 waren Forderung und Verbindlichkeit offen
    await invoices.cancelInvoice(actor, invoice.id, "2026-01-10");
    await cancellation.cancelDocument(actor, beleg, { reason: "Doppelt erfasst" }, "2026-02-15");

    // Umsatzsteuer 11/2025: am 05.12.2025 abgegeben, am 10.12.2025 bezahlt, die Zuordnung am 20.02.2026 aufgehoben
    const manuell = { mode: "manuell" as const, kz81: 100_000, kz86: 0, kz66: 0, reason: "Werte laut Steuerberatung" };
    const ust = await vat.saveDraft(actor, { year: 2025, month: 11 }, manuell);
    await vermerk.vermerkeAbgabe(
      actor,
      ust.id,
      {
        filedOn: "2025-12-05",
        transferTicket: "et1120251111",
        kz83: ust.kz83,
        file: { bytes: new TextEncoder().encode("%PDF-1.4\n% et1120251111\n%%EOF\n"), filename: "UStVA_2025-12-05_Protokoll.pdf" },
      },
      "2025-12-05",
    );
    await bank.importStatement(actor, { bytes: dkbCsv([row("10.12.25", "Finanzamt Regensburg", "USt 11/25", "-190,00")]), filename: "ust.csv" }, null);
    const [ustZahlung] = await sql`select id from bank_transactions where amount = -19_000`;
    await bank.allocate(actor, { kind: "ustva", transactionId: ustZahlung!.id as string, vatReturnId: ust.id, amount: -19_000 });
    const [zuordnung] = await sql`select id from allocations where vat_return_id = ${ust.id}`;
    await bank.reverseAllocation(actor, zuordnung!.id as string, "2026-02-20");

    const stichtag = await reports.openPositions("2025-12-31", { bis: "2025-12-31" });
    expect(stichtag.receivables).toEqual([expect.objectContaining({ id: invoice.id, gross: 119_000, open: 119_000 })]);
    expect(stichtag.payables).toEqual([expect.objectContaining({ id: beleg, gross: 29_750, open: 29_750 })]);
    // Die Voranmeldungen der anderen Fälle stehen in derselben Datenbank; geprüft wird der Posten 11/2025
    const ustStichtag = await zahlung.ustvaPosten(undefined, { bis: "2025-12-31" });
    expect(ustStichtag.posten.find((p) => p.month === 11)?.offen).toBe(0);

    // Stand von heute: Rechnung und Beleg sind storniert, die USt-Zahlung ist wieder offen
    const heute = await reports.openPositions("2026-03-01");
    expect(heute.receivables).toEqual([]);
    expect(heute.payables).toEqual([]);
    expect((await zahlung.ustvaPosten()).posten.find((p) => p.month === 11)?.offen).toBe(ust.kz83);
  }, 60_000);

  it("zählt eine Zahlung am 01.01. nicht zum Stand 31.12.", async () => {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Alpenblick Media AG",
      strasse: "Sonnenstraße 12",
      plz: "80331",
      ort: "München",
      land: "DE",
      email: "buchhaltung@alpenblick.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate: "2025-12-20",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung Dezember", quantity: 1000, unit: "Psch.", unitPrice: 50_000, taxRate: 1900 }],
    });
    const invoice = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    // Ein Tag nach dem Stichtag bezahlt: am 31.12.2025 war der Posten noch vollständig offen
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([row("01.01.26", "Alpenblick Media AG", `RE ${invoice.number}`, "595,00")]), filename: "neujahr.csv" },
      null,
    );
    const [tx] = await sql`select id from bank_transactions where amount = 59500`;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id as string, invoiceId: invoice.id, amount: 59_500 });

    const stichtag = await reports.openPositions("2025-12-31", { bis: "2025-12-31" });
    expect(stichtag.receivables).toEqual([expect.objectContaining({ id: invoice.id, gross: 59_500, open: 59_500 })]);

    // Im heutigen Stand ist die Rechnung bezahlt und damit nicht mehr offen
    const heute = await reports.openPositions("2026-11-16");
    expect(heute.receivables.find((posten) => posten.id === invoice.id)).toBeUndefined();
  });

  it("zeigt bei einer Berichtigung den berichtigten Betrag und die Differenz nicht vor ihrer Abgabe fällig", async () => {
    const pdf = { bytes: new TextEncoder().encode("%PDF-1.4\n% et1220251212\n%%EOF\n"), filename: "UStVA_2025-12.pdf" };
    // Dezember 2025: 1.000,00 € zu 19 %, abgegeben am 05.01.2026 (gesetzlich fällig 10.01.2026)
    const dezember = { mode: "manuell" as const, kz81: 100_000, kz86: 0, kz66: 0, reason: "Werte laut Steuerberatung" };
    const erst = await vat.saveDraft(actor, { year: 2025, month: 12 }, dezember);
    await vermerk.vermerkeAbgabe(actor, erst.id, { filedOn: "2026-01-05", transferTicket: "et1220251212", kz83: erst.kz83, file: pdf }, "2026-01-05");

    // Im Februar berichtigt: 1.200,00 € zu 19 %, also 228,00 € Steuer und 38,00 € Differenz
    await vat.createCorrection(actor, { year: 2025, month: 12 });
    const berichtigt = await vat.saveDraft(
      actor,
      { year: 2025, month: 12 },
      { mode: "manuell", kz81: 120_000, kz86: 0, kz66: 0, reason: "Berichtigung nach Prüfung der Belege" },
    );
    expect(berichtigt.kz83).toBe(22_800);
    await vermerk.vermerkeAbgabe(
      actor,
      berichtigt.id,
      { filedOn: "2026-02-05", transferTicket: "et1220251213", kz83: berichtigt.kz83, file: pdf },
      "2026-02-05",
    );

    // Zum 31.12. steht die Steuer in der berichtigten Höhe, obwohl die Berichtigung erst im Februar kam
    const stand = await zahlung.ustvaPosten(undefined, { bis: "2025-12-31" });
    const dezemberPosten = stand.posten.filter((posten) => posten.year === 2025 && posten.month === 12);
    expect(dezemberPosten.reduce((summe, posten) => summe + posten.betrag, 0)).toBe(22_800);
    // Die Differenz ist nicht vor der Abgabe der Berichtigung fällig; weil die Abgabe nach dem gesetzlichen Termin
    // des Zeitraums (10.01.2026) liegt, zeigt der Stand sie mit dem Abgabetag
    const differenz = dezemberPosten.find((posten) => posten.berichtigt);
    expect(differenz?.betrag).toBe(3_800);
    expect(differenz?.faellig).toBe("2026-02-05");
  });

  it("nimmt einen Beleg aus dem Stand, dessen Storno zurückdatiert ist", async () => {
    const beleg = await bookedDocument(4, { supplierName: "Nordlicht Papier GmbH", documentDate: "2025-12-10", net: 25_000, tax: 4_750 });

    // Im Februar 2026 erfasst, der Dezember ist noch nicht gemeldet: die Gegenbuchung geht auf die Belegbuchung
    // vom 10.12.2025, im Journal steht der Storno damit im Dezember
    await cancellation.cancelDocument(actor, beleg, { reason: "Doppelt erfasst" }, "2026-02-15");

    const stichtag = await reports.openPositions("2025-12-31", { bis: "2025-12-31" });
    expect(stichtag.payables).toEqual([]);
  });

  it("zeigt eine Voranmeldung aus dem Altbestand offen, deren Zahlung mit Bezug erst nach dem Stichtag kam", async () => {
    // Vor dem Update gesendet (vat_items_since): ein Posten nur mit Zahlung mit Bezug. Dass es sie gibt, weiß Haben
    // unabhängig vom Stichtag; am 31.12.2024 war die Dezember-Steuer entstanden und noch nicht bezahlt.
    const [alt] = await sql`insert into vat_returns (year, month, status, source, kz81, kz83, transfer_ticket, sent_at, locked_at)
      values (2024, 12, 'sent', 'manuell', 100000, 19000, 'etALT202412', '2025-01-09T10:00:00Z', '2025-01-09T10:00:00Z') returning id`;
    await bank.importStatement(actor, { bytes: dkbCsv([row("10.02.25", "Finanzamt Regensburg", "USt 12/24", "-190,00")]), filename: "alt.csv" }, null);
    const [ustZahlung] = await sql`select id from bank_transactions where amount = -19_000`;
    await bank.allocate(actor, { kind: "ustva", transactionId: ustZahlung!.id as string, vatReturnId: alt!.id as string, amount: -19_000 });

    expect((await zahlung.ustvaPosten()).posten.map((p) => [p.vatReturnId, p.offen])).toEqual([[alt!.id, 0]]);
    const stand = await zahlung.ustvaPosten(undefined, { bis: "2024-12-31" });
    expect(stand.posten.map((p) => [p.vatReturnId, p.offen])).toEqual([[alt!.id, 19_000]]);
  });

  /** Altbestand Dezember 2024 (190,00 €, vor vat_items_since gesendet), am `zahlung` (TT.MM.JJ) mit 10,00 € angezahlt, Bezug aufgehoben am `aufhebung` */
  async function altbestandMitAufhebung(zahlung: string, aufhebung: string) {
    const [alt] = await sql`insert into vat_returns (year, month, status, source, kz81, kz83, transfer_ticket, sent_at, locked_at)
      values (2024, 12, 'sent', 'manuell', 100000, 19000, 'etALT202412', '2025-01-09T10:00:00Z', '2025-01-09T10:00:00Z') returning id`;
    await bank.importStatement(actor, { bytes: dkbCsv([row(zahlung, "Finanzamt Regensburg", "USt 12/24", "-10,00")]), filename: "anzahlung.csv" }, null);
    const [ustZahlung] = await sql`select id from bank_transactions where amount = -1_000`;
    await bank.allocate(actor, { kind: "ustva", transactionId: ustZahlung!.id as string, vatReturnId: alt!.id as string, amount: -1_000 });
    const [zuordnung] = await sql`select id from allocations where vat_return_id = ${alt!.id as string}`;
    await bank.reverseAllocation(actor, zuordnung!.id as string, aufhebung);
    return alt!.id as string;
  }

  it("lässt eine Voranmeldung aus dem Altbestand im Stand, deren Bezug erst nach dem Stichtag aufgehoben wurde (#1323)", async () => {
    const alt = await altbestandMitAufhebung("20.12.24", "2026-02-20");

    // Am 31.12.2024 waren 10,00 € bezahlt und 180,00 € offen; die Aufhebung vom Februar 2026 ändert den Stand nicht
    const stand = await zahlung.ustvaPosten(undefined, { bis: "2024-12-31" });
    expect(stand.posten.map((p) => [p.vatReturnId, p.bezahlt, p.offen])).toEqual([[alt, 1_000, 18_000]]);
    // Heute fehlt der Bezug, der Altbestand ist kein Posten mehr
    expect((await zahlung.ustvaPosten()).posten).toEqual([]);
  });

  it("nimmt eine Voranmeldung aus dem Altbestand aus dem Stand, deren Bezug schon vor dem Stichtag aufgehoben wurde", async () => {
    // Kontenrahmen und Versteuerung ändern den Weg nicht; SKR04 und Soll, damit beide einmal vorkommen
    await sql`update company set kontenrahmen = 'SKR04', versteuerung = 'soll'`;
    await altbestandMitAufhebung("20.12.24", "2024-12-28");

    expect((await zahlung.ustvaPosten(undefined, { bis: "2024-12-31" })).posten).toEqual([]);
  });

  it("lässt eine Voranmeldung aus dem Altbestand offen im Stand, deren Zahlung mit Bezug und Aufhebung beide nach dem Stichtag liegen", async () => {
    // Die Zahlung nach dem Stichtag macht die Voranmeldung zum Posten, die spätere Aufhebung zählt zum Stichtag nicht
    // (Vorgabe im Issue #1323); am 31.12.2024 war die Steuer entstanden und nichts bezahlt
    const alt = await altbestandMitAufhebung("10.02.25", "2025-03-01");

    const stand = await zahlung.ustvaPosten(undefined, { bis: "2024-12-31" });
    expect(stand.posten.map((p) => [p.vatReturnId, p.offen])).toEqual([[alt, 19_000]]);
    // Zum 31.12.2025 war der Bezug schon aufgehoben
    expect((await zahlung.ustvaPosten(undefined, { bis: "2025-12-31" })).posten).toEqual([]);
  });
});
