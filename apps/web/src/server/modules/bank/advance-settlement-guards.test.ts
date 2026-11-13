import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/**
 * #750: Keine Forderung vor Leistung und keine Vorauszahlung auf den Schlussrest neuer Bilanzketten.
 * Quelle: https://github.com/firsttris/haben/issues/750#issuecomment-6850907108
 */
describe.skipIf(!testDatabaseUrl)("Sperren vor der Schlussleistung (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let database: typeof import("../../db/index.ts");
  let withActor: typeof import("../../db/actor.ts")["withActor"];
  let accounting: typeof import("../buchhaltung/index.ts");
  let contactId: string;
  const actor = "advance-settlement-guards-test";
  const iban = "DE89370400440532013000";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/index.ts");
    database = await import("../../db/index.ts");
    ({ withActor } = await import("../../db/actor.ts"));
    accounting = await import("../buchhaltung/index.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries,
      allocations, write_offs, bank_transactions, bank_imports, bank_accounts, cash_entries cascade`;
    await sql`insert into company (id, name, rechtsform, strasse, plz, ort, email, telefon, steuernummer, bundesland, iban,
      kontenrahmen, versteuerung, journal_ab)
      values (1, 'Test GmbH', 'gmbh', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '0941 1',
      '198/113/10010', 'BY', ${iban}, 'SKR03', 'soll', 2026)`;
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

  /** Derselbe Kontoauszugimport wie im Bankabgleich; keine vorbereiteten Zuordnungen. */
  async function transaction(date: string, purpose: string, amount: string) {
    const csv =
      `"Girokonto";"${iban}"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${date}";"${date}";"Gebucht";"Nordwerk Software GmbH";"Test GmbH";"${purpose}";"Überweisung";"DE02120300000000202051";"${amount}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `${purpose}.csv` }, null);
    return (await sql`select id from bank_transactions where purpose = ${purpose}`)[0]!.id as string;
  }

  async function advance(legacy = false) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-12-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "abschlag",
      advanceType: "anzahlung",
      lines: [{ description: "Anzahlung vor Leistung", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 1900 }],
    });
    if (!legacy) return invoices.finalizeInvoice(actor, draft.id);
    // Prä-0223-Altbestand wie in anzahlung-bilanz-transition.test.ts: Forderung und Erlös sind bereits gebucht.
    return withActor(actor, async (tx) => {
      await accounting.post(tx, await accounting.openBooks(tx), {
        date: "2026-12-01",
        description: "Alte Anforderung mit bereits realisiertem Erlös",
        sourceType: "invoice",
        sourceId: draft.id,
        lines: [
          { account: "1400", debit: 35_700, credit: 0, taxCode: null },
          { account: "8400", debit: 0, credit: 30_000, taxCode: "USt19" },
          { account: "1766", debit: 0, credit: 5700, taxCode: "USt19" },
        ],
      });
      const [old] = await tx
        .update(database.schema.invoices)
        .set({ status: "final", number: `ALT-${draft.id}`, lockedAt: new Date() })
        .where(eq(database.schema.invoices.id, draft.id))
        .returning();
      return old!;
    });
  }

  async function finalDraft(advanceId: string, unitPrice = 100_000, issueDate = "2027-01-20") {
    return invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: "2027-01-10",
      serviceTo: "2027-01-20",
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "schluss",
      deducts: [advanceId],
      lines: [{ description: "Gesamtleistung", quantity: 1000, unit: "Psch.", unitPrice, taxRate: 1900 }],
    });
  }

  async function finalInvoice() {
    const request = await advance();
    expect(request).toMatchObject({ advanceAccounting: "deferred", gross: 35_700 });
    const draft = await finalDraft(request.id);
    const final = await invoices.finalizeInvoice(actor, draft.id);
    expect(final).toMatchObject({ advanceAccounting: "deferred", gross: 83_300 });
    return { request, final };
  }

  /** Auch Audit, Siegel, Nummernkreise und gelernte IBAN dürfen nach einem Fehler nicht teilweise fortgeschrieben sein. */
  async function state() {
    const [row] = await sql`select jsonb_build_object(
      'invoices', (select coalesce(jsonb_agg(t order by t::text), '[]') from invoices t),
      'lines', (select coalesce(jsonb_agg(t order by t::text), '[]') from invoice_lines t),
      'taxes', (select coalesce(jsonb_agg(t order by t::text), '[]') from invoice_taxes t),
      'counters', (select coalesce(jsonb_agg(t order by t::text), '[]') from invoice_number_counters t),
      'contacts', (select coalesce(jsonb_agg(t order by t::text), '[]') from contacts t),
      'allocations', (select coalesce(jsonb_agg(t order by t::text), '[]') from allocations t),
      'writeOffs', (select coalesce(jsonb_agg(t order by t::text), '[]') from write_offs t),
      'cash', (select coalesce(jsonb_agg(t order by t::text), '[]') from cash_entries t),
      'journal', (select coalesce(jsonb_agg(t order by t::text), '[]') from journal_entries t),
      'journalLines', (select coalesce(jsonb_agg(t order by t::text), '[]') from journal_lines t),
      'audit', (select coalesce(jsonb_agg(t order by t::text), '[]') from audit_log t),
      'seals', (select coalesce(jsonb_agg(t order by t::text), '[]') from seals t)
    ) as snapshot`;
    return row!.snapshot;
  }

  it("bestätigt: ein Ersatz mit 900 statt 1.000 Euro Gesamtleistung wird beim Finalisieren vollständig zurückgerollt", async () => {
    const { request, final } = await finalInvoice();
    await invoices.cancelInvoice(actor, final.id, "2027-02-12");
    const draft = await finalDraft(request.id, 90_000, "2027-03-12");
    const before = await state();

    await expect(invoices.finalizeInvoice(actor, draft.id)).rejects.toThrow(/Beträge.*Steuersatz/);

    expect(await state()).toEqual(before);
    expect((await invoices.getInvoice(draft.id))?.invoice.status).toBe("draft");
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("GmbH, SKR03, Soll: sperrt Forderungsausfall der unbilanzierten Anforderung mit Hinweis auf Storno und Schlussrechnung", async () => {
    const request = await advance();
    expect(request.advanceAccounting).toBe("deferred");
    expect(await sql`select id from journal_entries`).toEqual([]);
    const before = await state();

    const attempt = bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: request.id, date: "2026-12-12" });
    await expect(attempt).rejects.toThrow(/storn/i);
    await expect(attempt).rejects.toThrow(/Preisnachlass.*Schlussrechnung/i);

    expect(await state()).toEqual(before);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("UG, SKR04, Ist: rollt bei Rest als Forderungsausfall auch die bereits zugeordnete Anzahlung zurück", async () => {
    await sql`update company set rechtsform = 'ug', kontenrahmen = 'SKR04', versteuerung = 'ist'`;
    const request = await advance();
    expect(request.advanceAccounting).toBe("deferred");
    const payment = await transaction("12.12.26", "Teilzahlung mit Ausfall", "119,00");
    const before = await state();

    const attempt = bank.allocateWithRest(actor, {
      transactionId: payment,
      target: { kind: "invoice", invoiceId: request.id },
      rest: "forderungsausfall",
    });
    await expect(attempt).rejects.toThrow(/storn/i);
    await expect(attempt).rejects.toThrow(/Preisnachlass.*Schlussrechnung/i);

    expect(await state()).toEqual(before);
    expect((await bank.transactionDetail(payment))?.transaction.open).toBe(11_900);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("sperrt eine direkte Bankzahlung auf den Schlussrest vor serviceTo und verweist auf eine Abschlagsrechnung", async () => {
    const { final } = await finalInvoice();
    const payment = await transaction("19.01.27", "Schlussrest zu früh", "119,00");
    const before = await state();

    await expect(bank.allocate(actor, { kind: "invoice", transactionId: payment, invoiceId: final.id, amount: 11_900 })).rejects.toThrow(/Abschlagsrechnung/i);

    expect(await state()).toEqual(before);
    expect((await bank.transactionDetail(payment))?.transaction.open).toBe(11_900);
  });

  it("sperrt auch eine Bareinnahme auf den gespeicherten Schlussersatz vor dem ursprünglichen Leistungsdatum", async () => {
    await sql`update company set rechtsform = 'ug', kontenrahmen = 'SKR04', versteuerung = 'ist'`;
    const { request, final } = await finalInvoice();
    await invoices.cancelInvoice(actor, final.id, "2027-02-12");
    const draft = await finalDraft(request.id, 100_000, "2027-03-12");
    const replacement = await invoices.finalizeInvoice(actor, draft.id);
    expect(replacement.replacesInvoiceId).toBe(final.id);
    const before = await state();

    await expect(bank.createCashInvoiceEntry(actor, { invoiceId: replacement.id, date: "2027-01-19", amount: 11_900 }, "2027-03-12")).rejects.toThrow(
      /Abschlagsrechnung/i,
    );

    expect(await state()).toEqual(before);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("rollt einen zuerst zulässigen Splitteil mit zurück, wenn der zweite den Schlussrest vor Leistung bezahlt", async () => {
    const { request, final } = await finalInvoice();
    const payment = await transaction("19.01.27", "Geteilte Vorauszahlung", "238,00");
    const before = await state();

    await expect(
      bank.allocateSplit(actor, {
        transactionId: payment,
        parts: [
          { kind: "invoice", invoiceId: request.id, amount: 11_900 },
          { kind: "invoice", invoiceId: final.id, amount: 11_900 },
        ],
      }),
    ).rejects.toThrow(/Abschlagsrechnung/i);

    expect(await state()).toEqual(before);
    expect((await bank.transactionDetail(payment))?.transaction.open).toBe(23_800);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("lässt Bank- und Barzahlung genau am Leistungsdatum weiterhin zu", async () => {
    const { final } = await finalInvoice();
    const payment = await transaction("20.01.27", "Schlussrest am Leistungstag", "119,00");

    await bank.allocate(actor, { kind: "invoice", transactionId: payment, invoiceId: final.id, amount: 11_900 });
    await bank.createCashInvoiceEntry(actor, { invoiceId: final.id, date: "2027-01-20", amount: 11_900 }, "2027-01-20");

    expect((await bank.transactionDetail(payment))?.transaction.open).toBe(0);
    expect(await sql`select invoice_id, amount from allocations where transaction_id = ${payment}`).toEqual([{ invoice_id: final.id, amount: 11_900 }]);
    expect(await sql`select invoice_id, amount from cash_entries`).toEqual([{ invoice_id: final.id, amount: 11_900 }]);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("lässt Skonto zusammen mit einer echten Bank- oder Baranzahlung vor Leistung weiterhin zu", async () => {
    const bankRequest = await advance();
    const cashRequest = await advance();
    const payment = await transaction("12.12.26", "Anzahlung mit Skonto", "349,86");

    await bank.allocateWithRest(actor, { transactionId: payment, target: { kind: "invoice", invoiceId: bankRequest.id }, rest: "skonto" });
    await bank.createCashInvoiceEntry(actor, { invoiceId: cashRequest.id, date: "2026-12-12", amount: 34_986, skonto: true }, "2026-12-12");

    expect((await bank.transactionDetail(payment))?.transaction.open).toBe(0);
    expect(await sql`select kind, amount from write_offs order by id`).toEqual([
      { kind: "skonto", amount: 714 },
      { kind: "skonto", amount: 714 },
    ]);
    expect(await bank.openItems()).toEqual([]);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  for (const legacy of [false, true]) {
    it(`${legacy ? "gespeicherter GmbH-Altbeleg ohne Verfahrensmarker" : "EÜR"}: kein pauschaler Bann für Ausfall oder frühe Schlusszahlung`, async () => {
      if (!legacy) await sql`update company set rechtsform = 'einzelunternehmen'`;
      const lossRequest = await advance(legacy);
      const request = await advance(legacy);
      expect(request.advanceAccounting).toBeNull();
      const draft = await finalDraft(request.id);
      const final = await invoices.finalizeInvoice(actor, draft.id);
      expect(final.advanceAccounting).toBeNull();
      const payment = await transaction("19.01.27", "Unmarkierter Schlussrest", "119,00");

      await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: lossRequest.id, date: "2026-12-12" });
      await bank.allocate(actor, { kind: "invoice", transactionId: payment, invoiceId: final.id, amount: 11_900 });
      await bank.createCashInvoiceEntry(actor, { invoiceId: final.id, date: "2027-01-19", amount: 11_900 }, "2027-01-20");

      expect((await bank.transactionDetail(payment))?.transaction.open).toBe(0);
      expect((await bank.listWriteOffs({ invoiceId: lossRequest.id })).map(({ kind, amount }) => ({ kind, amount }))).toEqual([
        { kind: "forderungsausfall", amount: 35_700 },
      ]);
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
    });
  }
});
