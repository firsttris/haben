import { JOURNAL_KENNZAHLEN } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Voranmeldung ab dem Stichjahr aus dem Journal (#542, docs/adr/journal-als-quelle.md): Die Kennzahlen kommen aus Konto und
 * Steuerschlüssel der Buchungen, die Privatnutzung von Fahrzeugen aus dem Anlagenverzeichnis; die Nebenbücher sind die
 * Gegenprobe im Abgleich. Vor dem Stichjahr bleibt es bei den Nebenbüchern.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}
const incoming = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Testfirma",
  purpose,
  "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

/*
 * Voranmeldung aus dem Journal gleich den Nebenbüchern (Fälle aus Runde 2 des TDD-Reviews von Pull Request #575): Quartal
 * und Jahr, Bareinnahmen, Rechnung vor und Zahlung im Stichjahr, Stornos nach gesendeter Voranmeldung, Belege mit
 * Privatanteil und Skonto, Rechnungskorrektur; und Stornos im Stichjahr von Buchungen aus der Zeit davor, deren Zeilen
 * noch ohne Bemessungsgrundlage (#552) bzw. ohne Steuerschlüssel am privaten Teil (#551) gebucht sind.
 */

describe.skipIf(!testDatabaseUrl)("Voranmeldung aus dem Journal: Zeiträume, Stornos über das Stichjahr, Sonderfälle (Postgres)", () => {
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

  async function invoice(issueDate: string, lines: { unitPrice: number; taxRate: 1900 | 700 | 0 }[]) {
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
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function bookedDocument(date: string, net: number, tax: number) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 11]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `b${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: "",
      invoiceNumber: `R${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: "edv",
      payment: "privat",
      note: "",
      amounts: [{ taxRate: 1900, net, tax }],
      privateShare: 0,
      reverseCharge: null,
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function doc(date: string, category: string, amounts: { taxRate: number; net: number; tax: number }[], privateShare: number, payment = "privat") {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 12]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `d${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: "",
      invoiceNumber: `D${docSeq}`,
      documentDate: date,
      dueDate: null,
      category,
      payment,
      note: "",
      amounts,
      privateShare,
      reverseCharge: null,
    } as never);
    await documents.bookDocument(actor, id);
    return id;
  }

  async function pay(invoiceId: string, rows: [date: string, purpose: string, amount: string][]) {
    await bank.importStatement(actor, { bytes: dkbCsv(rows.map(([d, p, a]) => incoming(d, p, a))), filename: `${rows[0]![1]}.csv` }, null);
    for (const [, purpose] of rows) {
      const [tx] = await sql`select id, amount from bank_transactions where purpose = ${purpose}`;
      await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId, amount: Number(tx!.amount) });
    }
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

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Quartal und Jahr aus dem Journal (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const inv = await invoice("2026-09-20", [
          { unitPrice: 15_000, taxRate: 1900 },
          { unitPrice: 4_000, taxRate: 700 },
        ]);
        await pay(inv.id, [["01.10.26", "Q Rate", "221,30"]]);
        await bookedDocument("2026-08-05", 10_000, 1_900);
        await gleich([
          { year: 2026, month: 43 },
          { year: 2026, month: 44 },
        ]);
        const q = await figures.computeVatFigures({ year: 2026, month: versteuerung === "soll" ? 43 : 44 });
        expect(q.kz81).toBe(15_000);
      }, 60_000);

      it(`Bareinnahme und direkt gebuchte Einnahme (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await cash.createCashIncome(
          actor,
          { date: "2026-10-03", amount: 119_00, text: "Markt", steuer: { behandlung: "regulaer", steuersatz: 1900 } },
          "2026-11-10",
        );
        await cash.createCashIncome(
          actor,
          { date: "2026-10-04", amount: 107_00, text: "Markt 7", steuer: { behandlung: "regulaer", steuersatz: 700 } },
          "2026-11-10",
        );
        await bank.importStatement(actor, { bytes: dkbCsv([incoming("15.10.26", "Reparatur", "119,00")]), filename: "d.csv" }, null);
        const [tx] = await sql`select id from bank_transactions where purpose = 'Reparatur'`;
        await bank.allocate(actor, {
          kind: "kategorie",
          transactionId: tx!.id,
          amount: 119_00,
          kategorie: { kategorie: "erloese", steuersatz: 1900 },
        } as never);
        await gleich([{ year: 2026, month: 10 }]);
        expect((await figures.computeVatFigures({ year: 2026, month: 10 })).kz81).toBe(20_000);
      }, 60_000);
    }

    it(`Ist: Rechnung vor dem Stichjahr, Zahlung im Stichjahr (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen, 2026);
      const inv = await invoice("2025-12-15", [{ unitPrice: 10_000, taxRate: 1900 }]);
      expect((await figures.computeVatFigures({ year: 2025, month: 12 })).quelle).toBe("nebenbuecher");
      await pay(inv.id, [["05.01.26", "Zahlung Vorjahr", "119,00"]]);
      await gleich([{ year: 2026, month: 1 }]);
      expect((await figures.computeVatFigures({ year: 2026, month: 1 })).tax81).toBe(1_900);
    }, 60_000);

    it(`Soll: Storno im Stichjahr einer Rechnung aus dem Vorjahr (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen, 2026);
      const inv = await invoice("2025-12-10", [{ unitPrice: 10_000, taxRate: 1900 }]);
      await invoices.cancelInvoice(actor, inv.id, "2026-01-10");
      await gleich([{ year: 2026, month: 1 }]);
      expect((await figures.computeVatFigures({ year: 2026, month: 1 })).kz81).toBe(-10_000);
    }, 60_000);

    it(`Beleg-Storno nach gesendeter Voranmeldung: im Monat des Stornos, gespeicherte Zahlen bleiben (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen);
      const id = await bookedDocument("2026-09-15", 10_000, 1_900);
      const draft = await vat.saveDraft(actor, { year: 2026, month: 9 }, { mode: "berechnet" });
      expect(draft.kz66).toBe(1_900);
      await sql`update vat_returns set status = 'sent', sent_at = now() where id = ${draft.id}`;
      await cancellation.cancelDocument(actor, id, { reason: "Doppelt erfasst" } as never, "2026-10-20");
      await gleich([
        { year: 2026, month: 9 },
        { year: 2026, month: 10 },
      ]);
      expect((await figures.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(1_900);
      expect((await figures.computeVatFigures({ year: 2026, month: 10 })).kz66).toBe(-1_900);
    }, 60_000);
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Belege mit Privatanteil, gemischten Sätzen, Bewirtung, Geschenken, Einfuhrumsatzsteuer (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await doc(
          "2026-10-02",
          "telefon",
          [
            { taxRate: 1900, net: 3_333, tax: 633 },
            { taxRate: 700, net: 1_111, tax: 78 },
          ],
          33,
        );
        await doc("2026-10-03", "edv", [{ taxRate: 1900, net: 10_001, tax: 1_900 }], 17);
        await doc("2026-10-04", "bewirtung", [{ taxRate: 1900, net: 7_777, tax: 1_478 }], 0);
        await doc("2026-10-05", "geschenke", [{ taxRate: 1900, net: 5_000, tax: 950 }], 0);
        await doc("2026-10-06", "einfuhrumsatzsteuer", [{ taxRate: 0, net: 2_345, tax: 0 }], 0);
        await doc("2026-10-08", "edv", [{ taxRate: 1900, net: 20_000, tax: 3_800 }], 0, "bank");
        await gleich([{ year: 2026, month: 10 }]);
      }, 60_000);
    }
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Skonto erhalten auf Beleg im Folgemonat (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const id = await doc(
          "2026-09-27",
          "buero",
          [
            { taxRate: 1900, net: 10_000, tax: 1_900 },
            { taxRate: 700, net: 3_000, tax: 210 },
          ],
          0,
          "bank",
        );
        const out = ["02.10.26", "02.10.26", "Gebucht", "Testfirma", "Bürowelt", "D-Skonto", "Ausgang", "DE11100100100000000001", "-147,00", "", "", ""];
        await bank.importStatement(actor, { bytes: dkbCsv([out]), filename: "o.csv" }, null);
        const [tx] = await sql`select id from bank_transactions where purpose = 'D-Skonto'`;
        await bank.allocateWithRest(actor, { transactionId: tx!.id, target: { kind: "document", documentId: id }, rest: "skontoErhalten" } as never);
        await gleich([
          { year: 2026, month: 9 },
          { year: 2026, month: 10 },
        ]);
        expect((await figures.computeVatFigures({ year: 2026, month: 10 })).kz66).toBeLessThan(0);
      }, 60_000);

      it(`Bareinnahme auf Rechnung mit Skonto, Storno im Folgemonat (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const inv = await invoice("2026-09-20", [
          { unitPrice: 10_000, taxRate: 1900 },
          { unitPrice: 5_000, taxRate: 700 },
        ]);
        const entry = await cashInvoice.createCashInvoiceEntry(
          actor,
          { invoiceId: inv.id, date: "2026-09-25", amount: 160_00, skonto: true } as never,
          "2026-11-10",
        );
        await cashBook.reverseCashEntry(actor, entry.id, "2026-10-03");
        await gleich([
          { year: 2026, month: 9 },
          { year: 2026, month: 10 },
        ]);
      }, 60_000);

      it(`Rechnungskorrektur mit teilweiser Gutschrift (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const inv = await invoice("2026-09-20", [
          { unitPrice: 10_000, taxRate: 1900 },
          { unitPrice: 5_000, taxRate: 700 },
        ]);
        await pay(inv.id, [["25.09.26", "Voll", "172,50"]]);
        const draft = await invoices.createCorrection(actor, inv.id, "2026-10-05");
        const lines = await sql`select id from invoice_lines where invoice_id = ${draft.id} order by position`;
        expect(lines.length).toBe(2);
        await invoices.finalizeInvoice(actor, draft.id);
        await gleich([
          { year: 2026, month: 9 },
          { year: 2026, month: 10 },
        ]);
      }, 60_000);
    }
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    // Vor #552 trug die Zahlung bei Ist keine Bemessungsgrundlage (basis); solche Buchungen liegen in bestehenden Instanzen
    // vor dem Stichjahr (Migration 0192). Ein Storno im Stichjahr kopiert ihre Zeilen.
    it(`Ist: Storno einer Bareinnahme auf Rechnung aus dem Vorjahr (Buchung ohne Bemessungsgrundlage) im Stichjahr (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen, 2026);
      const inv = await invoice("2025-12-10", [{ unitPrice: 10_000, taxRate: 1900 }]);
      const entry = await cashInvoice.createCashInvoiceEntry(actor, { invoiceId: inv.id, date: "2025-12-20", amount: 119_00 } as never, "2026-11-10");
      // Wie vor #552 gebucht: ohne Bemessungsgrundlage an der Umsatzsteuerzeile
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update journal_lines set basis = null where entry_id = ${entry.journalEntryId}`;
      });
      expect((await figures.computeVatFigures({ year: 2025, month: 12 })).quelle).toBe("nebenbuecher");
      await cashBook.reverseCashEntry(actor, entry.id, "2026-01-10");
      const jan = await figures.computeVatFigures({ year: 2026, month: 1 });
      expect(jan.quelle).toBe("journal");
      expect({ kz81: jan.kz81, tax81: jan.tax81 }).toEqual({ kz81: -10_000, tax81: -1_900 });
      expect(kennzahlen(jan)).toEqual(jan.nebenbuecher);
    }, 60_000);
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    // Vor #551 stand der private Teil des Nettos bei § 13b ohne Steuerschlüssel auf den Entnahmen. Ein Storno im Stichjahr
    // (Zeitraum der Buchung schon gemeldet: am Tag des Stornos) kopiert die Zeilen samt Steuerschlüssel wie gebucht.
    it(`Storno im Stichjahr eines § 13b-Belegs mit Privatanteil aus dem Vorjahr (Buchung vor #551) (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen, 2026);
      docSeq++;
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 13]);
      const { id } = await documents.uploadDocument(actor, { bytes, filename: `rc${docSeq}.jpg` });
      await documents.updateDocument(actor, id, {
        supplierName: "Lieferant EU",
        supplierUstId: "ATU12345678",
        invoiceNumber: `RC${docSeq}`,
        documentDate: "2025-12-05",
        dueDate: null,
        category: "edv",
        payment: "privat",
        note: "",
        amounts: [{ taxRate: 1900, net: 100_000, tax: 19_000 }],
        privateShare: 30,
        reverseCharge: "eu",
      } as never);
      await documents.bookDocument(actor, id);
      // Wie vor #551 gebucht: der private Teil des Nettos ohne Steuerschlüssel
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update journal_lines set tax_code = null where tax_code = 'RC13bEU' and entry_id in
          (select id from journal_entries where source_type = 'document' and source_id = ${id})
          and account not in (select account from journal_lines where tax_code = 'RC13bEU' order by debit desc limit 1)`;
      });
      const draft = await vat.saveDraft(actor, { year: 2025, month: 12 }, { mode: "berechnet" });
      await sql`update vat_returns set status = 'sent', sent_at = now() where id = ${draft.id}`;
      await cancellation.cancelDocument(actor, id, { reason: "Falscher Lieferant" } as never, "2026-01-15");
      const jan = await figures.computeVatFigures({ year: 2026, month: 1 });
      expect(jan.quelle).toBe("journal");
      expect(jan.kz46).toBe(-100_000);
      expect(kennzahlen(jan)).toEqual(jan.nebenbuecher);
    }, 60_000);
  }
});
