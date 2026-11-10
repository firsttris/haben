import { JOURNAL_KENNZAHLEN } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Voranmeldung ab dem Stichjahr aus dem Journal (#542, docs/adr/journal-als-quelle.md): Die Kennzahlen kommen aus Konto und
 * Steuerschlüssel der Buchungen, die Privatnutzung von Fahrzeugen aus dem Anlagenverzeichnis; die Nebenbücher sind die
 * Gegenprobe im Abgleich. Vor dem Stichjahr bleibt es bei den Nebenbüchern.
 */

/*
 * Voranmeldung aus dem Journal gleich den Nebenbüchern (Fälle aus Runde 2 des TDD-Reviews von Pull Request #575): Quartal
 * und Jahr, Bareinnahmen, Rechnung vor und Zahlung im Stichjahr, Stornos nach gesendeter Voranmeldung, Belege mit
 * Privatanteil und Skonto, Rechnungskorrektur; und Stornos im Stichjahr von Buchungen aus der Zeit davor, deren Zeilen
 * noch ohne Bemessungsgrundlage (#552) bzw. ohne Steuerschlüssel am privaten Teil (#551) gebucht sind.
 */

/*
 * Stornos im Stichjahr von Buchungen aus der Zeit davor (Fälle aus Runde 3 des TDD-Reviews von Pull Request #575): § 13b
 * ohne Vorsteuerabzug und aufgeteilt, bar bezahlt mit Privatanteil, Bareinnahmen mit Skonto und gemischten Sätzen,
 * Ausbuchung aufheben, Kontenrahmenwechsel, Kleinunternehmer. Voranmeldung und EÜR aus dem Journal gleich den Nebenbüchern.
 */
describe.skipIf(!testDatabaseUrl)("Stornos im Stichjahr von Buchungen aus der Zeit davor (Postgres)", () => {
  let figures: typeof import("./vat-figures.ts");
  let vat: typeof import("./vat.ts");
  let bank: typeof import("../bank/bank.ts");
  let cash: typeof import("../bank/cash-income.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let cancellation: typeof import("../belege/cancellation.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let cashInvoice: typeof import("../bank/cash-invoice.ts");
  let cashBook: typeof import("../bank/cash.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("./vat-figures.ts");
    vat = await import("./vat.ts");
    bank = await import("../bank/bank.ts");
    cash = await import("../bank/cash-income.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    cancellation = await import("../belege/cancellation.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    cashInvoice = await import("../bank/cash-invoice.ts");
    cashBook = await import("../bank/cash.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04", journalAb: number | null = null) {
    await sql`truncate asset_depreciations, assets, vat_return_submissions, vat_returns, write_offs, allocations, bank_transactions,
      bank_imports, bank_accounts, cash_entries, document_cancellations, journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, ${journalAb})`;
  }

  async function invoice(issueDate: string, lines: { unitPrice: number; taxRate: 1900 | 700 | 0 }[], extra: Record<string, unknown> = {}) {
    const contact = await contacts.createContact(actor, {
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
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: lines.map((l, i) => ({ description: `Leistung ${i}`, quantity: 1000, unit: "Psch." as const, unitPrice: l.unitPrice, taxRate: l.taxRate })),
      ...extra,
    } as never);
    return invoices.finalizeInvoice(actor, draft.id);
  }

  const kennzahlen = (f: Awaited<ReturnType<typeof figures.computeVatFigures>>) => Object.fromEntries(JOURNAL_KENNZAHLEN.map((k) => [k, f[k]]));
  async function gleich(periods: { year: number; month: number }[]) {
    for (const p of periods) {
      const f = await figures.computeVatFigures(p);
      expect(f.quelle, JSON.stringify(p)).toBe("journal");
      const abw = abgleich.abweichungen((await abgleich.vatAbgleich(p)).zeilen);
      expect({ p, va: kennzahlen(f), abw }).toEqual({ p, va: f.nebenbuecher, abw: [] });
    }
  }

  async function rcDoc(
    date: string,
    opts: { privateShare?: number; reverseCharge?: string; payment?: string; amounts?: { taxRate: number; net: number; tax: number }[] },
  ) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 21]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `r${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant EU",
      supplierUstId: "ATU12345678",
      invoiceNumber: `X${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: "edv",
      payment: opts.payment ?? "privat",
      note: "",
      amounts: opts.amounts ?? [{ taxRate: 1900, net: 100_000, tax: 19_000 }],
      privateShare: opts.privateShare ?? 0,
      reverseCharge: opts.reverseCharge ?? "eu",
    } as never);
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Wie vor #551: ohne Vorsteuerabzug Netto und Steuer in einer Zeile mit dem RC-Schlüssel; privater Teil zusammen ohne Schlüssel */
  async function vor551(docId: string) {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      const [e] = await tx`select id from journal_entries where source_type = 'document' and source_id = ${docId} and reverses_id is null`;
      const lines = await tx`select id, account, debit, credit, tax_code from journal_lines where entry_id = ${e!.id} order by id`;
      // keineVSt neben RC-Zeile auf demselben Konto zusammenlegen
      for (const k of lines.filter((l) => l.tax_code === "keineVSt")) {
        const rc = lines.find((l) => l.account === k.account && l.tax_code && l.tax_code !== "keineVSt" && l.id !== k.id);
        if (!rc) continue;
        await tx`update journal_lines set debit = debit + ${k.debit}, credit = credit + ${k.credit} where id = ${rc.id}`;
        await tx`delete from journal_lines where id = ${k.id}`;
      }
    });
  }

  async function sendVa(month: number, year = 2025) {
    const draft = await vat.saveDraft(actor, { year, month }, { mode: "berechnet" });
    await sql`update vat_returns set status = 'sent', sent_at = now() where id = ${draft.id}`;
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`Kleinunternehmer: Storno im Stichjahr eines § 13b-Belegs ohne Vorsteuerabzug (Buchung vor #551) (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen, 2026);
      await sql`update company set kleinunternehmer = true`;
      const id = await rcDoc("2025-12-05", {});
      await vor551(id);
      await sendVa(12);
      await cancellation.cancelDocument(actor, id, { reason: "x" } as never, "2026-01-15");
      const jan = await figures.computeVatFigures({ year: 2026, month: 1 });
      expect(jan.quelle).toBe("journal");
      expect(jan.kz46).toBe(-100_000);
      expect(kennzahlen(jan)).toEqual(jan.nebenbuecher);
    }, 60_000);

    it(`EÜR im Stichjahr: Storno eines § 13b-Belegs ohne Vorsteuerabzug (Buchung vor #551) (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen, 2026);
      await sql`update company set kleinunternehmer = true`;
      const id = await rcDoc("2025-12-05", {});
      await vor551(id);
      await sendVa(12);
      await cancellation.cancelDocument(actor, id, { reason: "x" } as never, "2026-01-15");
      expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
    }, 60_000);

    it(`Kleinunternehmer: aufgeteilter § 13b-Beleg (Drittland) aus dem Vorjahr (Buchung vor #551), Storno im Stichjahr (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen, 2026);
      await sql`update company set kleinunternehmer = true`;
      docSeq++;
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 31]);
      const { id } = await documents.uploadDocument(actor, { bytes, filename: `s${docSeq}.jpg` });
      await documents.updateDocument(actor, id, {
        supplierName: "Payments Inc.",
        supplierUstId: "",
        invoiceNumber: `S${docSeq}`,
        documentDate: "2025-12-05",
        dueDate: null,
        category: "sonstiges",
        payment: "privat",
        note: "",
        privateShare: 0,
        reverseCharge: "drittland",
        amounts: [{ taxRate: 1900, net: 25_000, tax: 4_750 }],
        splits: [
          { category: "geldverkehr", taxRate: 1900, net: 13_333 },
          { category: "fremdleistung", taxRate: 1900, net: 6_667 },
          { category: "werbung", taxRate: 1900, net: 5_000 },
        ],
      } as never);
      const net = 25_000;
      await documents.bookDocument(actor, id);
      await vor551(id);
      await sendVa(12);
      await cancellation.cancelDocument(actor, id, { reason: "x" } as never, "2026-01-15");
      const jan = await figures.computeVatFigures({ year: 2026, month: 1 });
      expect(jan.kz84).toBe(-net);
      expect(kennzahlen(jan)).toEqual(jan.nebenbuecher);
      expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
    }, 60_000);

    it(`Bar bezahlter § 13b-Beleg mit Privatanteil (Buchung vor #551), Storno im Stichjahr (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen, 2026);
      await cash.createCashIncome(
        actor,
        { date: "2025-11-01", amount: 300_000, text: "Markt", steuer: { behandlung: "regulaer", steuersatz: 1900 } },
        "2026-11-10",
      );
      const id = await rcDoc("2025-12-05", { privateShare: 30, payment: "kasse" });
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update journal_lines set tax_code = null where tax_code = 'RC13bEU' and entry_id in
          (select id from journal_entries where source_type = 'document' and source_id = ${id})
          and account not in (select account from journal_lines where tax_code = 'RC13bEU' order by debit desc limit 1)`;
      });
      await cancellation.cancelDocument(actor, id, { reason: "x" } as never, "2026-01-15");
      const jan = await figures.computeVatFigures({ year: 2026, month: 1 });
      expect(jan.kz46).toBe(-100_000);
      expect(kennzahlen(jan)).toEqual(jan.nebenbuecher);
    }, 60_000);

    it(`Ist: Storno im Stichjahr einer Bareinnahme mit Skonto aus dem Vorjahr (ohne Bemessungsgrundlage) (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen, 2026);
      const inv = await invoice("2025-12-10", [
        { unitPrice: 10_000, taxRate: 1900 },
        { unitPrice: 5_000, taxRate: 700 },
      ]);
      const entry = await cashInvoice.createCashInvoiceEntry(
        actor,
        { invoiceId: inv.id, date: "2025-12-20", amount: 160_00, skonto: true } as never,
        "2026-11-10",
      );
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update journal_lines set basis = null where entry_id = ${entry.journalEntryId}`;
      });
      await cashBook.reverseCashEntry(actor, entry.id, "2026-01-10");
      await gleich([{ year: 2026, month: 1 }]);
    }, 60_000);

    it(`Ist: Storno im Stichjahr einer Bareinnahme 19/0 % aus dem Vorjahr (ohne Bemessungsgrundlage, Forderung ohne Schlüssel) (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen, 2026);
      const inv = await invoice("2025-12-10", [
        { unitPrice: 10_000, taxRate: 1900 },
        { unitPrice: 5_000, taxRate: 0 },
      ]);
      const entry = await cashInvoice.createCashInvoiceEntry(actor, { invoiceId: inv.id, date: "2025-12-20", amount: inv.gross } as never, "2026-11-10");
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update journal_lines set basis = null, tax_code = case when debit = 0 and credit = 0 then tax_code when tax_code in ('frei','Steuerfrei','Ausfuhr') then null else tax_code end where entry_id = ${entry.journalEntryId}`;
        await tx`delete from journal_lines where entry_id = ${entry.journalEntryId} and debit = 0 and credit = 0`;
      });
      await cashBook.reverseCashEntry(actor, entry.id, "2026-01-10");
      await gleich([{ year: 2026, month: 1 }]);
    }, 60_000);

    it(`Soll: Ausbuchung (Forderungsausfall) aus dem Vorjahr im Stichjahr aufheben (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen, 2026);
      const inv = await invoice("2025-11-10", [{ unitPrice: 10_000, taxRate: 1900 }]);
      await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: inv.id, date: "2025-12-20" } as never);
      await bank.reverseWriteOff(actor, (await sql`select id from write_offs`)[0]!.id, "2026-02-10");
      await gleich([{ year: 2026, month: 2 }]);
      expect((await figures.computeVatFigures({ year: 2026, month: 2 })).kz81).toBe(10_000);
    }, 60_000);

    it(`Ist: Ausbuchung (Forderungsausfall) aus dem Vorjahr im Stichjahr aufheben (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen, 2026);
      const inv = await invoice("2025-11-10", [{ unitPrice: 10_000, taxRate: 1900 }]);
      await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: inv.id, date: "2025-12-20" } as never);
      await bank.reverseWriteOff(actor, (await sql`select id from write_offs`)[0]!.id, "2026-02-10");
      await gleich([{ year: 2026, month: 2 }]);
    }, 60_000);
  }

  it("Kontenrahmenwechsel zum Stichjahr: Storno einer Bareinnahme (Ist, ohne Bemessungsgrundlage) aus dem Vorjahr", async () => {
    await reset("ist", "SKR03", 2026);
    const inv = await invoice("2025-12-10", [{ unitPrice: 10_000, taxRate: 1900 }]);
    const entry = await cashInvoice.createCashInvoiceEntry(actor, { invoiceId: inv.id, date: "2025-12-20", amount: 119_00 } as never, "2026-11-10");
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update journal_lines set basis = null where entry_id = ${entry.journalEntryId}`;
    });
    await sql`update company set kontenrahmen = 'SKR04'`;
    await cashBook.reverseCashEntry(actor, entry.id, "2026-01-10");
    const jan = await figures.computeVatFigures({ year: 2026, month: 1 });
    expect({ kz81: jan.kz81, tax81: jan.tax81 }).toEqual({ kz81: -10_000, tax81: -1_900 });
    expect(kennzahlen(jan)).toEqual(jan.nebenbuecher);
  }, 60_000);

  it("Kleinunternehmer-Rechnung bar kassiert im Vorjahr, Storno im Stichjahr (Ist)", async () => {
    await reset("ist", "SKR03", 2026);
    await sql`update company set kleinunternehmer = true`;
    const inv = await invoice("2025-12-10", [{ unitPrice: 10_000, taxRate: 0 }], { taxTreatment: "kleinunternehmer" });
    const entry = await cashInvoice.createCashInvoiceEntry(actor, { invoiceId: inv.id, date: "2025-12-20", amount: inv.gross } as never, "2026-11-10");
    await cashBook.reverseCashEntry(actor, entry.id, "2026-01-10");
    await gleich([{ year: 2026, month: 1 }]);
  }, 60_000);
  it("Nimmt die heutige Buchungslogik einen alten Beleg nicht mehr an, storniert Haben die gebuchten Zeilen", async () => {
    await reset("soll", "SKR03", 2026);
    const id = await rcDoc("2025-12-05", { reverseCharge: "eu" });
    // Eine Angabe, mit der die heutige Buchung nicht mehr rechnen kann (hier: eine Kategorie, die es nicht mehr gibt)
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update documents set category = 'gibt-es-nicht' where id = ${id}`;
    });
    await sendVa(12);
    await cancellation.cancelDocument(actor, id, { reason: "Falscher Lieferant" } as never, "2026-01-15");
    const [storno] = await sql`select count(*)::int as n from journal_entries where source_type = 'document' and source_id = ${id} and reverses_id is not null`;
    expect(storno!.n).toBe(1);
    expect((await figures.computeVatFigures({ year: 2026, month: 1 })).kz46).toBe(-100_000);
  }, 60_000);
});
