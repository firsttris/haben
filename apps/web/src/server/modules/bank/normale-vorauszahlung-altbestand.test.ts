import { createHash } from "node:crypto";
import { ACCOUNTS, invoicePosting } from "@haben/core";
import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/** Übergangsentscheidung: https://github.com/Speicherstadt/haben/issues/853#issuecomment-6910075659 */
describe.skipIf(!testDatabaseUrl)("Neue Vorauszahlung auf unmarkierte normale Alt-Rechnung (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let accounting: typeof import("../buchhaltung/index.ts");
  let database: typeof import("../../db/index.ts");
  let withActor: typeof import("../../db/actor.ts")["withActor"];
  let contactId: string;
  const actor = "normale-vorauszahlung-altbestand-test";
  const iban = "DE89370400440532013000";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/index.ts");
    accounting = await import("../buchhaltung/index.ts");
    database = await import("../../db/index.ts");
    ({ withActor } = await import("../../db/actor.ts"));
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries,
      allocations, write_offs, bank_transactions, bank_imports, bank_accounts, cash_entries, vat_returns cascade`;
    await sql`insert into company (id, name, rechtsform, strasse, plz, ort, email, telefon, steuernummer, bundesland, iban,
      kontenrahmen, versteuerung)
      values (1, 'Test GmbH', 'gmbh', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '0941 1',
      '198/113/10010', 'BY', ${iban}, 'SKR03', 'soll')`;
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

  async function legacyInvoice() {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-01-30",
      serviceFrom: "2026-01-10",
      serviceTo: "2026-01-20",
      paymentTermDays: 14,
      format: "zugferd",
      note: "Vereinbarte Softwareeinrichtung im angegebenen Zeitraum",
      lines: [{ description: "Softwareeinrichtung", quantity: 1000, unit: "Psch.", unitPrice: 70_000, taxRate: 1900 }],
    });
    // Synthetischer Bestand vor #853: normale Erlösbuchung und versiegeltes Original ohne Marker.
    // Keine nachträgliche Änderung eines finalen Belegs und keine gelockerten Trigger.
    return withActor(actor, async (tx) => {
      const books = await accounting.openBooks(tx);
      const totals = (await invoices.invoiceTotalsById([draft.id], tx)).get(draft.id)!;
      await accounting.post(tx, books, {
        date: draft.issueDate,
        description: "Alte normale Rechnungsbuchung",
        sourceType: "invoice",
        sourceId: draft.id,
        lines: invoicePosting(totals, books.kontenrahmen, books.versteuerung),
      });
      const pdf = Buffer.from("%PDF-1.7\nErfundene alte Normalrechnung\n%%EOF");
      const xml = '<?xml version="1.0"?><AltRechnung>833.00</AltRechnung>';
      const [saved] = await tx
        .update(database.schema.invoices)
        .set({
          status: "final",
          number: "ALT-2026-001",
          lockedAt: new Date(),
          pdf,
          pdfSha256: createHash("sha256").update(pdf).digest("hex"),
          xml,
          xmlSha256: createHash("sha256").update(xml).digest("hex"),
        })
        .where(eq(database.schema.invoices.id, draft.id))
        .returning();
      // Bereits gemeldete Periode als versiegeltes Testfixture, ohne Übermittlung an einen Dienst.
      const [period] = await tx.insert(database.schema.vatReturns).values({ year: 2025, month: 12 }).returning();
      await tx
        .update(database.schema.vatReturns)
        .set({
          status: "sent",
          transferTicket: "ERFUNDEN-853",
          sentAt: new Date(),
          lockedAt: new Date(),
        })
        .where(eq(database.schema.vatReturns.id, period!.id));
      return saved!;
    });
  }

  async function transaction() {
    const csv =
      `"Girokonto";"${iban}"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"13.12.25";"13.12.25";"Gebucht";"Nordwerk Software GmbH";"Test GmbH";"Alte normale Rechnung";"Überweisung";"DE02120300000000202051";"119,00";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: "altzahlung.csv" }, null);
    return (await sql`select id from bank_transactions`)[0]!.id as string;
  }

  async function state() {
    const [row] = await sql`select jsonb_build_object(
      'invoices', (select coalesce(jsonb_agg(t order by t::text), '[]') from invoices t),
      'lines', (select coalesce(jsonb_agg(t order by t::text), '[]') from invoice_lines t),
      'taxes', (select coalesce(jsonb_agg(t order by t::text), '[]') from invoice_taxes t),
      'allocations', (select coalesce(jsonb_agg(t order by t::text), '[]') from allocations t),
      'cash', (select coalesce(jsonb_agg(t order by t::text), '[]') from cash_entries t),
      'journal', (select coalesce(jsonb_agg(t order by t::text), '[]') from journal_entries t),
      'journalLines', (select coalesce(jsonb_agg(t order by t::text), '[]') from journal_lines t),
      'returns', (select coalesce(jsonb_agg(t order by t::text), '[]') from vat_returns t),
      'audit', (select coalesce(jsonb_agg(t order by t::text), '[]') from audit_log t),
      'seals', (select coalesce(jsonb_agg(t order by t::text), '[]') from seals t)
    ) as snapshot`;
    return row!.snapshot;
  }

  it("GmbH/SKR03/Soll: sperrt Bankzuordnung und Split ohne Änderung an Original, Journal, Siegel oder gesendeter Periode", async () => {
    const invoice = await legacyInvoice();
    expect(invoice.advanceAccounting).toBeNull();
    const payment = await transaction();
    const before = await state();
    await expect(bank.allocate(actor, { kind: "invoice", transactionId: payment, invoiceId: invoice.id, amount: 11_900 })).rejects.toThrow(
      /Alt-Rechnung.*Storniere sie.*Leistungszeitraum neu/,
    );
    expect(await state()).toEqual(before);
    await expect(bank.allocateSplit(actor, { transactionId: payment, parts: [{ kind: "invoice", invoiceId: invoice.id, amount: 11_900 }] })).rejects.toThrow(
      /Alt-Rechnung.*Storniere sie.*Leistungszeitraum neu/,
    );
    expect(await state()).toEqual(before);
    expect((await bank.transactionDetail(payment))?.transaction.open).toBe(11_900);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("UG/SKR04/Ist: sperrt Bareinnahme vor Leistung, lässt Zahlung am Leistungsende vor Rechnung und deren Gegenzeile zu", async () => {
    await sql`update company set rechtsform = 'ug', kontenrahmen = 'SKR04', versteuerung = 'ist'`;
    const invoice = await legacyInvoice();
    const before = await state();
    await expect(bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2025-12-13", amount: 11_900 }, "2026-03-01")).rejects.toThrow(
      /Alt-Rechnung.*Storniere sie.*Leistungszeitraum neu/,
    );
    expect(await state()).toEqual(before);
    const cash = await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2026-01-20", amount: 11_900 }, "2026-03-01");
    expect(await bank.reverseCashEntry(actor, cash.id, "2026-01-21")).toMatchObject({ amount: -11_900, reversesId: cash.id });
    const after = await state();
    expect(after.invoices).toEqual(before.invoices);
    expect(after.returns).toEqual(before.returns);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  // Der in der Meldung genannte Weg: Storno der Alt-Rechnung, neue Rechnung mit Leistungszeitraum, Zahlung dorthin.
  it("GmbH/SKR04/Soll: Storno und neue Rechnung mit Leistungszeitraum nehmen die Vorauszahlung im Eingangsmonat auf", async () => {
    await sql`update company set kontenrahmen = 'SKR04'`;
    const vat = await import("../umsatzsteuer/index.ts");
    const reports = await import("../auswertungen/index.ts");
    const legacy = await legacyInvoice();
    const payment = await transaction();
    await invoices.cancelInvoice(actor, legacy.id, "2026-01-31");
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-01-31",
      serviceFrom: "2026-01-10",
      serviceTo: "2026-01-20",
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Softwareeinrichtung", quantity: 1000, unit: "Psch.", unitPrice: 70_000, taxRate: 1900 }],
    });
    const fresh = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    expect(fresh.advanceAccounting).toBe("deferred");
    await bank.allocate(actor, { kind: "invoice", transactionId: payment, invoiceId: fresh.id, amount: 11_900 });
    const month = async (year: number, m: number) => {
      const f = await vat.computeVatFigures({ year, month: m });
      expect((await reports.vatAbgleich({ year, month: m })).zeilen.filter((row) => row.journal !== row.quelle)).toEqual([]);
      return { kz81: f.kz81, tax81: f.tax81 };
    };
    // Gemeldeter Dezember: Die Vorauszahlung ist dort zu berichtigen (§ 13 Abs. 1 Nr. 1 a Satz 4 UStG)
    expect(await month(2025, 12)).toEqual({ kz81: 10_000, tax81: 1_900 });
    expect(await month(2026, 1)).toEqual({ kz81: 60_000, tax81: 11_400 });
    const saldo = async (account: string) =>
      (await accounting.saldenliste({ from: "2025-01-01", to: "2025-12-31" })).find((row) => row.account === account)?.saldo ?? 0;
    // GmbH: der Nettobetrag bis zur Leistung als erhaltene Anzahlung (§ 266 Abs. 3 C.3 HGB)
    expect(await saldo(ACCOUNTS.SKR04.erhalteneAnzahlungen)).toBe(-10_000);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  // Ist ohne Bilanz: Der bisherige Weg ist dort steuerlich schon richtig (§ 13 Abs. 1 Nr. 1 b UStG, § 11 EStG).
  // Entscheidung: https://github.com/Speicherstadt/haben/pull/1228#issuecomment-6925771896
  it("Einzelunternehmen/SKR03/Ist: lässt die Zahlung vor der Leistung auf dem bisherigen Weg zu", async () => {
    await sql`update company set rechtsform = 'einzelunternehmen', versteuerung = 'ist'`;
    const invoice = await legacyInvoice();
    const payment = await transaction();
    await bank.allocate(actor, { kind: "invoice", transactionId: payment, invoiceId: invoice.id, amount: 11_900 });
    expect((await bank.transactionDetail(payment))?.transaction.open).toBe(0);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });
});
