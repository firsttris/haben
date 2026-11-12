import { ACCOUNTS, invoicePosting, totalsFromTaxes } from "@haben/core";
import { datevAccountTotals, parseDatevBuchungsstapel } from "@haben/import";
import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** #622: Die Anforderung einer Anzahlung ist bei Soll noch kein ausgeführter Umsatz (§ 13 Abs. 1 Nr. 1 a UStG). */
describe.skipIf(!testDatabaseUrl)("Anzahlung vor Leistung (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let contactId: string;
  const actor = "anzahlung-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    bank = await import("../bank/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    reports = await import("../auswertungen/index.ts");
    contacts = await import("../stammdaten/index.ts");
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    // Jede Probe beginnt mit einem leeren Bestand samt dessen Siegeln und Kette. Sonst blieben nach CASCADE die
    // Siegel gelöschter Fixture-Belege zurück und die Integritätsprüfung meldete zu Recht fehlende Datensätze.
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries, bank_accounts, cash_entries cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, bundesland, iban, kontenrahmen, versteuerung, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '0941 1', '198/113/10010',
      'BY', 'DE89370400440532013000', 'SKR03', 'soll', 2026)`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
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
      })
    ).id;
  });

  async function advance(rate: 1900 | 700 = 1900) {
    const input = {
      contactId,
      issueDate: "2026-12-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd" as const,
      note: "",
      variant: "abschlag" as const,
      advanceType: "anzahlung" as const,
      lines: [{ description: "Anzahlung vor Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 30_000, taxRate: rate }],
    };
    return invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input)).id);
  }

  async function tax(year: number, month: number, base: number, amount: number, rate: 1900 | 700 = 1900) {
    expect(await vat.computeVatFigures({ year, month })).toMatchObject(rate === 1900 ? { kz81: base, tax81: amount } : { kz86: base, tax86: amount });
    expect((await reports.vatAbgleich({ year, month })).zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);
  }

  it("Soll: Dezember-Anforderung ohne Steuer; Januar-Zahlung mit 300 € Bemessungsgrundlage und 57 € Steuer", async () => {
    const invoice = await advance();
    await tax(2026, 12, 0, 0);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-01-12", amount: 35_700 }, "2027-01-12");
    await tax(2027, 1, 30_000, 5_700);
    await tax(2026, 12, 0, 0);
    const booked = await sql`select l.account, sum(l.credit - l.debit)::int as amount from journal_lines l
      join journal_entries e on e.id = l.entry_id where e.date >= '2027-01-01' group by l.account`;
    expect(booked).toContainEqual({ account: ACCOUNTS.SKR03.ust[1900], amount: 5_700 });
  });

  it("SKR04, 7 %: zwei Teilzahlungen versteuern den Abschlag nur anteilig und insgesamt genau einmal", async () => {
    await sql`update company set kontenrahmen = 'SKR04'`;
    const invoice = await advance(700);
    await tax(2026, 12, 0, 0, 700);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-01-12", amount: 10_700 }, "2027-02-12");
    await tax(2027, 1, 10_000, 700, 700);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-02-12", amount: 21_400 }, "2027-02-12");
    await tax(2027, 2, 20_000, 1_400, 700);
  });

  it("ein nie bezahlter, stornierter Abschlag löst in keinem Monat Umsatzsteuer aus", async () => {
    const invoice = await advance();
    await invoices.cancelInvoice(actor, invoice.id, "2027-01-15");
    await tax(2026, 12, 0, 0);
    await tax(2027, 1, 0, 0);
  });

  it("Ist bleibt bei der Zahlung steuerpflichtig", async () => {
    await sql`update company set versteuerung = 'ist'`;
    const invoice = await advance();
    await tax(2026, 12, 0, 0);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-01-12", amount: 35_700 }, "2027-01-12");
    await tax(2027, 1, 30_000, 5_700);
    const euer = await reports.euerForYear(2027);
    expect(euer.einnahmen.find((r) => r.key === "einnahmenSteuerpflichtig")?.amount).toBe(30_000);
    expect(euer.einnahmen.find((r) => r.key === "vereinnahmteUst")?.amount).toBe(5_700);
    expect((await reports.euerAbgleich(2027)).zeilen.filter((r) => r.journal !== r.quelle)).toEqual([]);
  });

  async function finalInvoice(advanceId: string) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2027-01-20",
      serviceFrom: "2027-01-20",
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "schluss",
      deducts: [advanceId],
      lines: [{ description: "Gesamtleistung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  it("die Schlussrechnung versteuert auch den unbezahlten Abschlag; seine spätere Zahlung entsteht nicht doppelt", async () => {
    const invoice = await advance();
    const final = await finalInvoice(invoice.id);
    expect(final).toMatchObject({ net: 70_000, tax: 13_300, gross: 83_300 });
    await tax(2026, 12, 0, 0);
    await tax(2027, 1, 100_000, 19_000);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-02-12", amount: 35_700 }, "2027-02-12");
    await tax(2027, 2, 0, 0);
    await tax(2027, 1, 100_000, 19_000);
  });

  it("eine erst nach der Schlussrechnung zugeordnete Dezemberzahlung verschiebt ihren Steueranteil korrekt zurück", async () => {
    const invoice = await advance();
    await finalInvoice(invoice.id);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-12-12", amount: 11_900 }, "2027-02-12");
    await tax(2026, 12, 10_000, 1_900);
    await tax(2027, 1, 90_000, 17_100);
  });

  it("eine ausdrücklich erbrachte Teilleistung wird bei Soll im Leistungsmonat besteuert", async () => {
    const input = {
      contactId,
      issueDate: "2026-12-01",
      serviceFrom: "2026-11-05",
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd" as const,
      note: "",
      variant: "abschlag" as const,
      advanceType: "teilleistung" as const,
      lines: [{ description: "Abgenommene Teilleistung", quantity: 1000, unit: "Psch." as const, unitPrice: 30_000, taxRate: 1900 as const }],
    };
    await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input)).id);
    await tax(2026, 11, 30_000, 5_700);
    await tax(2026, 12, 0, 0);
  });

  it("Zufluss bleibt in der EÜR im Zahlungsjahr, DATEV exportiert dieselben Kontensalden ohne zweite Kassenbewegung", async () => {
    const invoice = await advance();
    await finalInvoice(invoice.id);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-02-12", amount: 35_700 }, "2027-02-12");
    for (const year of [2026, 2027]) {
      const euer = await reports.euerForYear(year);
      expect(euer.einnahmen.find((r) => r.key === "einnahmenSteuerpflichtig")?.amount).toBe(year === 2026 ? 0 : 30_000);
      expect(euer.einnahmen.find((r) => r.key === "vereinnahmteUst")?.amount).toBe(year === 2026 ? 0 : 5_700);
      expect((await reports.euerAbgleich(year)).zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);
    }
    expect((await bank.cashBook(2027)).entries).toHaveLength(1);
    await reports.saveDatevNumbers(actor, { beraterNr: "12345", mandantNr: "123" });
    for (const year of [2026, 2027]) {
      const { bytes } = await reports.datevExport(year);
      const exported = datevAccountTotals(parseDatevBuchungsstapel(bytes).bookings);
      const journal = await sql`select l.account, sum(l.debit)::int as debit, sum(l.credit)::int as credit from journal_lines l
        join journal_entries e on e.id = l.entry_id where e.date >= ${`${year}-01-01`} and e.date < ${`${year + 1}-01-01`} group by l.account`;
      for (const row of journal) {
        const actual = exported.find((r) => r.account === row.account);
        expect((actual?.credit ?? 0) - (actual?.debit ?? 0), `DATEV ${year} ${row.account}`).toBe(row.credit - row.debit);
      }
    }
  });

  it("das Storno der Schlussrechnung lässt die Steuer auf eine vereinnahmte Teilzahlung stehen", async () => {
    const invoice = await advance();
    const final = await finalInvoice(invoice.id);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-02-12", amount: 11_900 }, "2027-02-12");
    await invoices.cancelInvoice(actor, final.id, "2027-03-12");
    await tax(2027, 1, 100_000, 19_000);
    await tax(2027, 2, 0, 0);
    await tax(2027, 3, -90_000, -17_100);
  });

  it("eine Gegenzeile der Teilzahlung nach der Schlussleistung nimmt deren Steuer nicht zurück", async () => {
    const invoice = await advance();
    const payment = await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-12-12", amount: 11_900 }, "2027-02-12");
    await finalInvoice(invoice.id);
    await bank.reverseCashEntry(actor, payment.id, "2027-02-12");
    await tax(2026, 12, 10_000, 1_900);
    await tax(2027, 1, 90_000, 17_100);
    await tax(2027, 2, 0, 0);
  });

  it("GmbH und SKR04: die Forderungsminderung nach Schlussleistung mindert die nun fällige Steuer", async () => {
    await sql`update company set rechtsform = 'gmbh', name = 'Test GmbH', kontenrahmen = 'SKR04'`;
    const invoice = await advance();
    await finalInvoice(invoice.id);
    await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: invoice.id, date: "2027-02-12", amount: 11_900 });
    await tax(2027, 1, 100_000, 19_000);
    await tax(2027, 2, -10_000, -1_900);
  });

  it("bereits festgeschriebene Abschläge ohne neue Angabe bleiben im Rechnungsmonat; neue Angaben sind gesiegelt", async () => {
    const old = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-12-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "abschlag",
      lines: [{ description: "Vorhandener Abschlag", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 1900 }],
    });
    // Bereits vor dem Update festgeschriebener Soll-Abschlag. Die normalen Siegel- und Audit-Trigger bleiben aktiv.
    const { withActor } = await import("../../db/actor.ts");
    const { schema } = await import("../../db/index.ts");
    const { openBooks, post } = await import("../buchhaltung/index.ts");
    const final = await withActor(actor, async (tx) => {
      const [locked] = await tx
        .update(schema.invoices)
        .set({
          advanceType: null,
          status: "final",
          number: "ALT-2026-001",
          lockedAt: new Date(),
          net: 30_000,
          tax: 5_700,
          gross: 35_700,
          pdf: Buffer.from("%PDF Altbestand"),
        })
        .where(eq(schema.invoices.id, old.id))
        .returning();
      await post(tx, await openBooks(tx), {
        date: "2026-12-01",
        description: "Vorhandener Soll-Abschlag",
        sourceType: "invoice",
        sourceId: old.id,
        lines: invoicePosting(totalsFromTaxes([{ rate: 1900, base: 30_000, tax: 5_700 }]), "SKR03", "soll"),
      });
      return locked!;
    });
    const snapshot = await sql`select * from invoices where id = ${final.id}`;
    await tax(2026, 12, 30_000, 5_700);
    await bank.createCashInvoiceEntry(actor, { invoiceId: final.id, date: "2027-01-12", amount: 35_700 }, "2027-01-12");
    await tax(2027, 1, 0, 0);
    expect(await sql`select * from invoices where id = ${final.id}`).toEqual(snapshot);
    const [seal] = await sql`select columns from seals where table_name = 'invoices' and row_id = ${final.id}`;
    expect(seal!.columns.invoices).toContain("advance_type");
    await expect(sql`update invoices set advance_type = 'anzahlung' where id = ${final.id}`).rejects.toThrow(/festgeschrieben/);
  });

  it("ein unverändert übernommener Abschlagsentwurf erhält erst beim jetzigen Festschreiben die neue Anzahlungsvorgabe", async () => {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-12-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "abschlag",
      lines: [{ description: "Alter Entwurf", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 1900 }],
    });
    await sql`update invoices set advance_type = null where id = ${draft.id}`;
    const invoice = await invoices.finalizeInvoice(actor, draft.id);
    expect(invoice.advanceType).toBe("anzahlung");
    await tax(2026, 12, 0, 0);
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-01-12", amount: 35_700 }, "2027-01-12");
    await tax(2027, 1, 30_000, 5_700);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("eine angeblich erbrachte Teilleistung ohne Datum oder mit künftigem Datum wird nicht festgeschrieben", async () => {
    const input = {
      contactId,
      issueDate: "2026-12-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd" as const,
      note: "",
      variant: "abschlag" as const,
      advanceType: "teilleistung" as const,
      lines: [{ description: "Teilleistung", quantity: 1000, unit: "Psch." as const, unitPrice: 30_000, taxRate: 1900 as const }],
    };
    const draft = await invoices.createDraft(actor, input);
    await expect(invoices.finalizeInvoice(actor, draft.id)).rejects.toThrow(/Leistungsdatum/);
    await invoices.updateDraft(actor, draft.id, { ...input, serviceFrom: "2027-01-05" });
    await expect(invoices.finalizeInvoice(actor, draft.id)).rejects.toThrow(/noch nicht erbracht/);
    expect((await invoices.getInvoice(draft.id))!.invoice.number).toBeNull();
  });

  it("Bankzuordnung und ihre Aufhebung verändern die Steuer genau um den zugeordneten Anteil", async () => {
    const invoice = await advance();
    const header = `"Girokonto";"DE89370400440532013000"\n\n`;
    const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
    const row = `"12.01.27";"12.01.27";"Gebucht";"Nordwerk";"Testfirma";"${invoice.number}";"Eingang";"DE02120300000000202051";"119,00";"";"";""\n`;
    await bank.importStatement(actor, { filename: "zahlung.csv", bytes: new TextEncoder().encode(header + columns + row) }, null);
    const [transaction] = await sql`select id from bank_transactions`;
    await bank.allocate(actor, { kind: "invoice", invoiceId: invoice.id, transactionId: transaction!.id, amount: 11_900 });
    await tax(2027, 1, 10_000, 1_900);
    const [allocation] = await sql`select id from allocations where invoice_id = ${invoice.id}`;
    await bank.reverseAllocation(actor, allocation!.id);
    await tax(2027, 1, 0, 0);
  });

  it("gleichzeitige Zahlung und Schlussrechnung stellen den Steueranteil genau einmal fällig", async () => {
    const invoice = await advance();
    await Promise.all([
      finalInvoice(invoice.id),
      bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-01-12", amount: 11_900 }, "2027-01-20"),
    ]);
    await tax(2026, 12, 0, 0);
    await tax(2027, 1, 100_000, 19_000);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });
});
